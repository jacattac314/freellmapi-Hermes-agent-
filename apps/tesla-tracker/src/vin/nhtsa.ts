import axios from 'axios';
import { VinCheck } from '../types';

const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const RECALLS_BASE = 'https://api.nhtsa.gov/recalls/recallsByVehicle';

interface VpicValue {
  Variable: string;
  Value: string | null;
}

interface DecodedVin {
  vin?: string;
  nhtsaMake?: string;
  nhtsaModel?: string;
  nhtsaModelYear?: string;
  nhtsaTrim?: string;
  driveline?: string;
  bodyClass?: string;
  vinValid?: boolean;
  discrepancies?: string;
}

export async function decodeVin(vin: string): Promise<DecodedVin> {
  if (!vin || vin.length !== 17) {
    return { vinValid: false, discrepancies: 'Invalid VIN length' };
  }

  try {
    const res = await axios.get(`${VPIC_BASE}/DecodeVinValues/${vin}?format=json`, {
      timeout: 10_000,
    });

    const results: VpicValue[] = res.data?.Results?.[0] ? Object.entries(res.data.Results[0]).map(([k, v]) => ({ Variable: k, Value: String(v) })) : [];

    const get = (key: string) => results.find((r) => r.Variable === key)?.Value ?? '';

    const make = get('Make');
    const model = get('Model');
    const year = get('ModelYear');
    const trim = get('Trim');
    const driveline = get('DriveType');
    const bodyClass = get('BodyClass');
    const errorCode = get('ErrorCode');

    const vinValid = !errorCode || errorCode === '0';
    const discrepancies: string[] = [];

    if (make && !make.toLowerCase().includes('tesla')) {
      discrepancies.push(`VIN decodes as ${make} ${model}, not Tesla`);
    }

    return {
      vin,
      nhtsaMake: make,
      nhtsaModel: model,
      nhtsaModelYear: year,
      nhtsaTrim: trim,
      driveline,
      bodyClass,
      vinValid,
      discrepancies: discrepancies.join('; '),
    };
  } catch {
    return { vin, vinValid: false, discrepancies: 'NHTSA vPIC request failed' } as DecodedVin;
  }
}

export interface RecallSummary {
  count: number;
  details: string;
}

export async function checkRecalls(make: string, model: string, year: number): Promise<RecallSummary> {
  try {
    const res = await axios.get(RECALLS_BASE, {
      params: { make, model, modelYear: year },
      timeout: 10_000,
    });

    const results: Array<{ NHTSACampaignNumber: string; Component: string; Summary: string; RemedyDescription: string }> =
      res.data?.results ?? [];

    if (results.length === 0) return { count: 0, details: 'No recalls found' };

    const details = results
      .slice(0, 5)
      .map(
        (r) =>
          `[${r.NHTSACampaignNumber}] ${r.Component}: ${r.Summary?.slice(0, 120)}`,
      )
      .join('\n');

    return { count: results.length, details };
  } catch {
    return { count: 0, details: 'Recall check unavailable' };
  }
}

export async function fullVinCheck(vin: string): Promise<VinCheck> {
  const decoded = await decodeVin(vin);
  const year = parseInt(decoded.nhtsaModelYear ?? '0', 10);
  const recalls = year
    ? await checkRecalls(decoded.nhtsaMake ?? 'Tesla', decoded.nhtsaModel ?? '', year)
    : { count: 0, details: '' };

  return {
    vin,
    listingVin: vin,
    checkDate: new Date().toISOString(),
    nhtsaMake: decoded.nhtsaMake ?? '',
    nhtsaModel: decoded.nhtsaModel ?? '',
    nhtsaModelYear: decoded.nhtsaModelYear ?? '',
    nhtsaTrim: decoded.nhtsaTrim ?? '',
    driveline: decoded.driveline ?? '',
    bodyClass: decoded.bodyClass ?? '',
    recallCount: recalls.count,
    recallDetails: recalls.details,
    vinValid: decoded.vinValid ?? false,
    discrepancies: decoded.discrepancies ?? '',
  };
}
