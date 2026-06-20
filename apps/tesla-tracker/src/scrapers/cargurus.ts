/**
 * CarGurus listing scraper using their public search API.
 * No API key required — uses the same endpoint their website uses.
 */
import axios from 'axios';
import { RawListing, TeslaModel } from '../types';
import { config } from '../config';

const CARGURUS_API = 'https://www.cargurus.com/Cars/searchResults.action';

interface CarGurusListing {
  id: string;
  listingUrl?: string;
  listingTitle?: string;
  year?: number;
  mileage?: number;
  price?: number;
  dealerName?: string;
  dealerCity?: string;
  dealerState?: string;
  distance?: number;
  trim?: string;
  vin?: string;
  transmission?: string;
  driveType?: string;
  options?: string[];
}

const MODEL_SEARCH: Record<string, { label: TeslaModel; carGurasMakeId: string; carGurasModelId: string }> = {
  'Model Y': { label: 'Model Y', carGurasMakeId: 'd2271', carGurasModelId: 'd2271_m4563' },
  'Model 3': { label: 'Model 3', carGurasMakeId: 'd2271', carGurasModelId: 'd2271_m4426' },
  'Model X': { label: 'Model X', carGurasMakeId: 'd2271', carGurasModelId: 'd2271_m4245' },
};

export async function scrapeCarGurus(): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const target of config.search.targets) {
    const modelInfo = MODEL_SEARCH[target.label];
    if (!modelInfo) continue;

    try {
      console.log(`[scraper:cargurus] Fetching ${target.label}...`);

      // CarGurus search parameters (mirroring their website query)
      const params = {
        zip: config.search.zip,
        distance: config.search.radiusMiles,
        selectedEntity: modelInfo.carGurasModelId,
        'minYear': target.minYear,
        'maxMileage': config.search.maxMileage + 10_000,
        'maxPrice': config.search.maxPrice,
        'condition': 'USED',
        'sortDir': 'ASC',
        'sortType': 'PRICE',
        'startIndex': 0,
        'resultsPerPage': 100,
        'listingTypes': 'USED',
        'transmissionTypes': '',
        'trim': target.trims.join(','),
        'nonShippable': false,
      };

      const res = await axios.get(CARGURUS_API, {
        params,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
          Accept: 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 15_000,
      });

      const data = res.data;
      const listingItems: CarGurusListing[] = data?.listings ?? data?.searchResults?.listings ?? [];

      for (const item of listingItems) {
        if (!item.vin) continue;
        const hasFsd = (item.options ?? []).some((o) =>
          o.toLowerCase().includes('full self-driving') || o.toLowerCase().includes('fsd'),
        );
        const hasHeatPump = (item.options ?? []).some((o) => o.toLowerCase().includes('heat pump'));
        const hasMatrix = (item.options ?? []).some((o) =>
          o.toLowerCase().includes('matrix') || o.toLowerCase().includes('adaptive headlight'),
        );

        listings.push({
          vin: item.vin,
          listingUrl: item.listingUrl ?? `https://www.cargurus.com/Cars/listingDetail.action?listingId=${item.id}`,
          listingTitle: item.listingTitle ?? `${item.year} Tesla ${modelInfo.label}`,
          source: 'cargurus',
          model: modelInfo.label,
          year: item.year ?? target.minYear,
          trim: item.trim ?? '',
          price: item.price ?? 0,
          mileage: item.mileage ?? 0,
          location: `${item.dealerCity ?? ''}, ${item.dealerState ?? ''}`.trim().replace(/^,\s*/, ''),
          distanceMiles: item.distance ?? 999,
          sellerType: 'dealer',
          sellerName: item.dealerName ?? 'Dealer',
          fsdClaimed: hasFsd,
          hardwareGen: (item.year ?? 0) >= 2024 ? 'HW4' : (item.year ?? 0) >= 2019 ? 'HW3' : 'HW2',
          heatPump: hasHeatPump || (item.year ?? 0) >= 2021,
          matrixHeadlights: hasMatrix || (item.year ?? 0) >= 2023,
        });
      }

      console.log(`[scraper:cargurus] Found ${listingItems.length} listings for ${target.label}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // CarGurus API sometimes blocks bots — non-fatal
      console.warn(`[scraper:cargurus] ${target.label} failed (may be rate-limited): ${msg}`);
    }
  }

  return listings;
}
