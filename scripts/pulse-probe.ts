/**
 * ASTER — Neural Pulse contract probe
 *
 * Purpose: verify, against the LIVE API, every behaviour ASTER's architecture
 * depends on. Nothing in ASTER assumes an API behaviour this probe hasn't confirmed.
 *
 * Run:
 *   EVOROZEN_API_KEY=evo_live_xxx npx tsx scripts/pulse-probe.ts
 *   EVOROZEN_API_KEY=evo_live_xxx npx tsx scripts/pulse-probe.ts --keep   (don't drop probe tables)
 *
 * Output: console summary + scripts/pulse-probe-report.json (commit this; it's evidence
 * for the README's "API integration" section).
 */

import { writeFileSync } from "node:fs";

const ENDPOINT = process.env.EVOROZEN_BASE_URL || "https://pulse.evorozen.com/api/neural";
// Uses EVOROZEN_PROBE_KEY if set, otherwise the first key in EVOROZEN_API_KEYS / EVOROZEN_API_KEY.
const KEY =
  process.env.EVOROZEN_PROBE_KEY ||
  (process.env.EVOROZEN_API_KEYS || process.env.EVOROZEN_API_KEY || "").split(/[\s,]+/).filter(Boolean)[0];
const KEEP = process.argv.includes("--keep");
// The 8-call burst test is off by default to save quota. Run with --burst to include it.
const BURST = process.argv.includes("--burst");
const T_ENT = "aster_probe_entities";
const T_OBS = "aster_probe_observations";

if (!KEY) {
  console.error("No key found. Set EVOROZEN_PROBE_KEY or EVOROZEN_API_KEYS in .env.local.");
  process.exit(1);
}

type ProbeResult = {
  step: string;
  question: string;
  ok: boolean;
  httpStatus: number | null;
  ms: number;
  request: unknown;
  response: unknown;
  note?: string;
};

const results: ProbeResult[] = [];

async function call(body: Record<string, unknown>) {
  // The live API requires a non-empty prompt on every request, including data actions.
  if (typeof body.prompt !== "string" || !body.prompt.trim()) {
    const payload = body.data_payload as Record<string, unknown> | undefined;
    const table = payload && typeof payload.table === "string" ? ` on table ${payload.table}` : "";
    body = { ...body, prompt: `Run ${String(body.action_type)}${table} exactly as specified in data_payload.` };
  }
  const t0 = performance.now();
  let httpStatus: number | null = null;
  let json: unknown = null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    httpStatus = res.status;
    const text = await res.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = { _nonJson: text.slice(0, 2000) };
    }
  } catch (e) {
    json = { _networkError: String(e) };
  }
  return { httpStatus, json, ms: Math.round(performance.now() - t0) };
}

async function probe(
  step: string,
  question: string,
  body: Record<string, unknown>,
  judge: (json: any, status: number | null) => { ok: boolean; note?: string } = (_j, s) => ({
    ok: s === 200,
  }),
) {
  const { httpStatus, json, ms } = await call(body);
  const { ok, note } = judge(json, httpStatus);
  results.push({ step, question, ok, httpStatus, ms, request: body, response: json, note });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${step.padEnd(28)} ${String(httpStatus).padEnd(4)} ${String(ms).padStart(6)}ms  ${note ?? ""}`);
  return json as any;
}

function rows(json: any): any[] {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.rows)) return json.rows;
  if (Array.isArray(json?.results)) return json.results;
  return [];
}

async function main() {
  console.log(`Probing ${ENDPOINT}\n`);

  // 0. Auth + reachability
  await probe("list_tables", "Does auth work and what exists?", { action_type: "list_tables" });

  // 1. Schema — entity registry + append-only observation ledger (ASTER's real shape)
  await probe(
    "create_schema",
    "Can we register ASTER-shaped tables deterministically?",
    {
      action_type: "create_schema",
      data_payload: {
        tables: [
          {
            name: T_ENT,
            columns: [
              { name: "entity_id", type: "text", primary: true },
              { name: "kind", type: "text" },
              { name: "canonical_name", type: "text" },
              { name: "alias_text", type: "text" },
              { name: "status", type: "text" },
              { name: "confidence", type: "float" },
              { name: "version", type: "integer" },
            ],
          },
          {
            name: T_OBS,
            columns: [
              { name: "obs_id", type: "text", primary: true },
              { name: "entity_id", type: "text", nullable: true },
              { name: "raw_text", type: "text" },
              { name: "observed_at", type: "text" },
              { name: "superseded_by", type: "text", nullable: true },
            ],
          },
        ],
      },
    },
    (j, s) => ({ ok: s === 200, note: JSON.stringify(j?.tables_created ?? j?.schema_execution ?? "").slice(0, 80) }),
  );

  // 2. Bulk insert entities
  await probe("bulk_insert", "Does bulk_insert work?", {
    action_type: "bulk_insert",
    data_payload: {
      table: T_ENT,
      records: [
        {
          entity_id: "CR14-BRIDGE",
          kind: "bridge",
          canonical_name: "County Road 14 Bridge",
          alias_text: "CR-14 bridge; County Road 14 crossing; the north bridge; Harlan Creek bridge",
          status: "LIMITED",
          confidence: 0.8,
          version: 1,
        },
        {
          entity_id: "CULVERT-M8",
          kind: "culvert",
          canonical_name: "Mile 8 Culvert, Route 9",
          alias_text: "culvert at mile 8; Route 9 culvert; the mile marker 8 pipe",
          status: "DAMAGED",
          confidence: 0.7,
          version: 1,
        },
        {
          entity_id: "OAK-RD",
          kind: "road_segment",
          canonical_name: "Oak Road (Fenwick to Millbrook)",
          alias_text: "Oak Road; Oak Rd; the Millbrook road",
          status: "OPEN",
          confidence: 0.9,
          version: 1,
        },
      ],
    },
  });

  // 3. Select with filter — which key does the live API accept?
  const sel = await probe(
    "select_data(filter)",
    "Does exact-match `filter` work?",
    { action_type: "select_data", data_payload: { table: T_ENT, filter: { entity_id: "CR14-BRIDGE" } } },
    (j, s) => ({ ok: s === 200 && rows(j).length === 1, note: `rows=${rows(j).length}` }),
  );
  if (rows(sel).length !== 1) {
    await probe(
      "select_data(where)",
      "Docs page says `where` — does that work instead?",
      { action_type: "select_data", data_payload: { table: T_ENT, where: { entity_id: "CR14-BRIDGE" } } },
      (j, s) => ({ ok: s === 200 && rows(j).length === 1, note: `rows=${rows(j).length}` }),
    );
  }

  // 4. Upsert — the state write ASTER uses on every transition
  await probe("upsert_data", "Does upsert on entity_id replace state?", {
    action_type: "upsert_data",
    data_payload: {
      table: T_ENT,
      record: { entity_id: "CR14-BRIDGE", status: "CLOSED", confidence: 0.95, version: 2 },
      conflict_columns: ["entity_id"],
    },
  });
  await probe(
    "upsert verify",
    "Did upsert preserve untouched columns (alias_text)?",
    { action_type: "select_data", data_payload: { table: T_ENT, filter: { entity_id: "CR14-BRIDGE" } } },
    (j) => {
      const r = rows(j)[0];
      return {
        ok: r?.status === "CLOSED" && typeof r?.alias_text === "string" && r.alias_text.length > 0,
        note: `status=${r?.status} alias_kept=${Boolean(r?.alias_text)}`,
      };
    },
  );

  // 5. update_data — filter/updates (OpenAPI) vs where/changes (docs page)
  const upd = await probe(
    "update_data(filter/updates)",
    "OpenAPI key names",
    { action_type: "update_data", data_payload: { table: T_ENT, filter: { entity_id: "OAK-RD" }, updates: { status: "LIMITED" } } },
    (j, s) => ({ ok: s === 200, note: `modified=${j?.modified_count ?? "?"}` }),
  );
  if (!upd || upd?.error) {
    await probe(
      "update_data(where/changes)",
      "Docs-page key names",
      { action_type: "update_data", data_payload: { table: T_ENT, where: { entity_id: "OAK-RD" }, changes: { status: "LIMITED" } } },
      (j, s) => ({ ok: s === 200, note: `modified=${j?.modified_count ?? "?"}` }),
    );
  }

  // 6. Append-only observation insert
  await probe("insert_data(observation)", "Observation ledger write", {
    action_type: "insert_data",
    data_payload: {
      table: T_OBS,
      record: {
        obs_id: "OBS-0001",
        entity_id: "CR14-BRIDGE",
        raw_text: "County 14 bridge is completely closed after the second span shifted.",
        observed_at: new Date().toISOString(),
        superseded_by: null,
      },
    },
  });

  // 7. Full-text search on aliases — lexical entity resolution
  await probe(
    "search(alias_text)",
    "Lexical alias match for 'north bridge'?",
    { action_type: "search", data_payload: { table: T_ENT, column: "alias_text", query: "north bridge" } },
    (j, s) => ({ ok: s === 200 && rows(j).length > 0, note: `hits=${rows(j).map((r) => r.entity_id).join(",")}` }),
  );

  // 8. Vector search — THE critical question for semantic entity resolution
  //    Need: does it work on freshly inserted rows (auto-embedding?), and does it return scores?
  await probe(
    "vector_search",
    "Semantic match 'the crossing over Harlan Creek on 14' -> CR14-BRIDGE? Scores returned?",
    { action_type: "vector_search", data_payload: { table: T_ENT, query: "the crossing over Harlan Creek on 14", limit: 3 } },
    (j, s) => {
      const r = rows(j);
      const top = r[0];
      const scoreKey = top ? Object.keys(top).find((k) => /score|similarity|distance/i.test(k)) : undefined;
      return {
        ok: s === 200 && top?.entity_id === "CR14-BRIDGE",
        note: `top=${top?.entity_id ?? "none"} scoreField=${scoreKey ?? "NONE"}`,
      };
    },
  );
  await probe(
    "vector_search (hard)",
    "Semantic match 'Route 9 pipe near the 8 marker' -> CULVERT-M8?",
    { action_type: "vector_search", data_payload: { table: T_ENT, query: "Route 9 pipe near the 8 marker failed", limit: 3 } },
    (j, s) => ({ ok: s === 200 && rows(j)[0]?.entity_id === "CULVERT-M8", note: `top=${rows(j)[0]?.entity_id ?? "none"}` }),
  );

  // 9. chat — can it return strict JSON for observation interpretation?
  //    Also checks whether the AISecurityModule flags a strict-format instruction as injection.
  const chatPrompt =
    "Classify this infrastructure field report. Reply with a JSON object only, keys: " +
    '"mention" (string), "status" (one of OPEN, LIMITED, CLOSED, DAMAGED, UNKNOWN), ' +
    '"modes_affected" (array of: ems, light, heavy), "hedged" (boolean). ' +
    'Report: "Bridge on 14 may be unsafe for heavy vehicles, light traffic still crossing."';
  await probe("chat(extraction)", "Does chat return parseable structured output?", { action_type: "chat", prompt: chatPrompt }, (j, s) => {
    const text: string = j?.response ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    let parsed: any = null;
    try {
      parsed = m ? JSON.parse(m[0]) : null;
    } catch {
      /* not parseable */
    }
    return {
      ok: s === 200 && parsed?.status !== undefined,
      note: parsed ? `status=${parsed.status} hedged=${parsed.hedged}` : `unparseable: ${text.slice(0, 60).replace(/\s+/g, " ")}`,
    };
  });

  // 10. analytics — does it reason over rows in a table? (possible alternative interpreter)
  await probe(
    "analytics",
    "Does analytics read table rows and answer structurally?",
    {
      action_type: "analytics",
      prompt: "Which entity_id has status CLOSED? Answer with only the entity_id.",
      data_payload: { table: T_ENT },
    },
    (j, s) => ({ ok: s === 200 && JSON.stringify(j).includes("CR14-BRIDGE"), note: JSON.stringify(j).slice(0, 80) }),
  );

  // 11. count + audit logs (evidence / observability)
  await probe("count_records", "count works?", { action_type: "count_records", data_payload: { table: T_ENT } });
  await probe("audit_logs", "Are our calls visible in audit logs (proof of integration)?", {
    action_type: "audit_logs",
    data_payload: { limit: 5 },
  });

  // 12. Burst — rate-limit behaviour (opt-in: costs 8 calls)
  if (BURST) {
  const burst = await Promise.all(
    Array.from({ length: 8 }, () => call({ action_type: "count_records", data_payload: { table: T_ENT } })),
  );
  const statuses = burst.map((b) => b.httpStatus);
  const p = burst.map((b) => b.ms).sort((a, b) => a - b);
  results.push({
    step: "burst x8",
    question: "429s under light concurrency? latency spread?",
    ok: !statuses.includes(429),
    httpStatus: null,
    ms: p[p.length - 1],
    request: "8 parallel count_records",
    response: { statuses, p50: p[4], max: p[7] },
  });
  console.log(`[${statuses.includes(429) ? "FAIL" : "PASS"}] burst x8                     statuses=${statuses.join(",")} p50=${p[4]}ms max=${p[7]}ms`);
  }

  // Cleanup
  if (!KEEP) {
    await probe("drop_table ent", "cleanup", { action_type: "drop_table", data_payload: { table: T_ENT } });
    await probe("drop_table obs", "cleanup", { action_type: "drop_table", data_payload: { table: T_OBS } });
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  writeFileSync(
    new URL("./pulse-probe-report.json", import.meta.url),
    JSON.stringify({ endpoint: ENDPOINT, ranAt: new Date().toISOString(), results }, null, 2),
  );
  console.log("Report written to scripts/pulse-probe-report.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
