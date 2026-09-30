/**
 * Evorozen Neural Pulse client.
 *
 * Contract source: openapi.yaml + official TS SDK in github.com/Raza-Abbas32/evorozen-sdk (MIT),
 * and https://pulse.evorozen.com/docs. Single endpoint, POST, Bearer auth, `action_type` + `data_payload`.
 *
 * Where the docs page and the OpenAPI spec disagree (docs: `where`/`changes`; OpenAPI + SDK:
 * `filter`/`updates`), this client follows the OpenAPI spec. scripts/pulse-probe.ts verifies against
 * the live API.
 *
 * SERVER-ONLY. Never import from a client component.
 */

export type PulseAction =
  | "chat"
  | "create_schema"
  | "insert_data"
  | "bulk_insert"
  | "select_data"
  | "update_data"
  | "upsert_data"
  | "delete_data"
  | "bulk_delete"
  | "count_records"
  | "paginate"
  | "aggregate"
  | "search"
  | "list_tables"
  | "get_schema"
  | "alter_schema"
  | "drop_table"
  | "analytics"
  | "vector_search"
  | "audit_logs";

export type Row = Record<string, unknown>;

export class PulseError extends Error {
  constructor(
    message: string,
    readonly kind: "config" | "network" | "timeout" | "http" | "parse",
    readonly status?: number,
    readonly traceId?: string,
    readonly action?: PulseAction,
  ) {
    super(message);
    this.name = "PulseError";
  }
  /** True when the failure says nothing about our request being wrong (fall back is reasonable). */
  get transient(): boolean {
    return this.kind === "network" || this.kind === "timeout" || this.status === 429 || (this.status ?? 0) >= 500;
  }
  /** Worth retrying immediately. Not 429: with a small quota, retrying a limit error only burns another call. */
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "timeout" || (this.status ?? 0) >= 500;
  }
  /** The key has hit a usage limit (as opposed to our request being wrong). */
  get quota(): boolean {
    if (this.status === 429 || this.status === 402) return true;
    return (this.status === 403 || this.status === 400) && /limit|quota|exceed|credit|too many/i.test(this.message);
  }
}

export interface PulseCall {
  action: PulseAction;
  ms: number;
  status: number | null;
  traceId?: string;
  ok: boolean;
}

export interface PulseClientOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  /** Called after every request — used to build the visible pipeline trace. */
  onCall?: (call: PulseCall) => void;
}

const DEFAULT_URL = "https://pulse.evorozen.com/api/neural";
/** Writes that are not safe to repeat automatically (upsert/update by key are). */
const NON_IDEMPOTENT = new Set<PulseAction>(["insert_data", "bulk_insert", "chat"]);

export class PulseClient {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  onCall?: (call: PulseCall) => void;

  constructor(private readonly opts: PulseClientOptions) {
    this.url = opts.baseUrl || DEFAULT_URL;
    // Live Pulse calls were observed at 2–14 s (bulk_insert ~13 s), so allow generous headroom.
    this.timeoutMs = opts.timeoutMs ?? (Number(process.env.ASTER_PULSE_TIMEOUT_MS) || 45_000);
    this.retries = opts.retries ?? 1;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onCall = opts.onCall;
  }

  get configured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  async request<T = Record<string, unknown>>(action: PulseAction, dataPayload?: Record<string, unknown>, prompt?: string): Promise<T> {
    if (!this.opts.apiKey) throw new PulseError("No Neural Pulse key is configured on the server (EVOROZEN_API_KEYS).", "config", undefined, undefined, action);
    // The live API rejects any request without a non-empty `prompt` ("Prompt must be a valid non-empty
    // string"), even for data actions where the OpenAPI spec marks it optional. Data actions get a short,
    // literal description of the operation so it can never be read as a different instruction.
    const body: Record<string, unknown> = { action_type: action, prompt: prompt && prompt.trim() ? prompt : describeAction(action, dataPayload) };
    if (dataPayload !== undefined) body.data_payload = dataPayload;

    let attempt = 0;
    for (;;) {
      const t0 = Date.now();
      let status: number | null = null;
      try {
        const res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: "no-store",
        });
        status = res.status;
        const text = await res.text();
        let json: Record<string, unknown>;
        try {
          json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
        } catch {
          this.onCall?.({ action, ms: Date.now() - t0, status, ok: false });
          throw new PulseError(`Neural Pulse returned non-JSON (${status}).`, "parse", status, undefined, action);
        }
        const traceId = typeof json.traceId === "string" ? json.traceId : undefined;
        if (!res.ok) {
          this.onCall?.({ action, ms: Date.now() - t0, status, traceId, ok: false });
          const msg = typeof json.error === "string" ? json.error : `Neural Pulse ${action} failed with ${status}.`;
          const err = new PulseError(msg, "http", status, traceId, action);
          if (err.retryable && attempt < this.retries && !NON_IDEMPOTENT.has(action)) {
            attempt++;
            await sleep(400 * attempt);
            continue;
          }
          throw err;
        }
        this.onCall?.({ action, ms: Date.now() - t0, status, traceId, ok: true });
        return json as T;
      } catch (e) {
        if (e instanceof PulseError) throw e;
        const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
        this.onCall?.({ action, ms: Date.now() - t0, status, ok: false });
        const err = new PulseError(
          timeout ? `Neural Pulse did not answer within ${this.timeoutMs / 1000}s.` : `Could not reach Neural Pulse: ${String(e)}`,
          timeout ? "timeout" : "network",
          undefined,
          undefined,
          action,
        );
        // A timed-out insert may still have been applied; retrying it could duplicate rows.
        if (attempt < this.retries && !NON_IDEMPOTENT.has(action)) {
          attempt++;
          await sleep(400 * attempt);
          continue;
        }
        throw err;
      }
    }
  }

  // ---- Typed helpers (OpenAPI payload shapes) ----

  listTables(): Promise<Record<string, unknown>> {
    return this.request("list_tables");
  }

  createSchema(tables: { name: string; columns: { name: string; type: string; primary?: boolean; nullable?: boolean }[] }[]) {
    return this.request("create_schema", { tables });
  }

  insert(table: string, record: Row) {
    return this.request("insert_data", { table, record });
  }

  bulkInsert(table: string, records: Row[]) {
    return this.request("bulk_insert", { table, records });
  }

  async select(table: string, opts: { filter?: Row; columns?: string[]; limit?: number; order_by?: string; order_dir?: "asc" | "desc" } = {}): Promise<Row[]> {
    const res = await this.request("select_data", { table, ...opts });
    return extractRows(res);
  }

  /**
   * The live API requires `filter` + `changes` for update_data ("Table name, filter, and changes are
   * required", observed 2026-09-30). The OpenAPI spec's `updates` key is rejected.
   */
  update(table: string, filter: Row, changes: Row) {
    return this.request("update_data", { table, filter, changes });
  }

  /**
   * Insert-or-update by key. If the live API rejects the upsert request shape (a 400 that is not a limit
   * error), fall back to update_data + insert_data, both verified against the live service.
   */
  async upsert(table: string, record: Row, conflictColumns: string[]): Promise<Record<string, unknown>> {
    try {
      return await this.request("upsert_data", { table, record, conflict_columns: conflictColumns });
    } catch (e) {
      if (!(e instanceof PulseError && e.kind === "http" && e.status === 400 && !e.quota)) throw e;
      const filter = Object.fromEntries(conflictColumns.map((c) => [c, record[c]]));
      const res = await this.update(table, filter, record);
      const modified = Number((res as Row).modified_count ?? (res as Row).updated ?? (res as Row).count ?? NaN);
      if (modified === 0) return this.insert(table, record);
      if (Number.isNaN(modified)) {
        // Unknown response shape: check whether the row exists before inserting.
        const rows = await this.select(table, { filter, limit: 1 });
        if (rows.length === 0) return this.insert(table, record);
      }
      return res;
    }
  }

  async count(table: string, filter?: Row): Promise<number> {
    const res = await this.request("count_records", { table, filter });
    const c = (res as Record<string, unknown>).count ?? (res as { data?: { count?: unknown } }).data?.count;
    return typeof c === "number" ? c : Number(c ?? 0);
  }

  async search(table: string, column: string, query: string): Promise<Row[]> {
    return extractRows(await this.request("search", { table, column, query }));
  }

  async vectorSearch(table: string, query: string, limit = 5): Promise<Row[]> {
    return extractRows(await this.request("vector_search", { table, query, limit }));
  }

  chat(prompt: string): Promise<{ response?: string; traceId?: string; [k: string]: unknown }> {
    return this.request("chat", undefined, prompt);
  }
}

/** A literal, one-line description of a data action, sent as the required `prompt`. */
export function describeAction(action: PulseAction, payload?: Record<string, unknown>): string {
  const table = payload && typeof payload.table === "string" ? ` on table ${payload.table}` : "";
  return `Run ${action}${table} exactly as specified in data_payload.`;
}

/** Response row arrays are returned under `data` per the OpenAPI spec; tolerate close variants. */
export function extractRows(res: unknown): Row[] {
  if (!res || typeof res !== "object") return [];
  const r = res as Record<string, unknown>;
  for (const key of ["data", "rows", "results", "records", "matches"]) {
    const v = r[key];
    if (Array.isArray(v)) return v.filter((x): x is Row => Boolean(x) && typeof x === "object");
    if (v && typeof v === "object") {
      const inner = extractRows(v);
      if (inner.length) return inner;
    }
  }
  return [];
}

export function tableNames(res: unknown): string[] {
  if (!res || typeof res !== "object") return [];
  const r = res as Record<string, unknown>;
  const candidates = [r.tables, r.data, (r.data as Record<string, unknown> | undefined)?.tables];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c
        .map((t) => (typeof t === "string" ? t : t && typeof t === "object" ? String((t as Row).name ?? (t as Row).table ?? "") : ""))
        .filter(Boolean);
    }
  }
  return [];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * All configured keys, in order. EVOROZEN_API_KEYS takes a comma- or whitespace-separated list;
 * EVOROZEN_API_KEY (single key) is still accepted.
 */
export function pulseKeys(): string[] {
  const raw = process.env.EVOROZEN_API_KEYS || process.env.EVOROZEN_API_KEY || "";
  return [...new Set(raw.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean))];
}

/** A client for one configured key. Each incident lives on exactly one key (its data is stored there). */
export function pulseFromEnv(onCall?: (c: PulseCall) => void, keyIndex = 0): PulseClient {
  const keys = pulseKeys();
  return new PulseClient({
    apiKey: keys[keyIndex] ?? keys[0],
    baseUrl: process.env.EVOROZEN_BASE_URL || undefined,
    onCall,
  });
}
