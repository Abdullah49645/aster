/**
 * TEST-ONLY in-memory implementation of the documented Neural Pulse contract (OpenAPI in
 * github.com/Raza-Abbas32/evorozen-sdk). Used to test ASTER's pipeline logic deterministically.
 * It is never imported by application code. Live behaviour is verified by scripts/pulse-probe.ts.
 *
 * vector_search is approximated with token-overlap similarity and returns a `score` field.
 * Options let tests simulate: no scores, failures, and arbitrary chat output.
 */
type Row = Record<string, unknown>;

export interface FakeOptions {
  vectorScores?: boolean;
  failActions?: Set<string>;
  chat?: (prompt: string) => string;
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !["the", "is", "at", "on", "to", "of", "and", "now", "a", "by"].includes(t)),
  );

export class FakePulse {
  tables = new Map<string, { pk: string; rows: Row[] }>();
  calls: { action: string; payload: unknown }[] = [];
  constructor(public opts: FakeOptions = {}) {}

  fetch = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const auth = new Headers(init?.headers).get("Authorization");
    this.calls.push({ action: body.action_type, payload: body.data_payload });
    if (!auth?.startsWith("Bearer ")) return this.res(401, { error: "Missing API key" });
    // Mirrors the LIVE API (observed 2026-09-30): every request needs a non-empty prompt.
    if (typeof body.prompt !== "string" || !body.prompt.trim()) return this.res(400, { error: "Bad Request. Prompt must be a valid non-empty string." });
    if (this.opts.failActions?.has(body.action_type)) return this.res(503, { error: "unavailable", traceId: "t-fail" });
    try {
      return this.res(200, { ...this.handle(body.action_type, body.data_payload ?? {}, body.prompt), traceId: `t-${this.calls.length}` });
    } catch (e) {
      return this.res(400, { error: String(e) });
    }
  };

  private res(status: number, json: unknown) {
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  }

  private table(name: string) {
    const t = this.tables.get(name);
    if (!t) throw new Error(`table ${name} not found`);
    return t;
  }

  private match(row: Row, filter?: Row) {
    return !filter || Object.entries(filter).every(([k, v]) => v === undefined || row[k] === v);
  }

  handle(action: string, p: Row, prompt?: string): Row {
    switch (action) {
      case "list_tables":
        return { tables: [...this.tables.keys()] };
      case "create_schema": {
        const created: string[] = [];
        for (const t of p.tables as { name: string; columns: { name: string; primary?: boolean }[] }[]) {
          if (!this.tables.has(t.name)) {
            this.tables.set(t.name, { pk: t.columns.find((c) => c.primary)?.name ?? "_id", rows: [] });
            created.push(t.name);
          }
        }
        return { executed: true, tables_created: created, errors: [] };
      }
      case "insert_data": {
        const t = this.table(p.table as string);
        const row: Row = { _id: `id${t.rows.length}`, ...(p.record as Row) };
        if (t.rows.some((r) => r[t.pk] === row[t.pk])) throw new Error("duplicate key");
        t.rows.push(row);
        return { action, table: p.table, row, status: "success" };
      }
      case "bulk_insert": {
        for (const record of p.records as Row[]) this.handle("insert_data", { table: p.table, record });
        return { action, table: p.table, status: "success", inserted: (p.records as Row[]).length };
      }
      case "select_data": {
        let rows = this.table(p.table as string).rows.filter((r) => this.match(r, p.filter as Row));
        if (p.limit) rows = rows.slice(0, p.limit as number);
        return { action, table: p.table, data: structuredClone(rows), status: "success" };
      }
      case "update_data": {
        // Mirrors the LIVE API (observed 2026-09-30): requires table, filter AND `changes`.
        if (!p.table || !p.filter || !p.changes) throw new Error("Table name, filter, and changes are required for update_data.");
        const t = this.table(p.table as string);
        let n = 0;
        for (const r of t.rows) if (this.match(r, p.filter as Row)) (Object.assign(r, p.changes as Row), n++);
        return { action, table: p.table, modified_count: n };
      }
      case "upsert_data": {
        const t = this.table(p.table as string);
        const rec = p.record as Row;
        const cols = (p.conflict_columns as string[]) ?? [t.pk];
        const existing = t.rows.find((r) => cols.every((c) => r[c] === rec[c]));
        if (existing) Object.assign(existing, rec);
        else t.rows.push({ _id: `id${t.rows.length}`, ...rec });
        return { action, table: p.table, status: "success" };
      }
      case "count_records":
        return { count: this.table(p.table as string).rows.filter((r) => this.match(r, p.filter as Row)).length };
      case "search": {
        const q = tokens(String(p.query));
        const rows = this.table(p.table as string).rows.filter((r) => [...tokens(String(r[p.column as string] ?? ""))].some((t) => q.has(t)));
        return { data: structuredClone(rows) };
      }
      case "vector_search": {
        const q = tokens(String(p.query));
        const scored = this.table(p.table as string)
          .rows.map((r) => {
            // Approximation: embed the human-readable text column. Which column(s) the real API embeds is
            // one of the questions scripts/pulse-probe.ts answers.
            const a = tokens(String(r.alias_text ?? r.raw_text ?? Object.values(r).filter((v) => typeof v === "string").join(" ")));
            const inter = [...q].filter((t) => a.has(t)).length;
            const score = inter === 0 ? 0 : inter / Math.sqrt(q.size * a.size);
            return { r, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, (p.limit as number) ?? 5);
        return { data: scored.map(({ r, score }) => (this.opts.vectorScores === false ? { ...r } : { ...r, score: Math.round(score * 1000) / 1000 })) };
      }
      case "chat":
        return { response: this.opts.chat ? this.opts.chat(prompt ?? "") : "I can help you design a schema." };
      default:
        throw new Error(`unsupported action ${action}`);
    }
  }
}
