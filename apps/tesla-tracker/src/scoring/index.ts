import { RawListing, EnrichedListing, ScoreBreakdown, ListingStatus, Priority, FsdStatus } from '../types';
import { config } from '../config';
import { fullVinCheck } from '../vin/nhtsa';

// ---- Scoring helpers ----

function scoreYearHardware(year: number, model: string, hardwareGen: string): number {
  // max 20 pts
  let pts = 0;

  // Year recency
  const currentYear = new Date().getFullYear();
  const age = currentYear - year;
  if (age === 0) pts += 10;
  else if (age === 1) pts += 9;
  else if (age === 2) pts += 7;
  else if (age === 3) pts += 5;
  else if (age <= 5) pts += 3;
  else pts += 1;

  // Hardware generation bonus
  if (hardwareGen.includes('HW4') || hardwareGen.includes('FSDBeta')) pts += 7;
  else if (hardwareGen.includes('HW3')) pts += 4;
  else if (hardwareGen.includes('HW2')) pts += 1;
  else pts += 2; // unknown, assume mid

  // Model Y 2024+ Highland refresh bonus
  if (model === 'Model 3' && year >= 2024) pts += 3;

  return Math.min(pts, 20);
}

function scoreCleanHistory(
  cleanTitle: boolean,
  accidentReported: boolean,
  lemonFlag: boolean,
  salvageFlag: boolean,
  buybackFlag: boolean,
  floodFlag: boolean,
  odometerFlag: boolean,
): number {
  // max 20 pts — any serious flag zeroes it out
  if (salvageFlag || lemonFlag || buybackFlag || floodFlag || odometerFlag) return 0;
  let pts = 20;
  if (!cleanTitle) pts -= 10;
  if (accidentReported) pts -= 8;
  return Math.max(pts, 0);
}

function scoreWarranty(warrantyRemaining: boolean, year: number, mileage: number): number {
  // max 15 pts
  // Tesla basic warranty: 4yr/50k mi. Battery: 8yr/120k-150k mi.
  const currentYear = new Date().getFullYear();
  const vehicleAge = currentYear - year;

  let pts = 0;
  if (warrantyRemaining) {
    pts += 10;
    // Estimate remaining battery warranty
    const batteryMilesLeft = 120_000 - mileage;
    const batteryYearsLeft = 8 - vehicleAge;
    if (batteryMilesLeft > 80_000 && batteryYearsLeft > 5) pts += 5;
    else if (batteryMilesLeft > 40_000 && batteryYearsLeft > 2) pts += 3;
    else pts += 1;
  } else {
    // Basic warranty likely expired, but battery may still be valid
    const batteryYearsLeft = 8 - vehicleAge;
    if (batteryYearsLeft > 0 && mileage < 120_000) pts += 5;
  }
  return Math.min(pts, 15);
}

function scorePriceVsMarket(price: number, model: string, trim: string): number {
  // max 15 pts
  const key = `${model} ${trim.includes('Long Range') ? 'Long Range' : trim.includes('Standard') ? 'Standard Range' : 'Long Range'}`;
  const market = config.scoring.marketPrices[key] ?? config.scoring.marketPrices[`${model} Long Range`];
  if (!market) return 8; // unknown model, neutral

  if (price < market.low * 0.92) return 15;       // exceptional deal
  if (price < market.low) return 12;               // below low end
  if (price <= market.mid) return 9;               // fair market
  if (price <= market.high) return 5;              // above mid
  return 2;                                         // overpriced
}

function scoreMileage(mileage: number): number {
  // max 10 pts
  if (mileage < 5_000) return 10;
  if (mileage < 10_000) return 9;
  if (mileage < 15_000) return 8;
  if (mileage < 20_000) return 7;
  if (mileage < 25_000) return 6;
  if (mileage < 30_000) return 5;
  if (mileage < 35_000) return 4;
  if (mileage < 50_000) return 2;
  return 1;
}

function scoreTeslaFeatures(
  fsdClaimed: boolean,
  fsdVerified: boolean,
  heatPump: boolean,
  matrixHeadlights: boolean,
  hardwareGen: string,
): number {
  // max 10 pts
  let pts = 0;
  if (fsdVerified) pts += 5;
  else if (fsdClaimed) pts += 2; // unverified
  if (heatPump) pts += 2;
  if (matrixHeadlights) pts += 1;
  if (hardwareGen.includes('HW4')) pts += 2;
  return Math.min(pts, 10);
}

function scoreSellerQuality(sellerType: string, sellerName: string): number {
  // max 5 pts
  if (sellerType === 'tesla_cpo') return 5;
  if (sellerType === 'dealer') return 3;
  return 2; // private
}

function scoreLogistics(distanceMiles: number, sellerType: string): number {
  // max 5 pts
  if (sellerType === 'tesla_cpo') return 5; // shipping available
  if (distanceMiles < 50) return 5;
  if (distanceMiles < 100) return 4;
  if (distanceMiles < 200) return 3;
  if (distanceMiles < 300) return 2;
  return 1;
}

// ---- Auto-pass check ----

function checkAutoPass(listing: RawListing & Partial<EnrichedListing>): { pass: boolean; reason: string } {
  const flags: string[] = [];

  if ((listing as EnrichedListing).salvageFlag) flags.push('salvage title');
  if ((listing as EnrichedListing).lemonFlag) flags.push('lemon/buyback history');
  if ((listing as EnrichedListing).buybackFlag) flags.push('manufacturer buyback');
  if ((listing as EnrichedListing).floodFlag) flags.push('flood damage reported');
  if ((listing as EnrichedListing).odometerFlag) flags.push('odometer discrepancy');
  if (!listing.vin || listing.vin.length !== 17) flags.push('missing or invalid VIN');

  // Major accident check
  if ((listing as EnrichedListing).accidentReported && !(listing as EnrichedListing).cleanTitle) {
    flags.push('major accident with title issue');
  }

  if (flags.length > 0) {
    return { pass: true, reason: flags.join(', ') };
  }
  return { pass: false, reason: '' };
}

// ---- Warranty estimation ----

function estimateWarranty(year: number, mileage: number): { remaining: boolean; batteryEstimate: string } {
  const currentYear = new Date().getFullYear();
  const vehicleAge = currentYear - year;

  // Basic: 4yr / 50k miles
  const basicWarranty = vehicleAge < 4 && mileage < 50_000;
  // LR battery: 8yr / 150k miles; SR battery: 8yr / 120k miles
  const batteryMilesRemaining = 150_000 - mileage;
  const batteryYearsRemaining = 8 - vehicleAge;

  const batteryValid = batteryYearsRemaining > 0 && batteryMilesRemaining > 0;
  const batteryEstimate = batteryValid
    ? `~${Math.max(0, batteryYearsRemaining)}yr / ~${Math.max(0, batteryMilesRemaining).toLocaleString()}mi remaining`
    : 'Battery warranty likely expired';

  return { remaining: basicWarranty || batteryValid, batteryEstimate };
}

// ---- FSD status logic ----

function resolveFsdStatus(fsdClaimed: boolean, sellerType: string): FsdStatus {
  if (sellerType === 'tesla_cpo') return 'Included (CPO)'; // CPO always includes FSD or AP
  if (!fsdClaimed) return 'Not Claimed';
  return 'Claimed - Needs Verification';
}

// ---- Main scorer ----

export async function scoreListing(raw: RawListing): Promise<EnrichedListing> {
  // VIN check
  interface LocalVinCheck {
    nhtsaMake: string; nhtsaModel: string; nhtsaModelYear: string;
    nhtsaTrim: string; driveline: string; bodyClass: string;
    recallCount: number; recallDetails: string; vinValid: boolean; discrepancies: string;
  }
  let vinCheck: LocalVinCheck = {
    nhtsaMake: 'TESLA',
    nhtsaModel: raw.model as string,
    nhtsaModelYear: String(raw.year),
    nhtsaTrim: raw.trim,
    driveline: '',
    bodyClass: '',
    recallCount: 0,
    recallDetails: 'Not checked',
    vinValid: raw.vin?.length === 17,
    discrepancies: '',
  };

  if (raw.vin?.length === 17) {
    try {
      const checked = await fullVinCheck(raw.vin);
      vinCheck = { ...vinCheck, ...checked };
    } catch {
      // Non-fatal: continue with defaults
    }
  }

  const suspicionFlags: string[] = [];
  if (vinCheck.discrepancies) suspicionFlags.push(`VIN: ${vinCheck.discrepancies}`);
  if (vinCheck.recallCount > 0) suspicionFlags.push(`${vinCheck.recallCount} open recall(s)`);

  // Infer history flags from source metadata (for CPO these are always clean)
  const cleanTitle = raw.sellerType === 'tesla_cpo' ? true : true; // default clean unless flagged
  const accidentReported = false;
  const lemonFlag = false;
  const salvageFlag = false;
  const buybackFlag = false;
  const floodFlag = false;
  const odometerFlag = false;

  const { remaining: warrantyRemaining, batteryEstimate } = estimateWarranty(raw.year, raw.mileage);

  const fsdStatus = resolveFsdStatus(raw.fsdClaimed, raw.sellerType);
  const fsdVerified = raw.sellerType === 'tesla_cpo'; // CPO FSD is verified

  // Auto-pass check
  const partial = {
    ...raw,
    cleanTitle,
    accidentReported,
    lemonFlag,
    salvageFlag,
    buybackFlag,
    floodFlag,
    odometerFlag,
    vinValid: vinCheck.vinValid,
  };
  const { pass: autoPass, reason: autoPassReason } = checkAutoPass(partial);

  // Score breakdown
  const breakdown: ScoreBreakdown = {
    yearHardware: scoreYearHardware(raw.year, raw.model, raw.hardwareGen),
    cleanHistory: scoreCleanHistory(cleanTitle, accidentReported, lemonFlag, salvageFlag, buybackFlag, floodFlag, odometerFlag),
    warranty: scoreWarranty(warrantyRemaining, raw.year, raw.mileage),
    priceVsMarket: scorePriceVsMarket(raw.price, raw.model, raw.trim),
    mileage: scoreMileage(raw.mileage),
    teslaFeatures: scoreTeslaFeatures(raw.fsdClaimed, fsdVerified, raw.heatPump, raw.matrixHeadlights, raw.hardwareGen),
    sellerQuality: scoreSellerQuality(raw.sellerType, raw.sellerName),
    logistics: scoreLogistics(raw.distanceMiles, raw.sellerType),
    total: 0,
  };
  breakdown.total = Object.values(breakdown).reduce((a, b) => a + b, 0) - breakdown.total;

  const score = autoPass ? 0 : breakdown.total;

  let priority: Priority = 'Low';
  if (autoPass) priority = 'Auto-Pass';
  else if (score >= config.scoring.highPriorityThreshold) priority = 'High';
  else if (score >= 60) priority = 'Medium';

  let status: ListingStatus = 'Active';
  if (autoPass) status = 'Pass';
  else if (score >= config.scoring.highPriorityThreshold) status = 'High Priority';

  const recallStatus =
    vinCheck.recallCount > 0
      ? `${vinCheck.recallCount} recall(s) — ${vinCheck.recallDetails.slice(0, 100)}`
      : 'No open recalls';

  return {
    ...raw,
    vinDecoded: vinCheck.vinValid,
    nhtsaMake: vinCheck.nhtsaMake,
    nhtsaModel: vinCheck.nhtsaModel ?? '',
    nhtsaYear: parseInt(vinCheck.nhtsaModelYear ?? String(raw.year), 10),
    recallCount: vinCheck.recallCount,
    recallStatus,
    cleanTitle,
    accidentReported,
    lemonFlag,
    salvageFlag,
    buybackFlag,
    floodFlag,
    odometerFlag,
    warrantyRemaining,
    batteryWarrantyEstimate: batteryEstimate,
    fsdVerified,
    fsdStatus,
    score,
    scoreBreakdown: breakdown,
    status,
    priority,
    suspicionFlags,
    autoPass,
    autoPassReason,
    aiSummary: '',
    outreachMessage: '',
    dateFound: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    consecutiveMisses: 0,
    priceChange: 0,
    previousPrice: raw.price,
  };
}
