/**
 * One-time setup: creates the Airtable base + all tables and seeds Settings.
 * Run:  npm run setup  (from apps/tesla-tracker)
 *
 * After it finishes, paste the printed base ID into your .env as AIRTABLE_BASE_ID.
 */
import 'dotenv/config';
import { AirtableClient } from './client';
import { TABLES, DEFAULT_SETTINGS } from './schema';
import { config } from '../config';

async function setup() {
  if (!config.airtable.workspaceId) {
    console.error(
      '\n[setup] AIRTABLE_WORKSPACE_ID is not set.\n' +
        '  Find it in the Airtable URL when you open a workspace:\n' +
        '  https://airtable.com/<WORKSPACE_ID>/workspace/billing\n',
    );
    process.exit(1);
  }

  const client = new AirtableClient('placeholder'); // baseId not needed for createBase
  console.log('[setup] Creating Tesla Tracker base...');

  // Build table payloads for the create_base call.
  // Each table needs at least its primary field; we add remaining fields after.
  const tableDefs = TABLES.map((t) => {
    const primaryField = t.fields[0];
    const fieldPayload: Record<string, unknown> = { name: primaryField.name, type: primaryField.type };
    if (primaryField.options) fieldPayload.options = primaryField.options;
    return { name: t.name, description: t.description, fields: [fieldPayload] };
  });

  let baseId: string;
  try {
    const base = await client.createBase('Tesla Tracker', tableDefs);
    baseId = base.id;
    console.log(`[setup] Base created: ${baseId}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[setup] Failed to create base:', msg);
    if (msg.includes('401') || msg.includes('403')) {
      console.error(
        '  Check that your AIRTABLE_TOKEN has scopes: schema.bases:write, data.records:write',
      );
    }
    process.exit(1);
  }

  const finalClient = new AirtableClient(baseId);
  const existingTables = await finalClient.listTables();
  const tableIdMap: Record<string, string> = {};
  for (const t of existingTables) tableIdMap[t.name] = t.id;

  // Add remaining fields to each table
  for (const tableDef of TABLES) {
    const tableId = tableIdMap[tableDef.name];
    if (!tableId) {
      console.warn(`[setup] Table not found after creation: ${tableDef.name}`);
      continue;
    }
    console.log(`[setup] Adding fields to "${tableDef.name}"...`);
    for (const field of tableDef.fields.slice(1)) {
      const payload: Record<string, unknown> = { name: field.name, type: field.type };
      if (field.options) payload.options = field.options;
      try {
        await finalClient.createField(tableId, payload);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Some fields may already exist if the API created extras — skip
        if (!msg.includes('already exists')) {
          console.warn(`  [warn] Field "${field.name}": ${msg}`);
        }
      }
    }
  }

  // Seed Settings table
  const settingsTableId = tableIdMap['Settings'];
  if (settingsTableId) {
    console.log('[setup] Seeding Settings table...');
    const settingsTables = await finalClient.listTables();
    const settingsTable = settingsTables.find((t) => t.name === 'Settings');
    if (settingsTable) {
      const fieldMap: Record<string, string> = {};
      for (const f of settingsTable.fields) fieldMap[f.name] = f.id;

      const records = DEFAULT_SETTINGS.map((s) => ({
        fields: {
          [fieldMap['Key'] ?? 'Key']: s.key,
          [fieldMap['Value'] ?? 'Value']: s.value,
          [fieldMap['Description'] ?? 'Description']: s.description,
          [fieldMap['Last Updated'] ?? 'Last Updated']: new Date().toISOString().split('T')[0],
        },
      }));
      await finalClient.createRecords(settingsTableId, records);
    }
  }

  console.log('\n[setup] Done!\n');
  console.log(`  Add this to your .env:\n  AIRTABLE_BASE_ID=${baseId}\n`);
  console.log('  Then run: npm run run-once  to perform the first scan.');
}

setup().catch((err) => {
  console.error('[setup] Unexpected error:', err);
  process.exit(1);
});
