/**
 * ASTER canonical world model.
 *
 * Everything in src/engine is pure: no I/O, no clocks, no randomness.
 * Same WorldState + same Constraints => byte-identical results.
 */

export type Status = "OPEN" | "LIMITED" | "CLOSED" | "DAMAGED" | "UNCERTAIN";
export type Mode = "ems" | "light" | "heavy";
export const MODES: readonly Mode[] = ["ems", "light", "heavy"] as const;
export const STATUSES: readonly Status[] = ["OPEN", "LIMITED", "CLOSED", "DAMAGED", "UNCERTAIN"] as const;

/** Who filed an observation. Drives reliability ranking in the state fold. */
export type SourceKind = "engineer" | "ems" | "field_crew" | "public";
export const SOURCES: readonly SourceKind[] = ["engineer", "ems", "field_crew", "public"] as const;

export type NodeKind = "hub" | "settlement" | "junction" | "facility";
export type FacilityKind = "hospital" | "clinic" | "shelter" | "fire" | "water";

export interface RegionNode {
  id: string;
  name: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** Addressable properties served at this node. */
  properties: number;
  facility?: FacilityKind;
}

export interface RegionEdge {
  id: string;
  from: string;
  to: string;
  name: string;
  /** If set, traversability is governed by this infrastructure entity's live state. */
  entityId?: string;
  /** Modes the physical link supports when fully open. */
  baseModes: Mode[];
  lengthKm: number;
  /** A link that does not exist in normal operations (e.g. a temporary crossing). Never counted as disrupted. */
  provisional?: boolean;
}

export interface InfrastructureEntity {
  id: string;
  kind: "bridge" | "culvert" | "ford" | "road_segment" | "underpass" | "temporary_crossing" | "causeway";
  name: string;
  /** Seed aliases, loaded into Neural Pulse for semantic resolution. */
  aliases: string[];
}

export interface Intervention {
  id: string;
  targetEntityId: string;
  label: string;
  kind: "repair" | "temporary" | "clearance" | "pumping";
  costUsd: number;
  durationHours: number;
  resultStatus: Status;
  resultModes: Mode[];
  /**
   * The target conditions this plan is scoped for. A repair priced for a LIMITED/CLOSED bridge is not a
   * valid plan once the bridge is reported DAMAGED (structural damage beyond routine repair). Omit = any.
   */
  applicableWhen?: Status[];
}

export interface Region {
  id: string;
  name: string;
  nodes: RegionNode[];
  edges: RegionEdge[];
  entities: InfrastructureEntity[];
  interventions: Intervention[];
}

/** One interpreted, resolved claim about one entity, derived from a field report. */
export interface Claim {
  obsId: string;
  reportId: string;
  entityId: string;
  status: Status;
  modes: Mode[];
  hedged: boolean;
  source: SourceKind;
  /** ISO-8601 */
  observedAt: string;
  rawText: string;
}

export interface StateAlternative {
  status: Status;
  modes: Mode[];
  obsId: string | null;
}

export interface EntityState {
  entityId: string;
  status: Status;
  /** Modes permitted when status is LIMITED. Ignored otherwise (see entityModes). */
  modes: Mode[];
  confidence: number;
  tentative: boolean;
  lastConfirmedAt: string | null;
  supporting: string[];
  superseded: string[];
  /** Present when status is UNCERTAIN: the competing interpretations. */
  alternatives?: StateAlternative[];
}

export interface Transition {
  entityId: string;
  fromStatus: Status;
  toStatus: Status;
  fromModes: Mode[];
  toModes: Mode[];
  obsId: string;
  at: string;
}

export interface WorldState {
  region: Region;
  entities: Record<string, EntityState>;
}

export type Objective = "max_access" | "ems_first";

export interface Constraints {
  budgetUsd: number | null;
  windowHours: number | null;
  /** Number of interventions that can run in parallel (1 = "what do we fix first?"). */
  crews: number;
  objective: Objective;
  /**
   * Planning horizon. Access restored at hour d is worth (horizon − d) / horizon of access restored now,
   * so a 12-hour temporary crossing can outrank a 21-day replacement over a 30-day horizon.
   */
  horizonHours: number;
}

export const DEFAULT_CONSTRAINTS: Constraints = {
  budgetUsd: null,
  windowHours: null,
  crews: 1,
  objective: "max_access",
  horizonHours: 720,
};

export const HORIZON_OPTIONS: readonly { hours: number; label: string }[] = [
  { hours: 72, label: "72 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
] as const;
