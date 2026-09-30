import type { Constraints, Intervention, WorldState } from "./types";
import { computeMetrics, type NetworkMetrics } from "./network";
import { applyInterventions, isImproving } from "./scenario";
import { stateHash } from "./world";

/**
 * Exact optimizer.
 *
 * Candidate interventions are few (typically < 16) and crews are few (1–4), so we enumerate EVERY
 * feasible combination and evaluate each with the full network engine. This is the true optimum,
 * not a greedy ranking: it captures synergy (two repairs in series worth more together than apart)
 * and anti-synergy (two repairs reconnecting the same component).
 *
 * Determinism: fixed enumeration order + fully specified lexicographic tie-breaks.
 */

export const MAX_INTERVENTIONS = 16;
export const MAX_CREWS = 4;

export interface Delta {
  lightProperties: number;
  emsProperties: number;
  heavyProperties: number;
  facilitiesWithEms: number;
  accessScore: number;
  /** accessScore × fraction of the horizon during which the restored access exists. The ranking objective. */
  recoveryValue: number;
}

export interface Candidate {
  ids: string[];
  interventions: Intervention[];
  costUsd: number;
  /** Parallel crews: plan duration is the longest single job. */
  durationHours: number;
  metrics: NetworkMetrics;
  delta: Delta;
}

export type ExclusionReason = "no_improvement" | "outside_scope" | "over_budget" | "exceeds_window" | "unknown_target";

export interface SingleEvaluation {
  intervention: Intervention;
  applicable: boolean;
  feasible: boolean;
  reasons: ExclusionReason[];
  candidate: Candidate | null;
  rank: number | null;
}

export interface OptimizationResult {
  stateHash: string;
  constraints: Constraints;
  baseline: NetworkMetrics;
  best: Candidate | null;
  /** All feasible plans, best first (capped). */
  ranked: Candidate[];
  /** Every intervention evaluated alone, with feasibility reasons. */
  singles: SingleEvaluation[];
  evaluatedPlans: number;
  problems: string[];
}

function deltaOf(base: NetworkMetrics, m: NetworkMetrics, durationHours: number, horizonHours: number): Delta {
  const accessScore = Math.round((m.accessScore - base.accessScore) * 100) / 100;
  const timeFactor = Math.max(0, horizonHours - durationHours) / horizonHours;
  return {
    lightProperties: m.reachableProperties.light - base.reachableProperties.light,
    emsProperties: m.reachableProperties.ems - base.reachableProperties.ems,
    heavyProperties: m.reachableProperties.heavy - base.reachableProperties.heavy,
    facilitiesWithEms: m.facilitiesWithEms.length - base.facilitiesWithEms.length,
    accessScore,
    recoveryValue: Math.round(accessScore * timeFactor * 100) / 100,
  };
}

function sortKey(c: Candidate, objective: Constraints["objective"]): (number | string)[] {
  const d = c.delta;
  const primary =
    objective === "ems_first"
      ? [-d.facilitiesWithEms, -d.emsProperties, -d.recoveryValue]
      : [-d.recoveryValue, -d.accessScore, -d.lightProperties, -d.facilitiesWithEms];
  return [...primary, c.costUsd, c.durationHours, c.ids.length, c.ids.join(",")];
}

export function compareCandidates(a: Candidate, b: Candidate, objective: Constraints["objective"]): number {
  const ka = sortKey(a, objective);
  const kb = sortKey(b, objective);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

function improves(c: Candidate): boolean {
  return c.delta.recoveryValue > 0;
}

function* combinations<T>(items: T[], k: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}

export function validateConstraints(c: Constraints): string[] {
  const problems: string[] = [];
  if (c.budgetUsd !== null && (!Number.isFinite(c.budgetUsd) || c.budgetUsd < 0)) problems.push("Budget must be zero or more.");
  if (c.windowHours !== null && (!Number.isFinite(c.windowHours) || c.windowHours <= 0)) problems.push("Time window must be more than zero hours.");
  if (!Number.isFinite(c.horizonHours) || c.horizonHours < 24 || c.horizonHours > 8760) problems.push("Planning horizon must be between 1 day and 1 year.");
  if (!Number.isInteger(c.crews) || c.crews < 1 || c.crews > MAX_CREWS) problems.push(`Crews must be a whole number from 1 to ${MAX_CREWS}.`);
  return problems;
}

export function optimize(world: WorldState, constraints: Constraints, opts: { keep?: number } = {}): OptimizationResult {
  const keep = opts.keep ?? 25;
  const baseline = computeMetrics(world);
  const problems = validateConstraints(constraints);
  const hash = stateHash(world.entities);

  const all = [...world.region.interventions].sort((a, b) => (a.id < b.id ? -1 : 1));
  const evaluate = (ivs: Intervention[]): Candidate => {
    const metrics = computeMetrics(applyInterventions(world, ivs));
    const durationHours = ivs.reduce((m, i) => Math.max(m, i.durationHours), 0);
    return {
      ids: ivs.map((i) => i.id),
      interventions: ivs,
      costUsd: ivs.reduce((s, i) => s + i.costUsd, 0),
      durationHours,
      metrics,
      delta: deltaOf(baseline, metrics, durationHours, constraints.horizonHours),
    };
  };

  const singles: SingleEvaluation[] = all.map((iv) => {
    const reasons: ExclusionReason[] = [];
    const known = Boolean(world.entities[iv.targetEntityId]);
    if (!known) reasons.push("unknown_target");
    const targetStatus = world.entities[iv.targetEntityId]?.status;
    const inScope = !iv.applicableWhen || (targetStatus !== undefined && iv.applicableWhen.includes(targetStatus));
    const improving = known && isImproving(world, iv);
    const applicable = known && inScope && improving;
    if (known && !inScope) reasons.push("outside_scope");
    else if (known && !improving) reasons.push("no_improvement");
    if (constraints.budgetUsd !== null && iv.costUsd > constraints.budgetUsd) reasons.push("over_budget");
    if (constraints.windowHours !== null && iv.durationHours > constraints.windowHours) reasons.push("exceeds_window");
    const candidate = applicable ? evaluate([iv]) : null;
    return { intervention: iv, applicable, feasible: reasons.length === 0, reasons, candidate, rank: null };
  });

  if (problems.length > 0) {
    return { stateHash: hash, constraints, baseline, best: null, ranked: [], singles, evaluatedPlans: 0, problems };
  }

  const pool = singles.filter((s) => s.feasible).map((s) => s.intervention).slice(0, MAX_INTERVENTIONS);
  const plans: Candidate[] = [];
  let evaluated = 0;
  for (let k = 1; k <= Math.min(constraints.crews, pool.length); k++) {
    for (const combo of combinations(pool, k)) {
      const cost = combo.reduce((s, i) => s + i.costUsd, 0);
      if (constraints.budgetUsd !== null && cost > constraints.budgetUsd) continue;
      const c = k === 1 ? singles.find((s) => s.intervention.id === combo[0].id)!.candidate! : evaluate(combo);
      evaluated++;
      if (!improves(c)) continue;
      // A plan containing an intervention that adds nothing on top of the others is dominated.
      if (k > 1 && combo.some((iv) => {
        const without = combo.filter((x) => x.id !== iv.id);
        const w = plans.find((p) => p.ids.join(",") === without.map((x) => x.id).join(","));
        return w !== undefined && w.delta.recoveryValue >= c.delta.recoveryValue && w.delta.facilitiesWithEms >= c.delta.facilitiesWithEms;
      })) continue;
      plans.push(c);
    }
  }

  plans.sort((a, b) => compareCandidates(a, b, constraints.objective));

  // Rank singles among themselves for the interventions table.
  const rankedSingles = singles
    .filter((s) => s.feasible && s.candidate && improves(s.candidate))
    .map((s) => s.candidate!)
    .sort((a, b) => compareCandidates(a, b, constraints.objective));
  for (const s of singles) {
    const idx = rankedSingles.findIndex((c) => c.ids[0] === s.intervention.id);
    s.rank = idx >= 0 ? idx + 1 : null;
  }

  return {
    stateHash: hash,
    constraints,
    baseline,
    best: plans[0] ?? null,
    ranked: plans.slice(0, keep),
    singles,
    evaluatedPlans: evaluated,
    problems,
  };
}
