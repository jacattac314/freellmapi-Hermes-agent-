import nodemailer from 'nodemailer';
import { EnrichedListing } from '../types';
import { config } from '../config';

function formatListingText(listing: EnrichedListing): string {
  return [
    `${listing.listingTitle}`,
    `Score: ${listing.score}/100 | Priority: ${listing.priority}`,
    `Price: $${listing.price.toLocaleString()} | Mileage: ${listing.mileage.toLocaleString()} mi`,
    `Location: ${listing.location} (${listing.distanceMiles} mi away)`,
    `VIN: ${listing.vin}`,
    `Source: ${listing.source}`,
    `FSD: ${listing.fsdStatus}`,
    `Warranty: ${listing.batteryWarrantyEstimate}`,
    listing.suspicionFlags.length > 0 ? `Flags: ${listing.suspicionFlags.join(', ')}` : '',
    `URL: ${listing.listingUrl}`,
    listing.aiSummary ? `\nAI Summary:\n${listing.aiSummary}` : '',
  ].filter(Boolean).join('\n');
}

function formatListingHtml(listing: EnrichedListing): string {
  const scoreColor = listing.score >= 80 ? '#16a34a' : listing.score >= 60 ? '#d97706' : '#dc2626';
  return `
<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;font-family:sans-serif">
  <h3 style="margin:0 0 8px">${listing.listingTitle}</h3>
  <p style="margin:0"><strong>Score:</strong> <span style="color:${scoreColor};font-weight:bold">${listing.score}/100</span> | Priority: <strong>${listing.priority}</strong></p>
  <p style="margin:4px 0"><strong>Price:</strong> $${listing.price.toLocaleString()} | <strong>Mileage:</strong> ${listing.mileage.toLocaleString()} mi</p>
  <p style="margin:4px 0"><strong>Location:</strong> ${listing.location} (${listing.distanceMiles} mi) | <strong>Source:</strong> ${listing.source}</p>
  <p style="margin:4px 0"><strong>VIN:</strong> ${listing.vin} | <strong>FSD:</strong> ${listing.fsdStatus}</p>
  <p style="margin:4px 0"><strong>Warranty:</strong> ${listing.batteryWarrantyEstimate}</p>
  ${listing.suspicionFlags.length > 0 ? `<p style="margin:4px 0;color:#dc2626"><strong>Flags:</strong> ${listing.suspicionFlags.join(', ')}</p>` : ''}
  ${listing.aiSummary ? `<p style="margin:8px 0;background:#f9fafb;padding:8px;border-radius:4px">${listing.aiSummary}</p>` : ''}
  <p style="margin:8px 0"><a href="${listing.listingUrl}" style="color:#2563eb">View Listing →</a></p>
</div>`;
}

async function sendEmail(subject: string, text: string, html: string): Promise<void> {
  if (!config.email.to || !config.email.smtp.user) {
    console.log(`[alert] Email not configured — logging alert:\n${text}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.port === 465,
    auth: { user: config.email.smtp.user, pass: config.email.smtp.pass },
  });

  await transporter.sendMail({
    from: `Tesla Tracker <${config.email.smtp.user}>`,
    to: config.email.to,
    subject,
    text,
    html,
  });

  console.log(`[alert] Email sent: ${subject}`);
}

export async function alertHighPriority(listings: EnrichedListing[]): Promise<void> {
  if (listings.length === 0) return;

  const subject = `Tesla Tracker: ${listings.length} High Priority Listing${listings.length > 1 ? 's' : ''} Found`;
  const text = listings.map(formatListingText).join('\n\n---\n\n');
  const html = `
<h2>High Priority Tesla Listings</h2>
<p>The following listing${listings.length > 1 ? 's' : ''} scored 80+ and ${listings.length > 1 ? 'are' : 'is'} ready for action:</p>
${listings.map(formatListingHtml).join('')}
<p style="color:#6b7280;font-size:12px">Sent by Tesla Tracker — running in your freellmapi monorepo.</p>`;

  await sendEmail(subject, text, html);
}

export async function alertPriceDrop(
  listing: EnrichedListing,
  oldPrice: number,
  newPrice: number,
): Promise<void> {
  const dropAmount = oldPrice - newPrice;
  const dropPct = ((dropAmount / oldPrice) * 100).toFixed(1);

  const subject = `Tesla Tracker: Price Drop $${dropAmount.toLocaleString()} (${dropPct}%) on ${listing.listingTitle}`;
  const text = `Price dropped from $${oldPrice.toLocaleString()} → $${newPrice.toLocaleString()} (−${dropPct}%)\n\n${formatListingText(listing)}`;
  const html = `
<h2>Price Drop Alert</h2>
<p>$${oldPrice.toLocaleString()} → <strong>$${newPrice.toLocaleString()}</strong> <span style="color:#16a34a">−${dropPct}% (−$${dropAmount.toLocaleString()})</span></p>
${formatListingHtml(listing)}`;

  await sendEmail(subject, text, html);
}

export async function sendDailySummary(
  newCount: number,
  updatedCount: number,
  removedCount: number,
  highPriority: EnrichedListing[],
): Promise<void> {
  if (!config.email.to) return;

  const subject = `Tesla Tracker Daily: ${newCount} new, ${highPriority.length} high priority`;
  const text = [
    `Daily Tesla Tracker Report`,
    `New listings: ${newCount}`,
    `Updated: ${updatedCount}`,
    `Removed: ${removedCount}`,
    `High Priority: ${highPriority.length}`,
    highPriority.length > 0 ? '\nHigh Priority Listings:\n' + highPriority.map(formatListingText).join('\n---\n') : '',
  ].filter(Boolean).join('\n');

  const html = `
<h2>Tesla Tracker Daily Summary</h2>
<p>New: <strong>${newCount}</strong> | Updated: <strong>${updatedCount}</strong> | Removed: <strong>${removedCount}</strong></p>
${highPriority.length > 0 ? `<h3>High Priority (${highPriority.length})</h3>${highPriority.map(formatListingHtml).join('')}` : '<p>No high priority listings today.</p>'}`;

  await sendEmail(subject, text, html);
}
