/**
 * ASTER deterministic engine — public surface.
 *
 * World model:   foldWorld, foldEntity, stateHash, entityModes
 * Network:       computeMetrics, reachableFromHubs, edgeModes, disruptedEntities
 * Scenarios:     cloneWorld, applyInterventions, assumeAlternative, isImproving
 * Optimizer:     optimize, validateConstraints
 * Explanation:   explain, describeConstraints
 *
 * This module must never import from src/pulse, src/server or anything that performs I/O.
 */
export * from "./types";
export * from "./world";
export * from "./network";
export * from "./scenario";
export * from "./optimizer";
export * from "./explain";
