import type { EntityState, Intervention, StateAlternative, WorldState } from "./types";
import { entityModes, normalizeModes } from "./world";

/**
 * Counterfactual scenarios. The live WorldState is NEVER mutated:
 * every hypothetical works on a structural clone of the entity map.
 * (The Region is immutable reference data and is shared.)
 */

export function cloneWorld(world: WorldState): WorldState {
  return { region: world.region, entities: structuredClone(world.entities) };
}

/** Does applying this intervention add any mode the target doesn't currently permit? */
export function isImproving(world: WorldState, iv: Intervention): boolean {
  const current = entityModes(world.entities[iv.targetEntityId]);
  const result = entityModes({ status: iv.resultStatus, modes: iv.resultModes });
  return result.some((m) => !current.includes(m));
}

export function applyInterventions(world: WorldState, interventions: Intervention[]): WorldState {
  const next = cloneWorld(world);
  for (const iv of interventions) {
    const prev = next.entities[iv.targetEntityId];
    const applied: EntityState = {
      entityId: iv.targetEntityId,
      status: iv.resultStatus,
      modes: normalizeModes(iv.resultStatus, iv.resultModes),
      confidence: 1,
      tentative: false,
      lastConfirmedAt: prev?.lastConfirmedAt ?? null,
      supporting: prev?.supporting ?? [],
      superseded: prev?.superseded ?? [],
    };
    next.entities[iv.targetEntityId] = applied;
  }
  return next;
}

/** Set one entity to a specific alternative (used for robustness checks on UNCERTAIN state). */
export function assumeAlternative(world: WorldState, entityId: string, alt: StateAlternative): WorldState {
  const next = cloneWorld(world);
  const prev = next.entities[entityId];
  next.entities[entityId] = {
    ...prev,
    status: alt.status,
    modes: normalizeModes(alt.status, alt.modes),
    alternatives: undefined,
    tentative: false,
  };
  return next;
}
