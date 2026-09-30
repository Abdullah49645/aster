"use client";

import type { Constraints, WorldState } from "../engine/types";
import type { ExclusionReason, OptimizationResult } from "../engine/optimizer";
import { describeConstraints, formatHours, formatUsd } from "../engine/explain";
import { STATUS_WORD, entityName, fmt, interventionLabel, modesPhrase, plus } from "./format";

const REASON: Record<ExclusionReason, string> = {
  no_improvement: "Would not add access in the current state",
  outside_scope: "Not valid for the reported condition",
  over_budget: "Over budget",
  exceeds_window: "Takes longer than the time window",
  unknown_target: "Target not in the network",
};

export default function Interventions({
  world,
  result,
  constraints,
  onEntity,
}: {
  world: WorldState;
  result: OptimizationResult;
  constraints: Constraints;
  onEntity: (id: string) => void;
}) {
  const rows = [...result.singles].sort((a, b) => {
    if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
    if (a.rank !== null) return -1;
    if (b.rank !== null) return 1;
    return a.intervention.label < b.intervention.label ? -1 : 1;
  });
  const bestSingle = result.best && result.best.ids.length === 1 ? result.best.ids[0] : null;

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="iv-h">
        <div className="panel-h">
          <h2 id="iv-h">Every intervention, evaluated against the live network</h2>
          <span className="faint" style={{ fontSize: 13 }}>
            {describeConstraints(constraints)}
          </span>
        </div>
        <div className="table-wrap">
          <table className="iv">
            <thead>
              <tr>
                <th className="r">Rank</th>
                <th>Intervention</th>
                <th>Target now</th>
                <th className="r">Cost</th>
                <th className="r">Time</th>
                <th className="r">Properties reconnected</th>
                <th className="r">Ambulance routes</th>
                <th className="r">Recovery value</th>
                <th>Why not</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const iv = s.intervention;
                const st = world.entities[iv.targetEntityId];
                const c = s.candidate;
                const cls = iv.id === bestSingle ? "best" : s.rank === null ? "excluded" : "";
                return (
                  <tr key={iv.id} className={cls}>
                    <td className="r">{s.rank !== null ? <span className="rank num">{s.rank}</span> : <span className="faint">–</span>}</td>
                    <td>
                      <strong>{iv.label}</strong>
                      <div className="faint" style={{ fontSize: 12.5 }}>
                        Leaves it {STATUS_WORD[iv.resultStatus].toLowerCase()}
                        {iv.resultStatus === "LIMITED" ? `, ${modesPhrase(iv.resultStatus, iv.resultModes)}` : ""}
                      </div>
                    </td>
                    <td>
                      <button className="btn link" onClick={() => onEntity(iv.targetEntityId)}>
                        {entityName(iv.targetEntityId)}
                      </button>
                      <div style={{ marginTop: 4 }}>{st ? <span className={`status ${st.status}`}>{STATUS_WORD[st.status]}</span> : null}</div>
                    </td>
                    <td className="r num">{formatUsd(iv.costUsd)}</td>
                    <td className="r num">{formatHours(iv.durationHours)}</td>
                    <td className="r num">{c ? plus(c.delta.lightProperties) : "–"}</td>
                    <td className="r num">{c ? plus(c.delta.facilitiesWithEms) : "–"}</td>
                    <td className="r num">{c ? fmt(Math.round(c.delta.recoveryValue)) : "–"}</td>
                    <td className="reason">
                      {s.reasons.length ? s.reasons.map((r) => REASON[r]).join(". ") : s.rank === null ? "Adds no access on its own right now: other closures still cut this area off" : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="aside" style={{ padding: "0 16px 16px" }}>
          Recovery value is the access gained (each property weighted by the vehicle classes that can reach it: cars 0.5, ambulances 0.3, trucks 0.2),
          scaled by how much of the planning horizon remains once the work is done. Every figure here is recomputed from the current state whenever a
          report or constraint changes.
        </p>
      </section>

      {constraints.crews > 1 ? (
        <section className="panel" aria-labelledby="plans-h">
          <div className="panel-h">
            <h2 id="plans-h">Best plans for {constraints.crews} crews</h2>
            <span className="faint" style={{ fontSize: 13 }}>
              {fmt(result.evaluatedPlans)} combinations evaluated exactly
            </span>
          </div>
          <div className="panel-b">
            {result.ranked.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No combination improves access within these constraints.
              </p>
            ) : (
              <ol className="plans">
                {result.ranked.slice(0, 6).map((p, i) => (
                  <li key={p.ids.join("+")}>
                    <span className="rank num">{i + 1}</span>
                    <div>
                      <strong>{p.ids.map(interventionLabel).join(" + ")}</strong>
                      <div className="faint" style={{ fontSize: 13 }}>
                        {plus(p.delta.lightProperties)} properties, {plus(p.delta.facilitiesWithEms)} ambulance routes, {fmt(p.metrics.isolatedProperties)} still cut off
                      </div>
                    </div>
                    <div className="num" style={{ textAlign: "right" }}>
                      {formatUsd(p.costUsd)}
                      <div className="faint">{formatHours(p.durationHours)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
