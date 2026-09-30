import type { Constraints, FacilityKind, RegionNode, WorldState } from "./types";
import type { Candidate, OptimizationResult } from "./optimizer";
import { optimize } from "./optimizer";
import { assumeAlternative } from "./scenario";
import { entityModes } from "./world";

export interface RobustnessCheck {
  entityId: string;
  entityName: string;
  /** Best plan if this uncertain entity is actually in its most permissive reported state. */
  altBestIds: string[];
  holds: boolean;
}

export interface Explanation {
  reconnected: RegionNode[];
  emsRestored: RegionNode[];
  facilitiesRestored: { id: string; name: string; facility: FacilityKind }[];
  propertiesRestored: number;
  /** How many times more recovery value than the next-best distinct plan (null if none). */
  ratioToNext: number | null;
  nextBest: Candidate | null;
  robustness: RobustnessCheck[];
  why: string;
}

const FACILITY_WORD: Record<FacilityKind, string> = {
  hospital: "hospital",
  clinic: "clinic",
  shelter: "shelter",
  fire: "fire station",
  water: "water treatment plant",
};

function list(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function explain(world: WorldState, result: OptimizationResult, maxRobustness = 4): Explanation | null {
  const best = result.best;
  if (!best) return null;
  const nodeById = new Map(world.region.nodes.map((n) => [n.id, n]));
  const baseLight = new Set(result.baseline.reachable.light);
  const baseEms = new Set(result.baseline.reachable.ems);

  const reconnected = best.metrics.reachable.light.filter((id) => !baseLight.has(id)).map((id) => nodeById.get(id)!);
  const emsRestored = best.metrics.reachable.ems.filter((id) => !baseEms.has(id)).map((id) => nodeById.get(id)!);
  const facilitiesRestored = emsRestored
    .filter((n) => n.kind === "facility" && n.facility)
    .map((n) => ({ id: n.id, name: n.name, facility: n.facility! }));

  const nextBest = result.ranked.find((c) => c.ids.join() !== best.ids.join() && !c.ids.every((id) => best.ids.includes(id))) ?? null;
  const ratioToNext =
    nextBest && nextBest.delta.recoveryValue > 0 ? Math.round((best.delta.recoveryValue / nextBest.delta.recoveryValue) * 10) / 10 : null;

  // Robustness: does the answer survive if each UNCERTAIN entity turns out to be in its best reported state?
  const robustness: RobustnessCheck[] = [];
  const uncertain = Object.values(world.entities)
    .filter((e) => e.status === "UNCERTAIN" && e.alternatives && e.alternatives.length > 0)
    .sort((a, b) => (a.entityId < b.entityId ? -1 : 1))
    .slice(0, maxRobustness);
  for (const e of uncertain) {
    const optimistic = [...e.alternatives!].sort(
      (a, b) => entityModes(b).length - entityModes(a).length || (a.status < b.status ? -1 : 1),
    )[0];
    const alt = optimize(assumeAlternative(world, e.entityId, optimistic), result.constraints, { keep: 1 });
    const altIds = alt.best?.ids ?? [];
    robustness.push({
      entityId: e.entityId,
      entityName: world.region.entities.find((x) => x.id === e.entityId)?.name ?? e.entityId,
      altBestIds: altIds,
      holds: altIds.join() === best.ids.join(),
    });
  }

  const settlements = reconnected.filter((n) => n.kind === "settlement" || n.kind === "hub");
  const facilityWords = facilitiesRestored.map((f) => `${f.name} (${FACILITY_WORD[f.facility]})`);
  const parts: string[] = [];
  if (settlements.length > 0) {
    const bySize = [...settlements].sort((a, b) => b.properties - a.properties || (a.name < b.name ? -1 : 1));
    const named =
      bySize.length <= 4
        ? list(bySize.map((s) => s.name))
        : `${bySize.slice(0, 3).map((s) => s.name).join(", ")} and ${bySize.length - 3} other settlements`;
    parts.push(`reconnects ${named} to the road network`);
  } else if (best.delta.heavyProperties > 0) {
    parts.push(`restores heavy-vehicle access for ${best.delta.heavyProperties} properties`);
  }
  if (facilityWords.length > 0) parts.push(`restores ambulance access to ${list(facilityWords)}`);
  const why =
    parts.length > 0
      ? `This ${best.ids.length > 1 ? "plan" : "intervention"} ${parts.join(", and ")}.`
      : `This ${best.ids.length > 1 ? "plan" : "intervention"} improves access for vehicles that are currently restricted.`;

  return {
    reconnected,
    emsRestored,
    facilitiesRestored,
    propertiesRestored: best.delta.lightProperties,
    ratioToNext,
    nextBest,
    robustness,
    why,
  };
}

export function describeConstraints(c: Constraints): string {
  const bits: string[] = [];
  bits.push(c.crews === 1 ? "one crew" : `${c.crews} crews in parallel`);
  if (c.budgetUsd !== null) bits.push(`budget ${formatUsd(c.budgetUsd)}`);
  if (c.windowHours !== null) bits.push(`done within ${c.windowHours} h`);
  bits.push(c.objective === "ems_first" ? "ambulance access first" : "most access overall");
  bits.push(`${formatHours(c.horizonHours)} horizon`);
  return bits.join(", ");
}

export function formatUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

export function formatHours(h: number): string {
  if (h < 24) return `${h} h`;
  const d = h / 24;
  return Number.isInteger(d) ? `${d} day${d === 1 ? "" : "s"}` : `${h} h`;
}
