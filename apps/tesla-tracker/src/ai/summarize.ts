import axios from 'axios';
import { EnrichedListing } from '../types';
import { config } from '../config';

async function callLlm(prompt: string): Promise<string> {
  try {
    const res = await axios.post(
      `${config.llm.baseUrl}/chat/completions`,
      {
        model: config.llm.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: `Bearer ${config.llm.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      },
    );
    return res.data?.choices?.[0]?.message?.content?.trim() ?? '';
  } catch {
    return '';
  }
}

export async function generateAiSummary(listing: EnrichedListing): Promise<string> {
  const prompt = `You are helping a buyer evaluate a used Tesla. Write a concise 3-4 sentence summary of this listing's key strengths, weaknesses, and whether it's worth pursuing. Be direct and practical.

Listing:
- ${listing.year} Tesla ${listing.model} ${listing.trim}
- Price: $${listing.price.toLocaleString()}
- Mileage: ${listing.mileage.toLocaleString()} miles
- Location: ${listing.location} (${listing.distanceMiles} miles away)
- Source: ${listing.source}
- Score: ${listing.score}/100 (${listing.priority} priority)
- Clean Title: ${listing.cleanTitle ? 'Yes' : 'No'}
- Accident History: ${listing.accidentReported ? 'Yes — flagged' : 'None reported'}
- Warranty Remaining: ${listing.warrantyRemaining ? 'Yes' : 'No'} — ${listing.batteryWarrantyEstimate}
- FSD: ${listing.fsdStatus}
- Hardware: ${listing.hardwareGen}
- Heat Pump: ${listing.heatPump ? 'Yes' : 'No'}
- Recalls: ${listing.recallStatus}
- Score Breakdown: History ${listing.scoreBreakdown.cleanHistory}/20, Warranty ${listing.scoreBreakdown.warranty}/15, Price ${listing.scoreBreakdown.priceVsMarket}/15, Mileage ${listing.scoreBreakdown.mileage}/10
${listing.suspicionFlags.length > 0 ? `- Flags: ${listing.suspicionFlags.join(', ')}` : ''}
${listing.autoPass ? `- AUTO-PASS: ${listing.autoPassReason}` : ''}

Summary:`;

  const summary = await callLlm(prompt);
  if (!summary) {
    // Fallback to rule-based summary
    const parts: string[] = [];
    if (listing.autoPass) parts.push(`AUTO-PASS: ${listing.autoPassReason}.`);
    else {
      parts.push(`${listing.year} Tesla ${listing.model} ${listing.trim} at $${listing.price.toLocaleString()} with ${listing.mileage.toLocaleString()} miles.`);
      if (listing.warrantyRemaining) parts.push(`Warranty remaining: ${listing.batteryWarrantyEstimate}.`);
      if (listing.fsdStatus !== 'Not Claimed') parts.push(`FSD: ${listing.fsdStatus}.`);
      if (listing.recallCount > 0) parts.push(`${listing.recallCount} open recall(s) — verify status.`);
      parts.push(`Score: ${listing.score}/100 (${listing.priority}).`);
    }
    return parts.join(' ');
  }
  return summary;
}

export async function generateOutreachMessage(listing: EnrichedListing): Promise<string> {
  if (listing.sellerType === 'tesla_cpo') {
    return `This is a Tesla Certified Pre-Owned listing — no outreach needed. Schedule a test drive through Tesla's website.`;
  }

  const prompt = `Write a short, professional inquiry message for a used car listing. The buyer is interested but wants to verify a few things before committing. Keep it under 120 words, friendly but focused.

Vehicle: ${listing.year} Tesla ${listing.model} ${listing.trim}
Price: $${listing.price.toLocaleString()}
VIN: ${listing.vin}
FSD claimed: ${listing.fsdClaimed ? 'Yes — needs verification' : 'Not listed'}
Key questions to ask:
1. Is the VIN ${listing.vin} correct and can they share a Carfax/AutoCheck?
2. Does the car have any accident history not listed?
${listing.fsdClaimed ? '3. Can they confirm FSD is transferable and provide the Tesla account subscription status?' : ''}
4. Is an independent pre-purchase inspection allowed?

Message:`;

  const msg = await callLlm(prompt);
  if (!msg) {
    return [
      `Hi, I'm interested in your ${listing.year} Tesla ${listing.model} ${listing.trim} (VIN: ${listing.vin}).`,
      `Could you confirm there's no accident history and share a vehicle history report?`,
      listing.fsdClaimed ? `Also, can you confirm FSD is included and transferable?` : '',
      `Would you allow a pre-purchase inspection by an independent Tesla-familiar shop?`,
      `Thank you!`,
    ].filter(Boolean).join(' ');
  }
  return msg;
}
