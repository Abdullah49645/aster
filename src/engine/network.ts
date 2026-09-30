import type { EntityState, Mode, Region, RegionEdge, WorldState } from "./types";
import { MODES } from "./types";
import { entityModes } from "./world";

/**
 * Explicit, documented weighting of access value per mode.
 * A property reachable by every mode scores 1.0; light-vehicle-only access scores 0.5.
 */
export const MODE_WEIGHTS: Record<Mode, number> = { light: 0.5, ems: 0.3, heavy: 0.2 };

export function edgeModes(edge: RegionEdge, entities: Record<string, EntityState>): Mode[] {
  if (!edge.entityId) return [...edge.baseModes];
  const allowed = entityModes(entities[edge.entityId]);
  return edge.baseModes.filter((m) => allowed.includes(m));
}

export function isDisrupted(edge: RegionEdge, entities: Record<string, EntityState>): boolean {
  if (!edge.entityId || edge.provisional) return false;
  return edgeModes(edge, entities).length < edge.baseModes.length;
}

function adjacency(region: Region, entities: Record<string, EntityState>, mode: Mode): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of region.nodes) adj.set(n.id, []);
  for (const e of region.edges) {
    if (!edgeModes(e, entities).includes(mode)) continue;
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  // Deterministic traversal order.
  for (const list of adj.values()) list.sort();
  return adj;
}

/** Nodes reachable from any hub using only links open to `mode`. */
export function reachableFromHubs(region: Region, entities: Record<string, EntityState>, mode: Mode): Set<string> {
  const adj = adjacency(region, entities, mode);
  const seen = new Set<string>();
  const queue: string[] = region.nodes.filter((n) => n.kind === "hub").map((n) => n.id).sort();
  for (const h of queue) seen.add(h);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nxt of adj.get(cur) ?? []) {
      if (!seen.has(nxt)) {
        seen.add(nxt);
        queue.push(nxt);
      }
    }
  }
  return seen;
}

export function componentCount(region: Region, entities: Record<string, EntityState>, mode: Mode): number {
  const adj = adjacency(region, entities, mode);
  const seen = new Set<string>();
  let count = 0;
  for (const n of [...region.nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (seen.has(n.id)) continue;
    count++;
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nxt of adj.get(cur) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          stack.push(nxt);
        }
      }
    }
  }
  return count;
}

export interface NetworkMetrics {
  totalProperties: number;
  reachableProperties: Record<Mode, number>;
  /** Properties with no light-vehicle access to any hub. The headline number. */
  isolatedProperties: number;
  isolatedSettlements: string[];
  facilitiesTotal: number;
  facilitiesWithEms: string[];
  facilitiesWithoutEms: string[];
  disruptedEdges: string[];
  components: number;
  /** Σ properties × Σ MODE_WEIGHTS of reachable modes. Rounded to 2 dp for determinism. */
  accessScore: number;
  reachable: Record<Mode, string[]>;
}

export function computeMetrics(world: WorldState): NetworkMetrics {
  const { region, entities } = world;
  const reach = {} as Record<Mode, Set<string>>;
  for (const m of MODES) reach[m] = reachableFromHubs(region, entities, m);

  const reachableProperties = { ems: 0, light: 0, heavy: 0 } as Record<Mode, number>;
  let total = 0;
  let score = 0;
  const isolatedSettlements: string[] = [];
  const facilitiesWithEms: string[] = [];
  const facilitiesWithoutEms: string[] = [];

  for (const n of region.nodes) {
    total += n.properties;
    for (const m of MODES) {
      if (reach[m].has(n.id)) {
        reachableProperties[m] += n.properties;
        score += n.properties * MODE_WEIGHTS[m];
      }
    }
    if (n.kind === "settlement" && !reach.light.has(n.id)) isolatedSettlements.push(n.id);
    if (n.kind === "facility") (reach.ems.has(n.id) ? facilitiesWithEms : facilitiesWithoutEms).push(n.id);
  }

  return {
    totalProperties: total,
    reachableProperties,
    isolatedProperties: total - reachableProperties.light,
    isolatedSettlements: isolatedSettlements.sort(),
    facilitiesTotal: facilitiesWithEms.length + facilitiesWithoutEms.length,
    facilitiesWithEms: facilitiesWithEms.sort(),
    facilitiesWithoutEms: facilitiesWithoutEms.sort(),
    disruptedEdges: region.edges.filter((e) => isDisrupted(e, entities)).map((e) => e.id).sort(),
    components: componentCount(region, entities, "light"),
    accessScore: Math.round(score * 100) / 100,
    reachable: {
      ems: [...reach.ems].sort(),
      light: [...reach.light].sort(),
      heavy: [...reach.heavy].sort(),
    },
  };
}

/** Entities whose state currently disrupts at least one link. */
export function disruptedEntities(world: WorldState): string[] {
  const ids = new Set<string>();
  for (const e of world.region.edges) if (e.entityId && isDisrupted(e, world.entities)) ids.add(e.entityId);
  return [...ids].sort();
}
