/**
 * Tesla Tracker — main orchestrator
 *
 * Run once:   npm run run-once
 * Scheduled:  npm run dev  (watches and runs via node-cron)
 *
 * Daily flow:
 * 1. Scrape Tesla CPO + CarGurus for new listings
 * 2. Decode VINs via NHTSA vPIC, check recalls
 * 3. Score each listing 0-100
 * 4. Upsert into Airtable (Listings + VIN Checks + Price History)
 * 5. Increment consecutive-misses counter for VINs not seen this run
 * 6. Alert on new High Priority listings and price drops ≥2%
 * 7. Send daily email summary
 */
import 'dotenv/config';
import cron from 'node-cron';
import { scrapeAll } from './scrapers';
import { scoreListing } from './scoring';
import { generateAiSummary, generateOutreachMessage } from './ai/summarize';
import { AirtableClient } from './airtable/client';
import {
  upsertListing,
  recordPriceHistory,
  upsertVinCheck,
  getActiveListingVINs,
  incrementConsecutiveMisses,
} from './airtable/upsert';
import { alertHighPriority, alertPriceDrop, sendDailySummary } from './alerts';
import { config } from './config';
import { EnrichedListing } from './types';
import { fullVinCheck } from './vin/nhtsa';

async function run(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[tracker] Run started at ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  if (!config.airtable.baseId) {
    console.error('[tracker] AIRTABLE_BASE_ID is not set. Run `npm run setup` first.');
    process.exit(1);
  }

  const client = new AirtableClient(config.airtable.baseId);

  // --- Step 1: Get currently tracked VINs ---
  console.log('\n[tracker] Loading active VINs from Airtable...');
  let trackedVins: Set<string>;
  try {
    const vins = await getActiveListingVINs(client);
    trackedVins = new Set(vins);
    console.log(`[tracker] Currently tracking ${trackedVins.size} active listings`);
  } catch (err) {
    console.warn('[tracker] Could not load tracked VINs (Airtable may be unavailable):', err);
    trackedVins = new Set();
  }

  // --- Step 2: Scrape ---
  console.log('\n[tracker] Scraping listing sources...');
  const { listings: rawListings, sourceStats, errors } = await scrapeAll();

  if (errors.length > 0) {
    console.warn('[tracker] Scraper errors:', errors.join('; '));
  }

  console.log('[tracker] Source stats:', sourceStats);

  // --- Step 3: Score and enrich ---
  console.log(`\n[tracker] Scoring ${rawListings.length} listings...`);
  const enriched: EnrichedListing[] = [];
  const newHighPriority: EnrichedListing[] = [];
  const priceDrop: Array<{ listing: EnrichedListing; oldPrice: number }> = [];

  let newCount = 0;
  let updatedCount = 0;
  const seenThisRun = new Set<string>();

  for (const raw of rawListings) {
    try {
      const scored = await scoreListing(raw);
      seenThisRun.add(scored.vin);

      // Generate AI content for non-auto-pass listings with decent scores
      if (!scored.autoPass && scored.score >= 50) {
        scored.aiSummary = await generateAiSummary(scored);
        scored.outreachMessage = await generateOutreachMessage(scored);
      }

      // Fetch existing Airtable record to detect price drops and new listings
      const isNew = !trackedVins.has(scored.vin);
      if (isNew) {
        newCount++;
        if (scored.priority === 'High') newHighPriority.push(scored);
      } else {
        updatedCount++;
      }

      enriched.push(scored);

      // --- Step 4a: Upsert into Airtable ---
      await upsertListing(client, scored);

      // --- Step 4b: VIN check ---
      if (scored.vin?.length === 17) {
        const vinCheckResult = await fullVinCheck(scored.vin);
        await upsertVinCheck(client, {
          VIN: vinCheckResult.vin,
          'Check Date': new Date().toISOString().split('T')[0],
          'NHTSA Make': vinCheckResult.nhtsaMake,
          'NHTSA Model': vinCheckResult.nhtsaModel,
          'NHTSA Year': vinCheckResult.nhtsaModelYear,
          'NHTSA Trim': vinCheckResult.nhtsaTrim,
          Driveline: (vinCheckResult as unknown as Record<string, string>).driveline ?? '',
          'Body Class': (vinCheckResult as unknown as Record<string, string>).bodyClass ?? '',
          'Recall Count': vinCheckResult.recallCount,
          'Recall Details': vinCheckResult.recallDetails,
          'VIN Valid': vinCheckResult.vinValid,
          Discrepancies: vinCheckResult.discrepancies,
        });
      }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.warn(`[tracker] Error processing ${raw.vin}: ${err}`);
    }
  }

  // --- Step 4c: Price History for changed prices ---
  // (price change detection happens in upsertListing; we log here)
  for (const listing of enriched) {
    if (listing.priceChange !== 0 && listing.previousPrice > 0) {
      await recordPriceHistory(client, {
        listingVin: listing.vin,
        listingUrl: listing.listingUrl,
        date: new Date().toISOString(),
        price: listing.price,
        changeAmount: listing.priceChange,
        changePercent: (listing.priceChange / listing.previousPrice) * 100,
        source: listing.source,
      });

      // Check for significant price drop
      const dropPct = Math.abs(listing.priceChange / listing.previousPrice) * 100;
      if (listing.priceChange < 0 && dropPct >= config.scoring.priceDrop.alertPercent) {
        priceDrop.push({ listing, oldPrice: listing.previousPrice });
      }
    }
  }

  // --- Step 5: Increment misses for VINs not seen this run ---
  console.log('\n[tracker] Checking for removed listings...');
  let removedCount = 0;
  for (const trackedVin of trackedVins) {
    if (!seenThisRun.has(trackedVin)) {
      await incrementConsecutiveMisses(client, trackedVin, config.removalThreshold);
      removedCount++;
    }
  }
  console.log(`[tracker] ${removedCount} tracked VINs not seen this run (miss counter incremented)`);

  // --- Step 6: Alerts ---
  console.log('\n[tracker] Sending alerts...');
  if (newHighPriority.length > 0) {
    console.log(`[tracker] ${newHighPriority.length} new high priority listing(s)!`);
    await alertHighPriority(newHighPriority);
  }

  for (const { listing, oldPrice } of priceDrop) {
    await alertPriceDrop(listing, oldPrice, listing.price);
  }

  // --- Step 7: Daily summary ---
  const highPriorityAll = enriched.filter((l) => l.priority === 'High' && !l.autoPass);
  await sendDailySummary(newCount, updatedCount, removedCount, highPriorityAll);

  // --- Done ---
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[tracker] Run complete at ${new Date().toISOString()}`);
  console.log(`  New:         ${newCount}`);
  console.log(`  Updated:     ${updatedCount}`);
  console.log(`  Missed:      ${removedCount}`);
  console.log(`  High Pri:    ${highPriorityAll.length}`);
  console.log(`  Price drops: ${priceDrop.length}`);
  console.log('='.repeat(60));
}

// --- Entry point ---

const args = process.argv.slice(2);
const isScheduled = args.includes('--schedule');

if (isScheduled) {
  // Run daily at 8:00 AM local time
  console.log('[tracker] Scheduled mode — running daily at 08:00');
  cron.schedule('0 8 * * *', () => {
    run().catch((err) => console.error('[tracker] Run failed:', err));
  });
  // Also run immediately on start
  run().catch((err) => console.error('[tracker] Initial run failed:', err));
} else {
  // Run once
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[tracker] Fatal error:', err);
      process.exit(1);
    });
}
