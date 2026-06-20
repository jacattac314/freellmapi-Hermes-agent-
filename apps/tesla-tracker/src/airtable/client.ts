import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

const BASE = 'https://api.airtable.com/v0';
const META = 'https://api.airtable.com/v0/meta';

export class AirtableClient {
  private http: AxiosInstance;
  private baseId: string;

  constructor(baseId?: string) {
    this.baseId = baseId ?? config.airtable.baseId;
    this.http = axios.create({
      headers: {
        Authorization: `Bearer ${config.airtable.token}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // ---- Meta (base/table creation) ----

  async createBase(name: string, tables: unknown[]): Promise<{ id: string }> {
    const res = await this.http.post(`${META}/bases`, {
      name,
      workspaceId: config.airtable.workspaceId,
      tables,
    });
    return res.data;
  }

  async createTable(tablePayload: unknown): Promise<{ id: string; fields: Array<{ id: string; name: string }> }> {
    const res = await this.http.post(`${META}/bases/${this.baseId}/tables`, tablePayload);
    return res.data;
  }

  async createField(tableId: string, field: unknown): Promise<{ id: string; name: string }> {
    const res = await this.http.post(`${META}/bases/${this.baseId}/tables/${tableId}/fields`, field);
    return res.data;
  }

  async listTables(): Promise<Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }>> {
    const res = await this.http.get(`${META}/bases/${this.baseId}/tables`);
    return res.data.tables;
  }

  // ---- Records ----

  async listRecords(
    tableId: string,
    params: { filterByFormula?: string; fields?: string[]; maxRecords?: number } = {},
  ): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
    const query: Record<string, unknown> = {};
    if (params.filterByFormula) query.filterByFormula = params.filterByFormula;
    if (params.fields) query['fields[]'] = params.fields;
    if (params.maxRecords) query.maxRecords = params.maxRecords;

    const res = await this.http.get(`${BASE}/${this.baseId}/${tableId}`, { params: query });
    return res.data.records ?? [];
  }

  async createRecords(
    tableId: string,
    records: Array<{ fields: Record<string, unknown> }>,
  ): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
    // Airtable max 10 records per batch
    const results: Array<{ id: string; fields: Record<string, unknown> }> = [];
    for (let i = 0; i < records.length; i += 10) {
      const batch = records.slice(i, i + 10);
      const res = await this.http.post(`${BASE}/${this.baseId}/${tableId}`, { records: batch });
      results.push(...(res.data.records ?? []));
    }
    return results;
  }

  async updateRecords(
    tableId: string,
    records: Array<{ id: string; fields: Record<string, unknown> }>,
  ): Promise<void> {
    for (let i = 0; i < records.length; i += 10) {
      const batch = records.slice(i, i + 10);
      await this.http.patch(`${BASE}/${this.baseId}/${tableId}`, { records: batch });
    }
  }

  async upsertRecord(
    tableId: string,
    fields: Record<string, unknown>,
    filterByFormula: string,
  ): Promise<{ id: string; created: boolean }> {
    const existing = await this.listRecords(tableId, { filterByFormula, maxRecords: 1 });
    if (existing.length > 0) {
      await this.updateRecords(tableId, [{ id: existing[0].id, fields }]);
      return { id: existing[0].id, created: false };
    }
    const [created] = await this.createRecords(tableId, [{ fields }]);
    return { id: created.id, created: true };
  }
}
