export type TeslaModel = 'Model Y' | 'Model 3' | 'Model X' | 'Model S';
export type ListingSource = 'tesla_cpo' | 'cargurus' | 'autotrader' | 'craigslist' | 'private';
export type SellerType = 'tesla_cpo' | 'dealer' | 'private';
export type ListingStatus = 'Active' | 'High Priority' | 'Watching' | 'Contacted' | 'Removed' | 'Purchased' | 'Pass';
export type Priority = 'High' | 'Medium' | 'Low' | 'Auto-Pass';
export type FsdStatus = 'Claimed - Needs Verification' | 'Verified' | 'Not Claimed' | 'Included (CPO)';

export interface RawListing {
  vin: string;
  listingUrl: string;
  listingTitle: string;
  source: ListingSource;
  model: TeslaModel;
  year: number;
  trim: string;
  price: number;
  mileage: number;
  location: string;
  distanceMiles: number;
  sellerType: SellerType;
  sellerName: string;
  // raw feature flags from source
  fsdClaimed: boolean;
  hardwareGen: string;
  heatPump: boolean;
  matrixHeadlights: boolean;
  imageUrl?: string;
}

export interface EnrichedListing extends RawListing {
  // VIN decode results
  vinDecoded: boolean;
  nhtsaMake: string;
  nhtsaModel: string;
  nhtsaYear: number;
  nextAction?: string;
  // Recall info
  recallCount: number;
  recallStatus: string;
  // History flags (from paid report fields or source metadata)
  cleanTitle: boolean;
  accidentReported: boolean;
  lemonFlag: boolean;
  salvageFlag: boolean;
  buybackFlag: boolean;
  floodFlag: boolean;
  odometerFlag: boolean;
  // Warranty estimates
  warrantyRemaining: boolean;
  batteryWarrantyEstimate: string;
  // FSD
  fsdVerified: boolean;
  fsdStatus: FsdStatus;
  // Scoring
  score: number;
  scoreBreakdown: ScoreBreakdown;
  status: ListingStatus;
  priority: Priority;
  suspicionFlags: string[];
  autoPass: boolean;
  autoPassReason: string;
  // AI
  aiSummary: string;
  outreachMessage: string;
  // Tracking
  dateFound: string;
  lastSeen: string;
  consecutiveMisses: number;
  priceChange: number;
  previousPrice: number;
}

export interface ScoreBreakdown {
  yearHardware: number;   // max 20
  cleanHistory: number;   // max 20
  warranty: number;       // max 15
  priceVsMarket: number;  // max 15
  mileage: number;        // max 10
  teslaFeatures: number;  // max 10
  sellerQuality: number;  // max 5
  logistics: number;      // max 5
  total: number;          // max 100
}

export interface Seller {
  name: string;
  type: SellerType;
  location: string;
  listingCount: number;
  responseRate: string;
  notes: string;
}

export interface VinCheck {
  vin: string;
  listingVin: string;
  checkDate: string;
  nhtsaMake: string;
  nhtsaModel: string;
  nhtsaModelYear: string;
  nhtsaTrim: string;
  driveline: string;
  bodyClass: string;
  recallCount: number;
  recallDetails: string;
  vinValid: boolean;
  discrepancies: string;
}

export interface OutreachRecord {
  listingVin: string;
  messageType: string;
  messageText: string;
  dateSent: string;
  channel: string;
  responseReceived: boolean;
  responseText: string;
  followUpDate: string;
}

export interface PriceHistory {
  listingVin: string;
  listingUrl: string;
  date: string;
  price: number;
  changeAmount: number;
  changePercent: number;
  source: string;
}

export interface AirtableIds {
  baseId: string;
  tables: {
    listings: string;
    sellers: string;
    vinChecks: string;
    outreach: string;
    priceHistory: string;
    settings: string;
  };
  fields: {
    listings: Record<string, string>;
    sellers: Record<string, string>;
    vinChecks: Record<string, string>;
    outreach: Record<string, string>;
    priceHistory: Record<string, string>;
    settings: Record<string, string>;
  };
}
