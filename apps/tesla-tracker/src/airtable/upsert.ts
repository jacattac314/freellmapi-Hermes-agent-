import { AirtableClient } from './client';
import { EnrichedListing, PriceHistory } from '../types';

/**
 * Resolves field IDs for the Listings table once and caches them.
 * Airtable API prefers IDs over names in writes for reliability.
 */
let fieldCache: Record<string, string> | null = null;
let tableCache: Record<string, string> | null = null;

async function getTableIds(client: AirtableClient): Promise<Record<string, string>> {
  if (tableCache) return tableCache;
  const tables = await client.listTables();
  tableCache = {};
  for (const t of tables) tableCache[t.name] = t.id;
  return tableCache;
}

async function getFieldIds(client: AirtableClient, tableId: string): Promise<Record<string, string>> {
  if (fieldCache) return fieldCache;
  const tables = await client.listTables();
  const table = tables.find((t) => t.id === tableId);
  fieldCache = {};
  if (table) {
    for (const f of table.fields) fieldCache[f.name] = f.id;
  }
  return fieldCache;
}

function formatDate(iso: string): string {
  return iso.split('T')[0];
}

export async function upsertListing(client: AirtableClient, listing: EnrichedListing): Promise<void> {
  const tableIds = await getTableIds(client);
  const listingsTableId = tableIds['Listings'];
  if (!listingsTableId) throw new Error('Listings table not found in base');

  const fieldIds = await getFieldIds(client, listingsTableId);

  const f = (name: string) => fieldIds[name] ?? name;

  const flagged =
    listing.lemonFlag || listing.salvageFlag || listing.buybackFlag || listing.floodFlag;

  const fields: Record<string, unknown> = {
    [f('Listing Title')]: listing.listingTitle,
    [f('Score')]: listing.score,
    [f('Status')]: listing.status,
    [f('Priority')]: listing.priority,
    [f('Model')]: listing.model,
    [f('Year')]: listing.year,
    [f('Trim')]: listing.trim,
    [f('Price')]: listing.price,
    [f('Mileage')]: listing.mileage,
    [f('VIN')]: listing.vin,
    [f('Location')]: listing.location,
    [f('Distance (mi)')]: listing.distanceMiles,
    [f('Seller Type')]: listing.sellerType === 'tesla_cpo' ? 'Tesla CPO' : listing.sellerType === 'dealer' ? 'Dealer' : 'Private',
    [f('Seller Name')]: listing.sellerName,
    [f('Listing URL')]: listing.listingUrl,
    [f('Source')]: listing.source === 'tesla_cpo' ? 'Tesla CPO' : listing.source === 'cargurus' ? 'CarGurus' : listing.source === 'autotrader' ? 'AutoTrader' : listing.source,
    [f('Last Seen')]: formatDate(listing.lastSeen),
    [f('Price Change ($)')]: listing.priceChange,
    [f('Previous Price')]: listing.previousPrice,
    [f('Clean Title')]: listing.cleanTitle,
    [f('Accident Reported')]: listing.accidentReported,
    [f('Lemon / Buyback / Salvage / Flood Flag')]: flagged,
    [f('Recall Status')]: listing.recallStatus,
    [f('Warranty Remaining')]: listing.warrantyRemaining,
    [f('Battery Warranty Estimate')]: listing.batteryWarrantyEstimate,
    [f('FSD Claimed')]: listing.fsdClaimed,
    [f('FSD Status')]: listing.fsdStatus,
    [f('Hardware Generation')]: listing.hardwareGen,
    [f('Heat Pump')]: listing.heatPump,
    [f('Matrix Headlights')]: listing.matrixHeadlights,
    [f('Suspicion Flags')]: listing.suspicionFlags.join('\n'),
    [f('AI Summary')]: listing.aiSummary,
    [f('Next Action')]: listing.nextAction ?? '',
    [f('Consecutive Misses')]: listing.consecutiveMisses,
    [f('Score Breakdown')]: JSON.stringify(listing.scoreBreakdown, null, 2),
    [f('Auto-Pass Reason')]: listing.autoPassReason ?? '',
  };

  // Only set Date Found on creation (handled by upsertRecord logic)
  const vinFilter = `{VIN}="${listing.vin}"`;
  const existing = await client.listRecords(listingsTableId, {
    filterByFormula: vinFilter,
    maxRecords: 1,
    fields: [f('Date Found'), f('Consecutive Misses'), f('Previous Price'), f('Price')],
  });

  if (existing.length === 0) {
    fields[f('Date Found')] = formatDate(listing.dateFound);
    await client.createRecords(listingsTableId, [{ fields }]);
  } else {
    const rec = existing[0];
    // Preserve original Date Found
    const prevPrice = (rec.fields[f('Price')] as number) ?? listing.price;
    if (prevPrice !== listing.price && prevPrice > 0) {
      fields[f('Previous Price')] = prevPrice;
      fields[f('Price Change ($)')] = listing.price - prevPrice;
    }
    await client.updateRecords(listingsTableId, [{ id: rec.id, fields }]);
  }
}

export async function recordPriceHistory(client: AirtableClient, ph: PriceHistory): Promise<void> {
  const tableIds = await getTableIds(client);
  const tableId = tableIds['Price History'];
  if (!tableId) return;

  const tables = await client.listTables();
  const table = tables.find((t) => t.id === tableId);
  if (!table) return;

  const fm: Record<string, string> = {};
  for (const f of table.fields) fm[f.name] = f.id;

  await client.createRecords(tableId, [
    {
      fields: {
        [fm['Listing VIN']]: ph.listingVin,
        [fm['Listing URL']]: ph.listingUrl,
        [fm['Date']]: formatDate(ph.date),
        [fm['Price']]: ph.price,
        [fm['Change ($)']]: ph.changeAmount,
        [fm['Change (%)']]: ph.changePercent / 100,
        [fm['Source']]: ph.source,
      },
    },
  ]);
}

export async function upsertVinCheck(client: AirtableClient, check: Record<string, unknown>): Promise<void> {
  const tableIds = await getTableIds(client);
  const tableId = tableIds['VIN Checks'];
  if (!tableId) return;

  const tables = await client.listTables();
  const table = tables.find((t) => t.id === tableId);
  if (!table) return;

  const fm: Record<string, string> = {};
  for (const f of table.fields) fm[f.name] = f.id;

  const vin = check['VIN'] as string;
  const existing = await client.listRecords(tableId, {
    filterByFormula: `{VIN}="${vin}"`,
    maxRecords: 1,
  });

  const fields: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(check)) {
    if (fm[key]) fields[fm[key]] = val;
  }

  if (existing.length > 0) {
    await client.updateRecords(tableId, [{ id: existing[0].id, fields }]);
  } else {
    await client.createRecords(tableId, [{ fields }]);
  }
}

export async function markListingRemoved(client: AirtableClient, vin: string): Promise<void> {
  const tableIds = await getTableIds(client);
  const tableId = tableIds['Listings'];
  if (!tableId) return;

  const fieldIds = await getFieldIds(client, tableId);
  const f = (n: string) => fieldIds[n] ?? n;

  const existing = await client.listRecords(tableId, {
    filterByFormula: `{VIN}="${vin}"`,
    maxRecords: 1,
  });
  if (existing.length === 0) return;

  await client.updateRecords(tableId, [
    {
      id: existing[0].id,
      fields: {
        [f('Status')]: 'Removed',
        [f('Next Action')]: 'Listing no longer visible — mark as Removed',
      },
    },
  ]);
}

export async function getActiveListingVINs(client: AirtableClient): Promise<string[]> {
  const tableIds = await getTableIds(client);
  const tableId = tableIds['Listings'];
  if (!tableId) return [];

  const fieldIds = await getFieldIds(client, tableId);
  const f = (n: string) => fieldIds[n] ?? n;

  const records = await client.listRecords(tableId, {
    filterByFormula: `NOT({Status}="Removed")`,
    fields: [f('VIN'), f('Consecutive Misses')],
  });

  return records
    .map((r) => r.fields[f('VIN')] as string)
    .filter(Boolean);
}

export async function incrementConsecutiveMisses(
  client: AirtableClient,
  vin: string,
  removalThreshold: number,
): Promise<void> {
  const tableIds = await getTableIds(client);
  const tableId = tableIds['Listings'];
  if (!tableId) return;

  const fieldIds = await getFieldIds(client, tableId);
  const f = (n: string) => fieldIds[n] ?? n;

  const existing = await client.listRecords(tableId, {
    filterByFormula: `{VIN}="${vin}"`,
    maxRecords: 1,
    fields: [f('Consecutive Misses'), f('Status')],
  });
  if (existing.length === 0) return;

  const rec = existing[0];
  const misses = ((rec.fields[f('Consecutive Misses')] as number) ?? 0) + 1;
  const fields: Record<string, unknown> = { [f('Consecutive Misses')]: misses };

  if (misses >= removalThreshold) {
    fields[f('Status')] = 'Removed';
    fields[f('Next Action')] = `Not seen for ${misses} checks — marked Removed`;
  }

  await client.updateRecords(tableId, [{ id: rec.id, fields }]);
}
