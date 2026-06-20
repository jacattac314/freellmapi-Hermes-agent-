// Defines the Airtable table+field schema for the Tesla Tracker base.
// Used both by setup.ts (to create the base) and client.ts (to map field names).

export interface FieldDef {
  name: string;
  type: string;
  options?: Record<string, unknown>;
}

export interface TableDef {
  name: string;
  description: string;
  fields: FieldDef[];
}

const dt = (tz = 'America/New_York') => ({
  dateFormat: { name: 'us' },
  timeFormat: { name: '12hour' },
  timeZone: tz,
});

const date = () => ({ dateFormat: { name: 'us' as const } });

const select = (...choices: Array<string | { name: string; color?: string }>) => ({
  choices: choices.map((c) => (typeof c === 'string' ? { name: c } : c)),
});

export const TABLES: TableDef[] = [
  {
    name: 'Listings',
    description: 'One record per unique VIN/URL combination. Upserted on every scan.',
    fields: [
      { name: 'Listing Title', type: 'singleLineText' },
      { name: 'Score', type: 'number', options: { precision: 0 } },
      {
        name: 'Status',
        type: 'singleSelect',
        options: select(
          { name: 'Active', color: 'greenBright' },
          { name: 'High Priority', color: 'yellowBright' },
          { name: 'Watching', color: 'blueBright' },
          { name: 'Contacted', color: 'purpleBright' },
          { name: 'Removed', color: 'grayBright' },
          { name: 'Purchased', color: 'tealBright' },
          { name: 'Pass', color: 'redBright' },
        ),
      },
      {
        name: 'Priority',
        type: 'singleSelect',
        options: select(
          { name: 'High', color: 'redBright' },
          { name: 'Medium', color: 'orangeBright' },
          { name: 'Low', color: 'yellowBright' },
          { name: 'Auto-Pass', color: 'grayBright' },
        ),
      },
      { name: 'Model', type: 'singleSelect', options: select('Model Y', 'Model 3', 'Model X', 'Model S') },
      { name: 'Year', type: 'number', options: { precision: 0 } },
      { name: 'Trim', type: 'singleLineText' },
      { name: 'Price', type: 'currency', options: { precision: 0, symbol: '$' } },
      { name: 'Mileage', type: 'number', options: { precision: 0 } },
      { name: 'VIN', type: 'singleLineText' },
      { name: 'Location', type: 'singleLineText' },
      { name: 'Distance (mi)', type: 'number', options: { precision: 0 } },
      {
        name: 'Seller Type',
        type: 'singleSelect',
        options: select('Tesla CPO', 'Dealer', 'Private'),
      },
      { name: 'Seller Name', type: 'singleLineText' },
      { name: 'Listing URL', type: 'url' },
      {
        name: 'Source',
        type: 'singleSelect',
        options: select('Tesla CPO', 'CarGurus', 'AutoTrader', 'Craigslist', 'Private'),
      },
      { name: 'Date Found', type: 'date', options: date() },
      { name: 'Last Seen', type: 'date', options: date() },
      { name: 'Price Change ($)', type: 'currency', options: { precision: 0, symbol: '$' } },
      { name: 'Previous Price', type: 'currency', options: { precision: 0, symbol: '$' } },
      {
        name: 'Clean Title',
        type: 'checkbox',
        options: { icon: 'check', color: 'greenBright' },
      },
      {
        name: 'Accident Reported',
        type: 'checkbox',
        options: { icon: 'xCheckbox', color: 'redBright' },
      },
      {
        name: 'Lemon / Buyback / Salvage / Flood Flag',
        type: 'checkbox',
        options: { icon: 'flag', color: 'redBright' },
      },
      { name: 'Recall Status', type: 'singleLineText' },
      {
        name: 'Warranty Remaining',
        type: 'checkbox',
        options: { icon: 'check', color: 'greenBright' },
      },
      { name: 'Battery Warranty Estimate', type: 'singleLineText' },
      {
        name: 'FSD Claimed',
        type: 'checkbox',
        options: { icon: 'check', color: 'blueBright' },
      },
      {
        name: 'FSD Status',
        type: 'singleSelect',
        options: select(
          { name: 'Not Claimed', color: 'grayBright' },
          { name: 'Claimed - Needs Verification', color: 'orangeBright' },
          { name: 'Verified', color: 'greenBright' },
          { name: 'Included (CPO)', color: 'blueBright' },
        ),
      },
      { name: 'Hardware Generation', type: 'singleLineText' },
      {
        name: 'Heat Pump',
        type: 'checkbox',
        options: { icon: 'check', color: 'orangeBright' },
      },
      {
        name: 'Matrix Headlights',
        type: 'checkbox',
        options: { icon: 'check', color: 'yellowBright' },
      },
      { name: 'Seller Response', type: 'multilineText' },
      { name: 'Questions Sent', type: 'multilineText' },
      { name: 'Suspicion Flags', type: 'multilineText' },
      { name: 'AI Summary', type: 'multilineText' },
      { name: 'Next Action', type: 'singleLineText' },
      { name: 'Consecutive Misses', type: 'number', options: { precision: 0 } },
      { name: 'Score Breakdown', type: 'multilineText' },
      { name: 'Auto-Pass Reason', type: 'singleLineText' },
    ],
  },
  {
    name: 'Sellers',
    description: 'Dealerships and private sellers encountered during search.',
    fields: [
      { name: 'Seller Name', type: 'singleLineText' },
      { name: 'Type', type: 'singleSelect', options: select('Tesla CPO', 'Dealer', 'Private') },
      { name: 'Location', type: 'singleLineText' },
      { name: 'Active Listing Count', type: 'number', options: { precision: 0 } },
      { name: 'Response Rate', type: 'singleLineText' },
      { name: 'Notes', type: 'multilineText' },
    ],
  },
  {
    name: 'VIN Checks',
    description: 'NHTSA vPIC decode and recall results for each VIN inspected.',
    fields: [
      { name: 'VIN', type: 'singleLineText' },
      { name: 'Check Date', type: 'date', options: date() },
      { name: 'NHTSA Make', type: 'singleLineText' },
      { name: 'NHTSA Model', type: 'singleLineText' },
      { name: 'NHTSA Year', type: 'singleLineText' },
      { name: 'NHTSA Trim', type: 'singleLineText' },
      { name: 'Driveline', type: 'singleLineText' },
      { name: 'Body Class', type: 'singleLineText' },
      { name: 'Recall Count', type: 'number', options: { precision: 0 } },
      { name: 'Recall Details', type: 'multilineText' },
      { name: 'VIN Valid', type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
      { name: 'Discrepancies', type: 'multilineText' },
    ],
  },
  {
    name: 'Outreach',
    description: 'Messages sent to sellers and their responses.',
    fields: [
      { name: 'Listing VIN', type: 'singleLineText' },
      {
        name: 'Message Type',
        type: 'singleSelect',
        options: select('Initial Inquiry', 'Follow-up', 'Inspection Request', 'Offer', 'Counter'),
      },
      { name: 'Message Text', type: 'multilineText' },
      { name: 'Date Sent', type: 'date', options: date() },
      {
        name: 'Channel',
        type: 'singleSelect',
        options: select('Email', 'Phone', 'Text', 'Platform Message', 'In Person'),
      },
      {
        name: 'Response Received',
        type: 'checkbox',
        options: { icon: 'check', color: 'greenBright' },
      },
      { name: 'Response Text', type: 'multilineText' },
      { name: 'Follow-up Date', type: 'date', options: date() },
    ],
  },
  {
    name: 'Price History',
    description: 'Every price change observed for a listing.',
    fields: [
      { name: 'Listing VIN', type: 'singleLineText' },
      { name: 'Listing URL', type: 'url' },
      { name: 'Date', type: 'date', options: date() },
      { name: 'Price', type: 'currency', options: { precision: 0, symbol: '$' } },
      { name: 'Change ($)', type: 'currency', options: { precision: 0, symbol: '$' } },
      { name: 'Change (%)', type: 'percent', options: { precision: 2 } },
      { name: 'Source', type: 'singleLineText' },
    ],
  },
  {
    name: 'Settings',
    description: 'Runtime configuration and search parameters.',
    fields: [
      { name: 'Key', type: 'singleLineText' },
      { name: 'Value', type: 'singleLineText' },
      { name: 'Description', type: 'multilineText' },
      { name: 'Last Updated', type: 'date', options: date() },
    ],
  },
];

export const DEFAULT_SETTINGS = [
  { key: 'search_radius_miles', value: '300', description: 'Max distance from home ZIP' },
  { key: 'max_mileage', value: '35000', description: 'Reject listings above this mileage' },
  { key: 'max_price', value: '65000', description: 'Reject listings above this price' },
  { key: 'min_score_alert', value: '80', description: 'Alert threshold for high priority' },
  { key: 'price_drop_alert_pct', value: '2', description: 'Alert on price drops >= this percent' },
  { key: 'removal_threshold', value: '3', description: 'Mark removed after N consecutive misses' },
  { key: 'targets', value: 'Model Y LR AWD 2023+, Model 3 LR 2024+, Model X (exceptional)', description: 'Priority order' },
  { key: 'last_run', value: '', description: 'ISO timestamp of the last successful run' },
];
