import type { Claim, EntityState, Mode, Region, SourceKind, StateAlternative, Status, Transition } from "./types";
import { MODES } from "./types";

/**
 * Deterministic state reconstruction.
 *
 * Neural Pulse holds the observation ledger (what was reported, about which entity, when, by whom).
 * This fold turns that ledger into current operational state with explicit rules — so every status
 * ASTER feeds into the network engine can be traced to specific observations.
 *
 * Rules:
 *  1. Claims are applied in (observedAt, obsId) order.
 *  2. A firm (non-hedged) claim supersedes all earlier evidence it disagrees with ...
 *  3. ... unless it contradicts the governing claim about which vehicles can use the link AND comes from a
 *     LESS reliable source within CONFLICT_WINDOW. Then neither wins: the entity becomes UNCERTAIN and both
 *     claims are kept as alternatives. (An escalation such as CLOSED -> DAMAGED is not a contradiction.)
 *  4. A hedged claim ("may be unsafe") never supersedes. If it disagrees, the entity becomes UNCERTAIN.
 *  5. A claim agreeing with the governing claim is supporting evidence and raises confidence.
 *     Damage is sticky: a CLOSED report after a DAMAGED one supports it; only a passable report clears it.
 *  6. Nothing is ever deleted. Superseded observations stay in the ledger with superseded_by set.
 */

export const CONFLICT_WINDOW_MS = 6 * 60 * 60 * 1000;

export const SOURCE_RANK: Record<SourceKind, number> = { engineer: 3, ems: 2, field_crew: 2, public: 1 };
export const SOURCE_CONFIDENCE: Record<SourceKind, number> = {
  engineer: 0.95,
  ems: 0.85,
  field_crew: 0.85,
  public: 0.6,
};

/** Modes an entity currently permits, independent of the physical link. */
export function entityModes(state: Pick<EntityState, "status" | "modes"> | undefined): Mode[] {
  if (!state) return [...MODES];
  switch (state.status) {
    case "OPEN":
      return [...MODES];
    case "LIMITED":
      return MODES.filter((m) => state.modes.includes(m));
    default:
      // CLOSED, DAMAGED, UNCERTAIN are all non-traversable in the conservative baseline.
      return [];
  }
}

export function normalizeModes(status: Status, modes: Mode[] | undefined): Mode[] {
  if (status === "OPEN") return [...MODES];
  if (status === "LIMITED") {
    const m = MODES.filter((x) => (modes ?? []).includes(x));
    return m.length > 0 ? m : ["ems", "light"];
  }
  return [];
}

function sameClaim(a: { status: Status; modes: Mode[] }, b: { status: Status; modes: Mode[] }): boolean {
  if (a.status !== b.status) return false;
  if (a.status !== "LIMITED") return true;
  const am = normalizeModes(a.status, a.modes);
  const bm = normalizeModes(b.status, b.modes);
  return am.length === bm.length && am.every((m) => bm.includes(m));
}

/** Do two claims disagree about what can physically use the link? (CLOSED vs DAMAGED do not.) */
function contradicts(a: { status: Status; modes: Mode[] }, b: { status: Status; modes: Mode[] }): boolean {
  const am = entityModes({ status: a.status, modes: normalizeModes(a.status, a.modes) });
  const bm = entityModes({ status: b.status, modes: normalizeModes(b.status, b.modes) });
  return am.length !== bm.length || am.some((m) => !bm.includes(m));
}

function cmpClaim(a: Claim, b: Claim): number {
  if (a.observedAt < b.observedAt) return -1;
  if (a.observedAt > b.observedAt) return 1;
  return a.obsId < b.obsId ? -1 : a.obsId > b.obsId ? 1 : 0;
}

/**
 * Condition assumed before any report: normal operation. Provisional links (a temporary crossing) do not
 * exist in normal operation, so their baseline is CLOSED.
 */
export function baselineState(entityId: string, provisional = false): EntityState {
  return {
    entityId,
    status: provisional ? "CLOSED" : "OPEN",
    modes: provisional ? [] : [...MODES],
    confidence: 0.5,
    tentative: false,
    lastConfirmedAt: null,
    supporting: [],
    superseded: [],
  };
}

export interface FoldResult {
  state: EntityState;
  transitions: Transition[];
  /** obsId -> obsId that superseded it */
  supersededBy: Record<string, string>;
}

export function foldEntity(entityId: string, claims: Claim[], provisional = false): FoldResult {
  const ordered = claims.filter((c) => c.entityId === entityId).sort(cmpClaim);
  let state = baselineState(entityId, provisional);
  let governing: Claim | null = null;
  let supporting: Claim[] = [];
  const superseded: string[] = [];
  const supersededBy: Record<string, string> = {};
  const transitions: Transition[] = [];

  /** Supersede every piece of live evidence that disagrees with `winner`; keep agreeing evidence. */
  const supersedeDisagreeing = (winner: Claim) => {
    const keep: Claim[] = [];
    for (const s of supporting) {
      const supportsDamage = winner.status === "DAMAGED" && s.status === "CLOSED" && s.observedAt >= winner.observedAt;
      if (s.obsId === winner.obsId || sameClaim(s, winner) || supportsDamage) {
        keep.push(s);
        continue;
      }
      if (!supersededBy[s.obsId]) {
        supersededBy[s.obsId] = winner.obsId;
        superseded.push(s.obsId);
      }
    }
    supporting = keep.some((k) => k.obsId === winner.obsId) ? keep : [...keep, winner];
  };

  for (const c of ordered) {
    const before = { status: state.status, modes: normalizeModes(state.status, state.modes) };
    const cModes = normalizeModes(c.status, c.modes);
    const claimAlt: StateAlternative = { status: c.status, modes: cModes, obsId: c.obsId };

    if (!c.hedged) {
      const withinWindow = governing !== null && Date.parse(c.observedAt) - Date.parse(governing.observedAt) < CONFLICT_WINDOW_MS;
      const weaker = governing !== null && SOURCE_RANK[c.source] < SOURCE_RANK[governing.source];

      if (governing && contradicts(governing, c) && weaker && withinWindow) {
        // Rule 3: less reliable contradiction shortly after — hold both, decide nothing.
        supporting.push(c);
        state = {
          ...state,
          status: "UNCERTAIN",
          modes: [],
          tentative: true,
          confidence: Math.min(SOURCE_CONFIDENCE[governing.source], SOURCE_CONFIDENCE[c.source]) * 0.6,
          alternatives: [
            { status: governing.status, modes: normalizeModes(governing.status, governing.modes), obsId: governing.obsId },
            claimAlt,
          ],
        };
      } else if (governing && (sameClaim(governing, c) || (governing.status === "DAMAGED" && c.status === "CLOSED"))) {
        // Rule 5. Includes CLOSED after DAMAGED: it agrees nothing can cross but carries less information,
        // so it supports the damage assessment instead of erasing it.
        // Rule 5 (and resolution of any pending uncertainty in favour of the governing claim).
        supporting.push(c);
        const confirmsGoverning = sameClaim(governing, c);
        supersedeDisagreeing(confirmsGoverning ? c : governing);
        if (confirmsGoverning && SOURCE_RANK[c.source] >= SOURCE_RANK[governing.source]) governing = c;
        state = {
          ...state,
          status: governing.status,
          modes: normalizeModes(governing.status, governing.modes),
          tentative: false,
          confidence: Math.min(0.99, Math.max(state.confidence, SOURCE_CONFIDENCE[governing.source]) + 0.05),
          lastConfirmedAt: c.observedAt,
          alternatives: undefined,
        };
      } else {
        // Rule 2: firm claim takes over.
        supporting.push(c);
        supersedeDisagreeing(c);
        governing = c;
        state = {
          ...state,
          status: c.status,
          modes: cModes,
          tentative: false,
          confidence: SOURCE_CONFIDENCE[c.source],
          lastConfirmedAt: c.observedAt,
          alternatives: undefined,
        };
      }
    } else {
      // Rule 4: hedged.
      const current = governing ?? null;
      if (current && sameClaim(current, c)) {
        supporting.push(c);
        state = { ...state, confidence: Math.min(0.99, state.confidence + 0.02) };
      } else {
        supporting.push(c);
        const currentAlt: StateAlternative = current
          ? { status: current.status, modes: normalizeModes(current.status, current.modes), obsId: current.obsId }
          : { status: baselineState(entityId, provisional).status, modes: baselineState(entityId, provisional).modes, obsId: null };
        state = {
          ...state,
          status: "UNCERTAIN",
          modes: [],
          tentative: true,
          confidence: SOURCE_CONFIDENCE[c.source] * 0.5,
          alternatives: [currentAlt, claimAlt],
        };
      }
    }

    const after = { status: state.status, modes: normalizeModes(state.status, state.modes) };
    if (!sameClaim(before, after)) {
      transitions.push({
        entityId,
        fromStatus: before.status,
        toStatus: after.status,
        fromModes: before.modes,
        toModes: after.modes,
        obsId: c.obsId,
        at: c.observedAt,
      });
    }
  }

  state = {
    ...state,
    supporting: supporting.map((s) => s.obsId).filter((id) => !supersededBy[id]),
    superseded: [...superseded],
  };
  return { state, transitions, supersededBy };
}

export interface WorldFold {
  entities: Record<string, EntityState>;
  transitions: Transition[];
  supersededBy: Record<string, string>;
}

/** Fold the full ledger for every entity in the region. */
export function foldWorld(region: Region, claims: Claim[]): WorldFold {
  const entities: Record<string, EntityState> = {};
  const transitions: Transition[] = [];
  const supersededBy: Record<string, string> = {};
  for (const e of region.entities) {
    const r = foldEntity(e.id, claims, e.kind === "temporary_crossing");
    entities[e.id] = r.state;
    transitions.push(...r.transitions);
    Object.assign(supersededBy, r.supersededBy);
  }
  transitions.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.obsId < b.obsId ? -1 : 1));
  return { entities, transitions, supersededBy };
}

/** Stable, order-independent fingerprint of operational state (FNV-1a). */
export function stateHash(entities: Record<string, EntityState>): string {
  const keys = Object.keys(entities).sort();
  const canonical = keys
    .map((k) => {
      const e = entities[k];
      return `${k}=${e.status}:${normalizeModes(e.status, e.modes).join("+")}`;
    })
    .join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
