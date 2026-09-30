import type { Claim, EntityState, Mode, SourceKind, Status, Transition } from "../engine/types";
import { MODES, SOURCES, STATUSES } from "../engine/types";
import type { Row } from "./client";

/**
 * ASTER's operational memory, as it lives in Neural Pulse (registered into LivingDNA via create_schema).
 *
 *   incidents          one row per incident workspace
 *   aliases            every known way of referring to an infrastructure entity (vector_search target)
 *   observations       APPEND-ONLY ledger: one row per claim extracted from a field report
 *   entity_state       materialized current state per (incident, entity) — upserted on every change
 *   transitions        every status change, pointing at the observation that caused it
 */

export const prefix = () => process.env.PULSE_TABLE_PREFIX || "aster_";
export const T = {
  incidents: () => `${prefix()}incidents`,
  aliases: () => `${prefix()}aliases`,
  observations: () => `${prefix()}observations`,
  entityState: () => `${prefix()}entity_state`,
  transitions: () => `${prefix()}transitions`,
};

export function schemaDefinition() {
  return [
    {
      name: T.incidents(),
      columns: [
        { name: "incident_id", type: "text", primary: true },
        { name: "label", type: "text" },
        { name: "region_id", type: "text" },
        { name: "created_at", type: "text" },
      ],
    },
    {
      name: T.aliases(),
      columns: [
        { name: "alias_id", type: "text", primary: true },
        { name: "entity_id", type: "text" },
        { name: "alias_text", type: "text" },
        { name: "origin", type: "text" }, // seed | learned
        { name: "created_at", type: "text" },
      ],
    },
    {
      name: T.observations(),
      columns: [
        { name: "obs_id", type: "text", primary: true },
        { name: "report_id", type: "text" },
        { name: "incident_id", type: "text" },
        { name: "raw_text", type: "text" },
        { name: "mention", type: "text", nullable: true },
        { name: "source", type: "text" },
        { name: "observed_at", type: "text" },
        { name: "entity_id", type: "text", nullable: true },
        { name: "claim_status", type: "text" },
        { name: "claim_modes", type: "text" },
        { name: "hedged", type: "boolean" },
        { name: "resolution", type: "text" }, // seed | auto | human | ambiguous | unresolved
        { name: "candidates", type: "text", nullable: true }, // JSON
        { name: "interpreter", type: "text" }, // seed | pulse-chat | rules
        { name: "superseded_by", type: "text", nullable: true },
      ],
    },
    {
      name: T.entityState(),
      columns: [
        { name: "state_key", type: "text", primary: true }, // `${incident_id}:${entity_id}`
        { name: "incident_id", type: "text" },
        { name: "entity_id", type: "text" },
        { name: "status", type: "text" },
        { name: "modes", type: "text" },
        { name: "confidence", type: "float" },
        { name: "tentative", type: "boolean" },
        { name: "last_confirmed_at", type: "text", nullable: true },
        { name: "supporting", type: "text" }, // JSON array of obs_id
        { name: "superseded", type: "text" }, // JSON array of obs_id
        { name: "alternatives", type: "text", nullable: true }, // JSON
        { name: "state_version", type: "integer" },
        { name: "updated_at", type: "text" },
      ],
    },
    {
      name: T.transitions(),
      columns: [
        { name: "transition_id", type: "text", primary: true },
        { name: "incident_id", type: "text" },
        { name: "entity_id", type: "text" },
        { name: "from_status", type: "text" },
        { name: "to_status", type: "text" },
        { name: "from_modes", type: "text" },
        { name: "to_modes", type: "text" },
        { name: "obs_id", type: "text" },
        { name: "at", type: "text" },
        { name: "state_version", type: "integer" },
      ],
    },
  ];
}

// ---------- codecs (Pulse rows are loosely typed; decode defensively) ----------

export interface ObservationRow {
  obsId: string;
  reportId: string;
  incidentId: string;
  rawText: string;
  mention: string | null;
  source: SourceKind;
  observedAt: string;
  entityId: string | null;
  status: Status;
  modes: Mode[];
  hedged: boolean;
  resolution: "seed" | "auto" | "human" | "ambiguous" | "unresolved";
  candidates: { entityId: string; score: number | null }[];
  interpreter: "seed" | "pulse-chat" | "rules";
  supersededBy: string | null;
}

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const bool = (v: unknown): boolean => v === true || v === "true" || v === 1 || v === "1";
const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};
export const encodeModes = (m: Mode[]) => m.join(",");
export const decodeModes = (v: unknown): Mode[] =>
  str(v)
    .split(",")
    .map((x) => x.trim())
    .filter((x): x is Mode => (MODES as readonly string[]).includes(x));
const decodeStatus = (v: unknown): Status => ((STATUSES as readonly string[]).includes(str(v)) ? (str(v) as Status) : "UNCERTAIN");
const decodeSource = (v: unknown): SourceKind => ((SOURCES as readonly string[]).includes(str(v)) ? (str(v) as SourceKind) : "public");
function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "object") return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

export function encodeObservation(o: ObservationRow): Row {
  return {
    obs_id: o.obsId,
    report_id: o.reportId,
    incident_id: o.incidentId,
    raw_text: o.rawText,
    mention: o.mention,
    source: o.source,
    observed_at: o.observedAt,
    entity_id: o.entityId,
    claim_status: o.status,
    claim_modes: encodeModes(o.modes),
    hedged: o.hedged,
    resolution: o.resolution,
    candidates: JSON.stringify(o.candidates),
    interpreter: o.interpreter,
    superseded_by: o.supersededBy,
  };
}

export function decodeObservation(r: Row): ObservationRow {
  const resolution = str(r.resolution);
  const interpreter = str(r.interpreter);
  return {
    obsId: str(r.obs_id),
    reportId: str(r.report_id) || str(r.obs_id),
    incidentId: str(r.incident_id),
    rawText: str(r.raw_text),
    mention: strOrNull(r.mention),
    source: decodeSource(r.source),
    observedAt: str(r.observed_at),
    entityId: strOrNull(r.entity_id),
    status: decodeStatus(r.claim_status),
    modes: decodeModes(r.claim_modes),
    hedged: bool(r.hedged),
    resolution: (["seed", "auto", "human", "ambiguous", "unresolved"].includes(resolution) ? resolution : "unresolved") as ObservationRow["resolution"],
    candidates: json(r.candidates, [] as ObservationRow["candidates"]),
    interpreter: (["seed", "pulse-chat", "rules"].includes(interpreter) ? interpreter : "rules") as ObservationRow["interpreter"],
    supersededBy: strOrNull(r.superseded_by),
  };
}

/** Only resolved observations become claims the state fold can use. */
export function toClaim(o: ObservationRow): Claim | null {
  if (!o.entityId || o.resolution === "ambiguous" || o.resolution === "unresolved") return null;
  return {
    obsId: o.obsId,
    reportId: o.reportId,
    entityId: o.entityId,
    status: o.status,
    modes: o.modes,
    hedged: o.hedged,
    source: o.source,
    observedAt: o.observedAt,
    rawText: o.rawText,
  };
}

export function encodeEntityState(incidentId: string, s: EntityState, version: number, now: string): Row {
  return {
    state_key: `${incidentId}:${s.entityId}`,
    incident_id: incidentId,
    entity_id: s.entityId,
    status: s.status,
    modes: encodeModes(s.modes),
    confidence: Math.round(s.confidence * 1000) / 1000,
    tentative: s.tentative,
    last_confirmed_at: s.lastConfirmedAt,
    supporting: JSON.stringify(s.supporting),
    superseded: JSON.stringify(s.superseded),
    alternatives: s.alternatives ? JSON.stringify(s.alternatives) : null,
    state_version: version,
    updated_at: now,
  };
}

export function decodeEntityState(r: Row): EntityState & { version: number; updatedAt: string } {
  const alternatives = json(r.alternatives, null as EntityState["alternatives"] | null);
  return {
    entityId: str(r.entity_id),
    status: decodeStatus(r.status),
    modes: decodeModes(r.modes),
    confidence: num(r.confidence, 0.5),
    tentative: bool(r.tentative),
    lastConfirmedAt: strOrNull(r.last_confirmed_at),
    supporting: json(r.supporting, [] as string[]),
    superseded: json(r.superseded, [] as string[]),
    alternatives: alternatives ?? undefined,
    version: num(r.state_version, 0),
    updatedAt: str(r.updated_at),
  };
}

export interface TransitionRow extends Transition {
  transitionId: string;
  incidentId: string;
  stateVersion: number;
}

export function encodeTransition(t: TransitionRow): Row {
  return {
    transition_id: t.transitionId,
    incident_id: t.incidentId,
    entity_id: t.entityId,
    from_status: t.fromStatus,
    to_status: t.toStatus,
    from_modes: encodeModes(t.fromModes),
    to_modes: encodeModes(t.toModes),
    obs_id: t.obsId,
    at: t.at,
    state_version: t.stateVersion,
  };
}

export function decodeTransition(r: Row): TransitionRow {
  return {
    transitionId: str(r.transition_id),
    incidentId: str(r.incident_id),
    entityId: str(r.entity_id),
    fromStatus: decodeStatus(r.from_status),
    toStatus: decodeStatus(r.to_status),
    fromModes: decodeModes(r.from_modes),
    toModes: decodeModes(r.to_modes),
    obsId: str(r.obs_id),
    at: str(r.at),
    stateVersion: num(r.state_version, 0),
  };
}
