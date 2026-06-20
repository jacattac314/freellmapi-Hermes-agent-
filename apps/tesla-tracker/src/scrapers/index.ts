import { RawListing } from '../types';
import { scrapeTeslaCPO } from './tesla';
import { scrapeCarGurus } from './cargurus';

export interface ScrapeResult {
  listings: RawListing[];
  sourceStats: Record<string, number>;
  errors: string[];
}

export async function scrapeAll(): Promise<ScrapeResult> {
  const errors: string[] = [];
  const allListings: RawListing[] = [];
  const sourceStats: Record<string, number> = {};

  // Run all scrapers (failures are non-fatal)
  const scrapers: Array<{ name: string; fn: () => Promise<RawListing[]> }> = [
    { name: 'tesla_cpo', fn: scrapeTeslaCPO },
    { name: 'cargurus', fn: scrapeCarGurus },
  ];

  await Promise.allSettled(
    scrapers.map(async ({ name, fn }) => {
      try {
        const results = await fn();
        allListings.push(...results);
        sourceStats[name] = results.length;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${name}: ${msg}`);
        sourceStats[name] = 0;
      }
    }),
  );

  // Deduplicate by VIN (prefer tesla_cpo > cargurus)
  const seen = new Map<string, RawListing>();
  const sourcePriority: Record<string, number> = { tesla_cpo: 3, cargurus: 2, autotrader: 2, craigslist: 1, private: 1 };

  for (const listing of allListings) {
    if (!listing.vin) continue;
    const existing = seen.get(listing.vin);
    if (!existing || (sourcePriority[listing.source] ?? 0) > (sourcePriority[existing.source] ?? 0)) {
      seen.set(listing.vin, listing);
    }
  }

  // Also deduplicate by listingUrl for listings without VINs
  const urlSeen = new Set<string>();
  const deduped: RawListing[] = [];
  for (const listing of seen.values()) {
    if (!urlSeen.has(listing.listingUrl)) {
      urlSeen.add(listing.listingUrl);
      deduped.push(listing);
    }
  }

  console.log(
    `[scraper] Total: ${deduped.length} unique listings from ${Object.keys(sourceStats).join(', ')}`,
  );

  return { listings: deduped, sourceStats, errors };
}
