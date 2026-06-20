/**
 * Scrapes Tesla's own CPO inventory API.
 * Tesla uses this endpoint internally for their website — it's public/unauthenticated.
 * Returns structured data including VIN, price, mileage, features, and location.
 */
import axios from 'axios';
import { RawListing, TeslaModel } from '../types';
import { config } from '../config';

const TESLA_INVENTORY_URL = 'https://www.tesla.com/en_US/inventory/api/v4/inventory-results';

interface TeslaInventoryItem {
  VIN: string;
  Model: string;
  ModelYear: number;
  TrimName: string;
  Price: number;
  Odometer: number;
  OdometerType: string;
  MetroName: string;
  City: string;
  StateProvince: string;
  CountryCode: string;
  ListingUrl: string;
  IsDemo: boolean;
  IsDemoVehicle: boolean;
  OptionCodeData: Array<{ group: string; code: string; name: string }>;
  CompositorViews?: { frontView?: string[] };
  InventorySource?: string;
}

interface TeslaInventoryResponse {
  results: TeslaInventoryItem[];
  total_matches_found: number;
}

const MODEL_CODE_MAP: Record<string, TeslaModel> = {
  my: 'Model Y',
  m3: 'Model 3',
  mx: 'Model X',
  ms: 'Model S',
};

function hasOption(item: TeslaInventoryItem, codePattern: string): boolean {
  return item.OptionCodeData?.some(
    (o) =>
      o.code?.toLowerCase().includes(codePattern.toLowerCase()) ||
      o.name?.toLowerCase().includes(codePattern.toLowerCase()),
  ) ?? false;
}

function detectHardwareGen(item: TeslaInventoryItem): string {
  if (hasOption(item, 'HW4') || hasOption(item, 'FSDBeta') || hasOption(item, 'AUTOPILOT_HW4')) return 'HW4';
  if (hasOption(item, 'HW3') || hasOption(item, 'AUTOPILOT_HW3')) return 'HW3';
  if (hasOption(item, 'HW2')) return 'HW2';
  // Infer by year for Model Y/3
  if (item.ModelYear >= 2024) return 'HW4';
  if (item.ModelYear >= 2019) return 'HW3';
  return 'HW2';
}

function detectFsd(item: TeslaInventoryItem): boolean {
  return hasOption(item, 'AUTOPILOT_FULL_SELF_DRIVING') ||
    hasOption(item, 'FSD') ||
    hasOption(item, 'FULL_SELF_DRIVING') ||
    (item.TrimName?.toLowerCase().includes('fsd') ?? false);
}

function detectHeatPump(item: TeslaInventoryItem): boolean {
  // Heat pump standard on Model Y/3 from 2021+; Model X always had it
  return hasOption(item, 'HEAT_PUMP') || item.ModelYear >= 2021;
}

function detectMatrixHeadlights(item: TeslaInventoryItem): boolean {
  return hasOption(item, 'HEADLAMP_MATRIX') || hasOption(item, 'MATRIX') || item.ModelYear >= 2023;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3_958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Tesla inventory API doesn't return coordinates directly; we use a rough lookup
// This is a simplified state-centroid table for distance estimation
const STATE_COORDS: Record<string, [number, number]> = {
  AL: [32.8, -86.8], AK: [64.2, -153.4], AZ: [34.3, -111.7], AR: [34.8, -92.2],
  CA: [36.8, -119.7], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [38.9, -75.5],
  FL: [28.7, -82.4], GA: [32.8, -83.6], HI: [20.2, -156.4], ID: [44.4, -114.6],
  IL: [40.0, -89.2], IN: [39.8, -86.1], IA: [42.0, -93.5], KS: [38.5, -98.4],
  KY: [37.5, -85.3], LA: [31.1, -91.9], ME: [45.3, -69.0], MD: [39.1, -76.8],
  MA: [42.3, -71.8], MI: [44.0, -84.5], MN: [46.4, -93.1], MS: [32.7, -89.7],
  MO: [38.4, -92.5], MT: [46.9, -110.5], NE: [41.5, -99.9], NV: [39.3, -116.6],
  NH: [43.7, -71.6], NJ: [40.1, -74.5], NM: [34.5, -106.1], NY: [42.9, -75.5],
  NC: [35.5, -79.8], ND: [47.5, -100.4], OH: [40.4, -82.7], OK: [35.6, -97.5],
  OR: [44.1, -120.5], PA: [40.6, -77.2], RI: [41.7, -71.5], SC: [33.9, -81.0],
  SD: [44.4, -100.2], TN: [35.9, -86.7], TX: [31.1, -97.6], UT: [39.3, -111.1],
  VT: [44.1, -72.7], VA: [37.5, -79.5], WA: [47.4, -120.5], WV: [38.6, -80.6],
  WI: [44.3, -89.7], WY: [43.0, -107.6],
};

function estimateDistance(state: string): number {
  const coords = STATE_COORDS[state?.toUpperCase()];
  if (!coords) return 999;
  return Math.round(haversineDistance(config.search.lat, config.search.lng, coords[0], coords[1]));
}

async function fetchModelInventory(
  modelCode: 'my' | 'm3' | 'mx' | 'ms',
  minYear: number,
  offset = 0,
): Promise<TeslaInventoryItem[]> {
  const query = {
    query: {
      model: modelCode,
      condition: 'used',
      options: {},
      arrangeby: 'Price',
      order: 'asc',
      market: 'US',
      language: 'en',
      super_region: 'north america',
      lng: config.search.lng,
      lat: config.search.lat,
      zip: config.search.zip,
      range: 0,
      region: '',
    },
    offset,
    count: 50,
    outsideOffset: 0,
    outsideSearch: true, // search nationally for CPO
  };

  const res = await axios.get<TeslaInventoryResponse>(TESLA_INVENTORY_URL, {
    params: { query: JSON.stringify(query), lang: 'en_US' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TeslaTrackerBot/1.0)',
      Accept: 'application/json',
    },
    timeout: 15_000,
  });

  return (res.data.results ?? []).filter((item) => item.ModelYear >= minYear);
}

function itemToListing(item: TeslaInventoryItem, modelLabel: TeslaModel): RawListing {
  const state = item.StateProvince;
  const location = [item.City, state, item.CountryCode].filter(Boolean).join(', ');
  const distanceMiles = estimateDistance(state);

  const vin = item.VIN ?? '';
  const listingUrl = item.ListingUrl
    ? `https://www.tesla.com${item.ListingUrl}`
    : `https://www.tesla.com/en_US/inventory/used/${item.VIN}`;

  return {
    vin,
    listingUrl,
    listingTitle: `${item.ModelYear} Tesla ${modelLabel} ${item.TrimName ?? ''}`.trim(),
    source: 'tesla_cpo',
    model: modelLabel,
    year: item.ModelYear,
    trim: item.TrimName ?? '',
    price: item.Price ?? 0,
    mileage: item.Odometer ?? 0,
    location,
    distanceMiles,
    sellerType: 'tesla_cpo',
    sellerName: `Tesla CPO — ${location}`,
    fsdClaimed: detectFsd(item),
    hardwareGen: detectHardwareGen(item),
    heatPump: detectHeatPump(item),
    matrixHeadlights: detectMatrixHeadlights(item),
    imageUrl: item.CompositorViews?.frontView?.[0],
  };
}

export async function scrapeTeslaCPO(): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const target of config.search.targets) {
    try {
      console.log(`[scraper:tesla] Fetching ${target.label} inventory...`);
      const items = await fetchModelInventory(target.model, target.minYear);
      const modelLabel = MODEL_CODE_MAP[target.model] ?? ('Model Y' as TeslaModel);

      for (const item of items) {
        // Filter by trim preference if specified
        if (
          target.trims.length > 0 &&
          !target.trims.some((t) => item.TrimName?.includes(t))
        ) {
          continue;
        }

        const listing = itemToListing(item, modelLabel);

        // Apply basic filters
        if (listing.mileage > config.search.maxMileage * 1.5) continue; // allow slight buffer
        if (listing.price > config.search.maxPrice * 1.2) continue;

        listings.push(listing);
      }

      console.log(`[scraper:tesla] Found ${listings.length} listings for ${target.label}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[scraper:tesla] Failed to fetch ${target.label}: ${msg}`);
    }
  }

  return listings;
}
