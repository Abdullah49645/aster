import type { Claim } from "../engine/types";
import { normalizeModes } from "../engine/world";
import { INCIDENT_LOOKBACK_MIN, SEED_OBSERVATIONS } from "./demo-incident";

/** Deterministic seed claims for an incident whose "now" is `createdAtMs`. */
export function seedClaims(incidentId: string, createdAtMs: number): Claim[] {
  const start = createdAtMs - INCIDENT_LOOKBACK_MIN * 60_000;
  return SEED_OBSERVATIONS.map((s) => ({
    obsId: `${incidentId}:${s.key}`,
    reportId: `${incidentId}:${s.key}`,
    entityId: s.entityId,
    status: s.status,
    modes: normalizeModes(s.status, s.modes),
    hedged: Boolean(s.hedged),
    source: s.source,
    observedAt: new Date(start + s.minutesAfterStart * 60_000).toISOString(),
    rawText: s.text,
  }));
}
