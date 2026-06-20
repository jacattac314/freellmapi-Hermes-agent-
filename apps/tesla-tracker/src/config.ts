import 'dotenv/config';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  airtable: {
    token: requireEnv('AIRTABLE_TOKEN'),
    workspaceId: process.env.AIRTABLE_WORKSPACE_ID ?? '',
    baseId: process.env.AIRTABLE_BASE_ID ?? '',
  },

  search: {
    zip: process.env.SEARCH_ZIP ?? '10001',
    lat: parseFloat(process.env.SEARCH_LAT ?? '40.7484'),
    lng: parseFloat(process.env.SEARCH_LNG ?? '-73.9967'),
    radiusMiles: parseInt(process.env.SEARCH_RADIUS_MILES ?? '300', 10),
    // Vehicle preferences in priority order
    targets: [
      { model: 'my' as const, label: 'Model Y', minYear: 2023, trims: ['Long Range', 'AWD'] },
      { model: 'm3' as const, label: 'Model 3', minYear: 2024, trims: ['Long Range'] },
      { model: 'mx' as const, label: 'Model X', minYear: 2022, trims: [] }, // exceptional deals only
    ],
    maxMileage: 35_000,
    maxPrice: 65_000,
  },

  scoring: {
    weights: {
      yearHardware: 20,
      cleanHistory: 20,
      warranty: 15,
      priceVsMarket: 15,
      mileage: 10,
      teslaFeatures: 10,
      sellerQuality: 5,
      logistics: 5,
    },
    highPriorityThreshold: 80,
    priceDrop: {
      alertPercent: 2,
    },
    // Market price benchmarks (update as market shifts)
    marketPrices: {
      'Model Y Long Range AWD': { low: 31_000, mid: 37_000, high: 45_000 },
      'Model Y Standard Range': { low: 24_000, mid: 29_000, high: 35_000 },
      'Model 3 Long Range': { low: 28_000, mid: 34_000, high: 42_000 },
      'Model 3 Standard Range': { low: 22_000, mid: 27_000, high: 33_000 },
      'Model X Long Range': { low: 55_000, mid: 68_000, high: 85_000 },
    } as Record<string, { low: number; mid: number; high: number }>,
  },

  autoPass: {
    triggers: [
      'salvage',
      'rebuilt',
      'lemon',
      'buyback',
      'flood',
      'odometer',
      'major_accident',
      'missing_vin',
    ],
  },

  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? 'http://localhost:3001/v1',
    apiKey: process.env.LLM_API_KEY ?? 'not-needed',
    model: process.env.LLM_MODEL ?? 'smart',
  },

  email: {
    to: process.env.ALERT_EMAIL_TO ?? '',
    smtp: {
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      user: process.env.SMTP_USER ?? '',
      pass: process.env.SMTP_PASS ?? '',
    },
  },

  // Listing marked Removed after this many consecutive missed checks
  removalThreshold: 3,
};

export type Config = typeof config;
