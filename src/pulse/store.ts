import { randomUUID } from "node:crypto";
import type { EntityState, SourceKind, WorldState } from "../engine/types";
import { DEFAULT_CONSTRAINTS } from "../engine/types";
import { foldWorld, normalizeModes, stateHash } from "../engine/world";
import { optimize } from "../engine/optimizer";
import { HARLAN_VALLEY } from "../data/harlan-valley";
import { DEMO_INCIDENT_LABEL, SEED_OBSERVATIONS } from "../data/demo-incident";
import { seedClaims } from "../data/seed";
import type { PulseCall, PulseClient, Row } from "./client";
import { PulseError, tableNames } from "./client";
import { interpret } from "./interpret";
import { resolveMention, type Resolution } from "./resolve";
import {
  T,
  schemaDefinition,
  encodeObservation,
  decodeObservation,
  toClaim,
  encodeEntityState,
  decodeEntityState,
  encodeTransition,
  decodeTransition,
  type ObservationRow,
  type TransitionRow,
} from "./tables";

const REGION = HARLAN_VALLEY;
const KNOWN = new Set(REGION.entities.map((e) => e.id));

// ------------------------------------------------------------------ snapshot

export interface IncidentSnapshot {
  incidentId: string;
  label: string;
  source: "live" | "cached";
  notice: string | null;
  observations: ObservationRow[];
  entities: Record<string, EntityState>;
  transitions: TransitionRow[];
  stateVersion: number;
  stateHash: string;
  /** Entities whose materialized Pulse state disagrees with a fresh fold of the Pulse ledger. */
  drift: string[];
  loadedAt: string;
}

// ------------------------------------------------------------------ setup

export interface SetupReport {
  created: string[];
  existing: string[];
  aliasesSeeded: number;
}

export async function setupPulse(pulse: PulseClient): Promise<SetupReport> {
  const wanted = schemaDefinition();
  // list_tables is a convenience. If it fails or returns a shape we don't recognise, go straight to
  // create_schema and treat "already exists" as success, so setup stays idempotent either way.
  let existing = new Set<string>();
  try {
    existing = new Set(tableNames(await pulse.listTables()));
  } catch (e) {
    if (e instanceof PulseError && e.quota) throw e;
  }
  const missing = wanted.filter((t) => !existing.has(t.name));
  if (missing.length) {
    try {
      await pulse.createSchema(missing);
    } catch (e) {
      if (!(e instanceof PulseError && e.kind === "http" && !e.quota && /exist/i.test(e.message))) throw e;
    }
  }

  let aliasesSeeded = 0;
  const count = await pulse.count(T.aliases(), { origin: "seed" }).catch(() => 0);
  if (count === 0) {
    const now = new Date().toISOString();
    const records: Row[] = REGION.entities.flatMap((e) =>
      e.aliases.map((a, i) => ({ alias_id: `seed:${e.id}:${i}`, entity_id: e.id, alias_text: a, origin: "seed", created_at: now })),
    );
    await pulse.bulkInsert(T.aliases(), records);
    aliasesSeeded = records.length;
  }
  return { created: missing.map((t) => t.name), existing: wanted.filter((t) => existing.has(t.name)).map((t) => t.name), aliasesSeeded };
}

// ------------------------------------------------------------------ incidents

export function newIncidentId(): string {
  return `inc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function createIncident(pulse: PulseClient, nowMs = Date.now()): Promise<string> {
  const incidentId = newIncidentId();
  const now = new Date(nowMs).toISOString();
  const claims = seedClaims(incidentId, nowMs);
  const fold = foldWorld(REGION, claims);

  const observations: ObservationRow[] = claims.map((c) => ({
    obsId: c.obsId,
    reportId: c.reportId,
    incidentId,
    rawText: c.rawText,
    mention: null,
    source: c.source,
    observedAt: c.observedAt,
    entityId: c.entityId,
    status: c.status,
    modes: c.modes,
    hedged: c.hedged,
    resolution: "seed",
    candidates: [],
    interpreter: "seed",
    supersededBy: fold.supersededBy[c.obsId] ?? null,
  }));

  // Four independent tables: write them in parallel (live Pulse calls take several seconds each).
  // The incident row is written LAST so a half-written incident is never visible to loadIncident.
  await Promise.all([
    pulse.bulkInsert(T.observations(), observations.map(encodeObservation)),
    pulse.bulkInsert(
      T.entityState(),
      Object.values(fold.entities).map((s) => encodeEntityState(incidentId, s, 1, now)),
    ),
    fold.transitions.length
      ? pulse.bulkInsert(
          T.transitions(),
          fold.transitions.map((t, i) => encodeTransition({ ...t, transitionId: `${incidentId}:t${String(i).padStart(3, "0")}`, incidentId, stateVersion: 1 })),
        )
      : Promise.resolve(),
  ]);
  await pulse.insert(T.incidents(), { incident_id: incidentId, label: DEMO_INCIDENT_LABEL, region_id: REGION.id, created_at: now });
  return incidentId;
}

export async function loadIncident(pulse: PulseClient, incidentId: string): Promise<IncidentSnapshot | null> {
  const [incRows, obsRows, stateRows, transRows] = await Promise.all([
    pulse.select(T.incidents(), { filter: { incident_id: incidentId }, limit: 1 }),
    pulse.select(T.observations(), { filter: { incident_id: incidentId }, limit: 1000 }),
    pulse.select(T.entityState(), { filter: { incident_id: incidentId }, limit: 200 }),
    pulse.select(T.transitions(), { filter: { incident_id: incidentId }, limit: 1000 }),
  ]);
  if (incRows.length === 0) return null;

  // Exact-match filters are the documented behaviour; re-check client-side in case a filter is ignored.
  // The live service has been observed returning DUPLICATE copies of rows (and altered copies after
  // updates), so every table is de-duplicated by primary key here and nothing downstream trusts
  // a stored derived field.
  const observations = cleanLedger(obsRows.map(decodeObservation).filter((o) => o.incidentId === incidentId), incidentId);
  const materialized = latestByKey(
    stateRows.map(decodeEntityState).filter((s) => KNOWN.has(s.entityId)),
    (s) => s.entityId,
    (a, b) => a.version - b.version || (a.updatedAt < b.updatedAt ? -1 : 1),
  );
  const transitions = [...new Map(transRows.map(decodeTransition).filter((t) => t.incidentId === incidentId).map((t) => [t.transitionId, t])).values()].sort(
    (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.transitionId < b.transitionId ? -1 : 1),
  );

  // Current state is ALWAYS the deterministic fold of the Pulse ledger. The materialized entity_state
  // rows are kept as a written record and compared against it (drift), never trusted on their own.
  const fold = foldWorld(REGION, observations.map(toClaim).filter((c): c is NonNullable<typeof c> => c !== null));
  for (const o of observations) o.supersededBy = fold.supersededBy[o.obsId] ?? null;
  const entities: Record<string, EntityState> = {};
  const drift: string[] = [];
  let stateVersion = 0;
  for (const e of REGION.entities) {
    const m = materialized.get(e.id);
    const f = fold.entities[e.id];
    entities[e.id] = f;
    if (!m) {
      drift.push(e.id);
      continue;
    }
    stateVersion = Math.max(stateVersion, m.version);
    if (m.status !== f.status || normalizeModes(m.status, m.modes).join() !== normalizeModes(f.status, f.modes).join()) drift.push(e.id);
  }

  return {
    incidentId,
    label: String(incRows[0].label ?? DEMO_INCIDENT_LABEL),
    source: "live",
    notice: drift.length ? `Materialized state for ${drift.length} entit${drift.length === 1 ? "y" : "ies"} differs from the ledger. Submitting any report re-reconciles it.` : null,
    observations,
    entities,
    transitions,
    stateVersion,
    stateHash: stateHash(entities),
    drift,
    loadedAt: new Date().toISOString(),
  };
}

/** Keep one row per key, choosing the "greatest" by `cmp`. */
function latestByKey<T>(rows: T[], key: (r: T) => string, cmp: (a: T, b: T) => number): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    const cur = out.get(k);
    if (!cur || cmp(r, cur) > 0) out.set(k, r);
  }
  return out;
}

const RESOLUTION_RANK: Record<ObservationRow["resolution"], number> = { human: 4, auto: 3, seed: 2, ambiguous: 1, unresolved: 0 };
const OVERRIDE = "~human";

/**
 * One clean row per observation:
 *  - seeded rows are rebuilt from ASTER's own seed definition (only their timestamp comes from Pulse),
 *    so a corrupted or duplicated copy can never change what the seed said;
 *  - a person's resolution is stored as an append-only override row (`<obs_id>~human`) and applied here;
 *  - remaining duplicates keep the most-resolved copy.
 */
export function cleanLedger(rows: ObservationRow[], incidentId: string): ObservationRow[] {
  const overrides = new Map<string, string>();
  for (const r of rows) if (r.obsId.endsWith(OVERRIDE) && r.entityId && KNOWN.has(r.entityId)) overrides.set(r.obsId.slice(0, -OVERRIDE.length), r.entityId);

  const seedByKey = new Map(SEED_OBSERVATIONS.map((s) => [`${incidentId}:${s.key}`, s]));
  const base = latestByKey(
    rows.filter((r) => !r.obsId.endsWith(OVERRIDE)),
    (r) => r.obsId,
    (a, b) => RESOLUTION_RANK[a.resolution] - RESOLUTION_RANK[b.resolution],
  );
  const out: ObservationRow[] = [];
  for (const r of base.values()) {
    const seed = seedByKey.get(r.obsId);
    if (seed) {
      out.push({
        ...r,
        reportId: r.obsId,
        rawText: seed.text,
        mention: null,
        source: seed.source,
        entityId: seed.entityId,
        status: seed.status,
        modes: normalizeModes(seed.status, seed.modes),
        hedged: Boolean(seed.hedged),
        resolution: "seed",
        candidates: [],
        interpreter: "seed",
      });
      continue;
    }
    const human = overrides.get(r.obsId);
    out.push(human ? { ...r, entityId: human, resolution: "human" } : r);
  }
  return out.sort(byObserved);
}

function byObserved(a: ObservationRow, b: ObservationRow) {
  return a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : a.obsId < b.obsId ? -1 : 1;
}

/** Deterministic local snapshot of the seeded incident, used ONLY when Pulse is unavailable. Always labelled. */
export function cachedSnapshot(reason: string, nowMs = Date.now()): IncidentSnapshot {
  const incidentId = "cached-demo";
  const claims = seedClaims(incidentId, nowMs);
  const fold = foldWorld(REGION, claims);
  return {
    incidentId,
    label: DEMO_INCIDENT_LABEL,
    source: "cached",
    notice: reason,
    observations: claims.map((c) => ({
      obsId: c.obsId,
      reportId: c.reportId,
      incidentId,
      rawText: c.rawText,
      mention: null,
      source: c.source,
      observedAt: c.observedAt,
      entityId: c.entityId,
      status: c.status,
      modes: c.modes,
      hedged: c.hedged,
      resolution: "seed",
      candidates: [],
      interpreter: "seed",
      supersededBy: fold.supersededBy[c.obsId] ?? null,
    })),
    entities: fold.entities,
    transitions: fold.transitions.map((t, i) => ({ ...t, transitionId: `cached:t${i}`, incidentId, stateVersion: 1 })),
    stateVersion: 1,
    stateHash: stateHash(fold.entities),
    drift: [],
    loadedAt: new Date(nowMs).toISOString(),
  };
}

// ------------------------------------------------------------------ pipeline

export type StageId = "interpret" | "resolve" | "ledger" | "fold" | "state" | "recompute";

export interface TraceStep {
  stage: StageId;
  title: string;
  detail: string[];
  outcome: "ok" | "warn" | "error";
  ms: number;
  calls: PulseCall[];
}

export interface IngestResult {
  reportId: string;
  trace: TraceStep[];
  changedEntities: string[];
  pending: ObservationRow[];
  recommendationBefore: string[];
  recommendationAfter: string[];
  snapshot: IncidentSnapshot;
}

class Tracer {
  steps: TraceStep[] = [];
  private calls: PulseCall[] = [];
  private t0 = Date.now();
  constructor(pulse: PulseClient) {
    pulse.onCall = (c) => this.calls.push(c);
  }
  step(stage: StageId, title: string, detail: string[], outcome: TraceStep["outcome"] = "ok") {
    const now = Date.now();
    this.steps.push({ stage, title, detail, outcome, ms: now - this.t0, calls: this.calls });
    this.calls = [];
    this.t0 = now;
  }
}

function entityName(id: string | null) {
  return REGION.entities.find((e) => e.id === id)?.name ?? id ?? "unknown";
}

function bestIds(entities: Record<string, EntityState>): string[] {
  return optimize({ region: REGION, entities } as WorldState, DEFAULT_CONSTRAINTS, { keep: 1 }).best?.ids ?? [];
}

/**
 * Reconcile Pulse memory after the ledger changed:
 * fold the full ledger, then write back superseded_by marks, changed entity_state rows and transitions.
 */
async function reconcile(
  pulse: PulseClient,
  snapshot: IncidentSnapshot,
  ledger: ObservationRow[],
  triggerObsIds: Set<string>,
  now: string,
  tracer: Tracer,
): Promise<{ entities: Record<string, EntityState>; changed: string[]; version: number; newTransitions: TransitionRow[] }> {
  const claims = ledger.map(toClaim).filter((c): c is NonNullable<typeof c> => c !== null);
  const fold = foldWorld(REGION, claims);
  const changed = REGION.entities
    .map((e) => e.id)
    .filter((id) => {
      const a = snapshot.entities[id];
      const b = fold.entities[id];
      return !a || a.status !== b.status || normalizeModes(a.status, a.modes).join() !== normalizeModes(b.status, b.modes).join() || a.supporting.join() !== b.supporting.join() || a.superseded.join() !== b.superseded.join() || snapshot.drift.includes(id);
    });
  const newlySuperseded = ledger.filter((o) => fold.supersededBy[o.obsId] && o.supersededBy !== fold.supersededBy[o.obsId]);
  tracer.step(
    "fold",
    "State reconstructed from the Pulse ledger",
    [
      `${claims.length} resolved observations folded`,
      ...changed.map((id) => {
        const a = snapshot.entities[id];
        const b = fold.entities[id];
        return a && a.status !== b.status ? `${entityName(id)}: ${a.status} → ${b.status}` : `${entityName(id)}: evidence updated`;
      }),
      ...newlySuperseded.map((o) => `Superseded: "${o.rawText.slice(0, 60)}${o.rawText.length > 60 ? "…" : ""}"`),
    ],
  );

  const version = snapshot.stateVersion + 1;
  const newTransitions: TransitionRow[] = fold.transitions
    .filter((t) => triggerObsIds.has(t.obsId))
    .map((t, i) => ({ ...t, transitionId: `${snapshot.incidentId}:v${version}:${i}`, incidentId: snapshot.incidentId, stateVersion: version }));
  // All writes here touch different rows, so they run in parallel. Supersession is NOT written back to
  // old ledger rows: it is re-derived by the fold on every load (the ledger stays append-only).
  await Promise.all([
    ...changed.map((id) => pulse.upsert(T.entityState(), encodeEntityState(snapshot.incidentId, fold.entities[id], version, now), ["state_key"])),
    newTransitions.length ? pulse.bulkInsert(T.transitions(), newTransitions.map(encodeTransition)) : Promise.resolve(),
  ]);
  for (const o of newlySuperseded) o.supersededBy = fold.supersededBy[o.obsId];
  tracer.step("state", changed.length ? `Operational state v${version} written to Pulse` : "No state change", [
    `${changed.length} entity_state row${changed.length === 1 ? "" : "s"} upserted`,
    `${newTransitions.length} transition${newTransitions.length === 1 ? "" : "s"} recorded`,
    `${newlySuperseded.length} earlier observation${newlySuperseded.length === 1 ? "" : "s"} now superseded (derived, ledger unchanged)`,
  ]);
  return { entities: fold.entities, changed, version, newTransitions };
}

export async function ingestReport(
  pulse: PulseClient,
  snapshot: IncidentSnapshot,
  input: { text: string; source: SourceKind },
  interpreterMode: "pulse-chat" | "rules",
  nowMs = Date.now(),
): Promise<IngestResult> {
  const tracer = new Tracer(pulse);
  const now = new Date(nowMs).toISOString();
  const reportId = `${snapshot.incidentId}:r${nowMs.toString(36)}${randomUUID().slice(0, 4)}`;

  // 1. Interpret
  const interp = await interpret(input.text, pulse, interpreterMode);
  tracer.step(
    "interpret",
    interp.interpreter === "pulse-chat" ? "Interpreted by Neural Pulse" : "Interpreted by rules",
    [
      ...(interp.note ? [interp.note] : []),
      ...(interp.claims.length
        ? interp.claims.map((c) => `"${c.mention}" → ${c.status}${c.status === "LIMITED" ? ` (${c.modes.join(", ")})` : ""}${c.hedged ? ", hedged" : ""}`)
        : ["No infrastructure status found in this report. Nothing was changed."]),
    ],
    interp.note ? "warn" : interp.claims.length ? "ok" : "warn",
  );

  // 2. Resolve each mention against Pulse memory
  const resolutions: Resolution[] = [];
  resolutions.push(...(await Promise.all(interp.claims.map((c) => resolveMention(pulse, c.mention, KNOWN)))));
  if (interp.claims.length) {
    tracer.step(
      "resolve",
      "Entities resolved against Pulse memory",
      resolutions.map((r, i) => {
        const m = `"${interp.claims[i].mention}"`;
        if (r.outcome === "auto") return `${m} → ${entityName(r.entityId)} (${r.method}${r.scored && r.candidates[0]?.score !== null ? `, ${r.candidates[0].score}` : ""})`;
        if (r.outcome === "ambiguous") return `${m} is ambiguous: ${r.candidates.map((c) => entityName(c.entityId)).join(" or ")}. Waiting for a person to choose.`;
        return `${m} matched nothing in memory. Waiting for a person to choose.${r.note ? ` ${r.note}` : ""}`;
      }),
      resolutions.some((r) => r.outcome !== "auto") ? "warn" : "ok",
    );
  }

  // 3. Append to the ledger (every claim, including unresolved ones — evidence is never dropped)
  const newRows: ObservationRow[] = interp.claims.map((c, i) => ({
    obsId: `${reportId}#${i}`,
    reportId,
    incidentId: snapshot.incidentId,
    rawText: input.text,
    mention: c.mention,
    source: input.source,
    observedAt: now,
    entityId: resolutions[i].entityId,
    status: c.status,
    modes: c.modes,
    hedged: c.hedged,
    resolution: resolutions[i].outcome,
    candidates: resolutions[i].candidates,
    interpreter: interp.interpreter,
    supersededBy: null,
  }));
  if (newRows.length) {
    await pulse.bulkInsert(T.observations(), newRows.map(encodeObservation));
    tracer.step("ledger", "Observations appended to the Pulse ledger", [`${newRows.length} row${newRows.length === 1 ? "" : "s"} written to ${T.observations()}`]);
  }

  const before = bestIds(snapshot.entities);
  const ledger = [...snapshot.observations, ...newRows];
  const resolvedNow = new Set(newRows.filter((r) => r.resolution === "auto").map((r) => r.obsId));
  let entities = snapshot.entities;
  let changed: string[] = [];
  let version = snapshot.stateVersion;
  let newTransitions: TransitionRow[] = [];
  if (resolvedNow.size > 0 || snapshot.drift.length > 0) {
    ({ entities, changed, version, newTransitions } = await reconcile(pulse, snapshot, ledger, resolvedNow, now, tracer));
  }

  const after = bestIds(entities);
  tracer.step(
    "recompute",
    after.join() === before.join() ? "Recommendation unchanged" : "Recommendation changed",
    [
      `Before: ${before.length ? before.map(labelOf).join(" + ") : "none"}`,
      `After: ${after.length ? after.map(labelOf).join(" + ") : "none"}`,
    ],
  );

  const next: IncidentSnapshot = {
    ...snapshot,
    observations: ledger.sort(byObserved),
    entities,
    transitions: [...snapshot.transitions, ...newTransitions],
    stateVersion: version,
    stateHash: stateHash(entities),
    drift: [],
    notice: null,
    loadedAt: now,
  };
  return {
    reportId,
    trace: tracer.steps,
    changedEntities: changed,
    pending: newRows.filter((r) => r.resolution === "ambiguous" || r.resolution === "unresolved"),
    recommendationBefore: before,
    recommendationAfter: after,
    snapshot: next,
  };
}

export async function confirmResolution(
  pulse: PulseClient,
  snapshot: IncidentSnapshot,
  input: { obsId: string; entityId: string },
  nowMs = Date.now(),
): Promise<IngestResult> {
  if (!KNOWN.has(input.entityId)) throw new PulseError(`Unknown entity ${input.entityId}.`, "config");
  const obs = snapshot.observations.find((o) => o.obsId === input.obsId);
  if (!obs) throw new PulseError("That observation is not part of this incident.", "config");
  if (obs.resolution !== "ambiguous" && obs.resolution !== "unresolved") throw new PulseError("That observation is already resolved.", "config");

  const tracer = new Tracer(pulse);
  const now = new Date(nowMs).toISOString();
  // Append-only: record the decision as an override row rather than editing the original.
  await pulse.insert(
    T.observations(),
    encodeObservation({ ...obs, obsId: `${obs.obsId}${OVERRIDE}`, entityId: input.entityId, resolution: "human", supersededBy: null }),
  );
  const learned = obs.mention && obs.mention.length <= 160;
  if (learned) {
    await pulse.insert(T.aliases(), {
      alias_id: `learned:${input.entityId}:${obs.obsId}`,
      entity_id: input.entityId,
      alias_text: obs.mention,
      origin: "learned",
      created_at: now,
    });
  }
  tracer.step("resolve", "Resolved by a person", [
    `"${obs.mention ?? obs.rawText}" → ${entityName(input.entityId)}`,
    learned ? "Phrasing saved to Pulse memory as a learned alias" : "Mention too long to keep as an alias",
  ]);

  const before = bestIds(snapshot.entities);
  const ledger = snapshot.observations.map((o) => (o.obsId === obs.obsId ? { ...o, entityId: input.entityId, resolution: "human" as const } : o));
  const { entities, changed, version, newTransitions } = await reconcile(pulse, snapshot, ledger, new Set([obs.obsId]), now, tracer);
  const after = bestIds(entities);
  tracer.step("recompute", after.join() === before.join() ? "Recommendation unchanged" : "Recommendation changed", [
    `Before: ${before.length ? before.map(labelOf).join(" + ") : "none"}`,
    `After: ${after.length ? after.map(labelOf).join(" + ") : "none"}`,
  ]);

  return {
    reportId: obs.reportId,
    trace: tracer.steps,
    changedEntities: changed,
    pending: [],
    recommendationBefore: before,
    recommendationAfter: after,
    snapshot: {
      ...snapshot,
      observations: ledger.sort(byObserved),
      entities,
      transitions: [...snapshot.transitions, ...newTransitions],
      stateVersion: version,
      stateHash: stateHash(entities),
      drift: [],
      notice: null,
      loadedAt: now,
    },
  };
}

function labelOf(id: string) {
  return REGION.interventions.find((i) => i.id === id)?.label ?? id;
}
