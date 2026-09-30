"use client";

import type { Constraints, WorldState } from "../engine/types";
import { HORIZON_OPTIONS } from "../engine/types";
import type { OptimizationResult } from "../engine/optimizer";
import type { Explanation } from "../engine/explain";
import { describeConstraints, formatHours, formatUsd } from "../engine/explain";
import { disruptedEntities } from "../engine/network";
import NetworkSheet, { type SheetHighlight } from "./NetworkSheet";
import { entityName, fmt, interventionLabel, plus } from "./format";

const BUDGETS: (number | null)[] = [null, 50_000, 100_000, 250_000];
const WINDOWS: (number | null)[] = [null, 12, 24, 48];

export default function Overview(props: {
  world: WorldState;
  result: OptimizationResult;
  explanation: Explanation | null;
  constraints: Constraints;
  setConstraints: (c: Constraints) => void;
  asked: boolean;
  onAsk: () => void;
  highlight: SheetHighlight | null;
  stateVersion: number;
  stateHash: string;
  onEntity: (id: string) => void;
  onCompare: () => void;
  lastChange: { before: string[]; after: string[] } | null;
}) {
  const { world, result, explanation: ex, constraints, setConstraints, asked } = props;
  const m = result.baseline;
  const disrupted = disruptedEntities(world).length;
  const possible = result.singles.filter((s) => s.feasible).length;
  const best = result.best;
  const multi = constraints.crews > 1;

  return (
    <div className="overview">
      <div className="stack">
        <section className="panel" aria-labelledby="situation-h">
          <div className="situation">
            <h1 id="situation-h">Situation now</h1>
            <dl className="ledger">
              <div>
                <dt className={`num${m.isolatedProperties > 0 ? " bad" : ""}`}>{fmt(m.isolatedProperties)}</dt>
                <dd>of {fmt(m.totalProperties)} properties have no road access</dd>
              </div>
              <div>
                <dt className={`num${m.facilitiesWithoutEms.length > 0 ? " bad" : ""}`}>{m.facilitiesWithoutEms.length}</dt>
                <dd>of {m.facilitiesTotal} emergency facilities have no ambulance route</dd>
              </div>
              <div>
                <dt className="num">{disrupted}</dt>
                <dd>crossings and road segments are disrupted</dd>
              </div>
              <div>
                <dt className="num">{possible}</dt>
                <dd>repairs are possible within your constraints</dd>
              </div>
            </dl>
          </div>
          {!asked ? (
            <button className="ask" onClick={props.onAsk}>
              What should we fix?
              <small>Evaluates every feasible repair against the live network</small>
            </button>
          ) : null}
        </section>

        {asked ? (
          <section
            key={`${result.stateHash}|${JSON.stringify(constraints)}`}
            className="panel answer recomputed"
            aria-live="polite"
            aria-labelledby="answer-h"
          >
            {result.problems.length > 0 ? (
              <div className="panel-b">
                <h2 id="answer-h">Check the constraints</h2>
                <ul>
                  {result.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : !best || !ex ? (
              <div className="panel-b">
                <div className="kicker">No recommendation</div>
                <h2 id="answer-h">Nothing within these constraints restores access</h2>
                <p className="aside">Raise the budget, widen the time window, or add a crew. The full list of options and why each was excluded is under Interventions.</p>
              </div>
            ) : (
              <div className="panel-b">
                <div className="kicker">{multi ? `Best plan for ${constraints.crews} crews working in parallel` : "Fix this first"}</div>
                <h2 id="answer-h">{best.ids.map(interventionLabel).join(" + ")}</h2>
                <div className="effects">
                  <div className="gain">
                    <b>{plus(best.delta.lightProperties)}</b>
                    <span>properties reconnected</span>
                  </div>
                  <div className="gain">
                    <b>{plus(best.delta.facilitiesWithEms)}</b>
                    <span>facilities regain an ambulance route</span>
                  </div>
                  <div>
                    <b>{formatUsd(best.costUsd)}</b>
                    <span>estimated cost</span>
                  </div>
                  <div>
                    <b>{formatHours(best.durationHours)}</b>
                    <span>{multi ? "until the last job finishes" : "to complete"}</span>
                  </div>
                </div>
                <p className="why">{ex.why}</p>
                {ex.nextBest ? (
                  <p className="aside">
                    {ex.ratioToNext !== null && ex.ratioToNext >= 1.05
                      ? `${ex.ratioToNext}× the recovery value of the next best option, ${ex.nextBest.ids.map(interventionLabel).join(" + ")}.`
                      : `Close to the next best option, ${ex.nextBest.ids.map(interventionLabel).join(" + ")}. Decide on cost or timing.`}
                  </p>
                ) : null}
                {ex.robustness.map((r) =>
                  r.holds ? (
                    <p className="aside" key={r.entityId}>
                      Reports about {r.entityName} conflict. This stays the best choice whichever report is right.
                    </p>
                  ) : (
                    <p className="aside warn" key={r.entityId}>
                      Reports about {r.entityName} conflict. If it is actually passable,{" "}
                      {r.altBestIds.length ? r.altBestIds.map(interventionLabel).join(" + ") : "no repair"} becomes the better choice. Confirm {r.entityName} before
                      committing crews.
                    </p>
                  ),
                )}
                {props.lastChange && props.lastChange.before.join() !== props.lastChange.after.join() ? (
                  <p className="aside">
                    The last report changed this answer. It was{" "}
                    {props.lastChange.before.length ? props.lastChange.before.map(interventionLabel).join(" + ") : "nothing"}.
                  </p>
                ) : null}
                <div className="actions">
                  <button className="btn" onClick={() => props.onEntity(best.interventions[0].targetEntityId)}>
                    Evidence for {entityName(best.interventions[0].targetEntityId)}
                  </button>
                  <button className="btn" onClick={props.onCompare}>
                    Compare all options
                  </button>
                </div>
                <p className="aside faint">
                  Computed from state version {props.stateVersion} for {describeConstraints(constraints)}. {fmt(result.evaluatedPlans)} plan
                  {result.evaluatedPlans === 1 ? "" : "s"} evaluated.
                </p>
              </div>
            )}
          </section>
        ) : null}

        <section className="panel" aria-labelledby="constraints-h">
          <div className="panel-h">
            <h2 id="constraints-h">Constraints</h2>
            <span className="faint" style={{ fontSize: 13 }}>
              The answer recomputes as you change these
            </span>
          </div>
          <div className="panel-b constraints">
            <div>
              <span className="field-label" id="budget-l">
                Budget
              </span>
              <div className="seg" role="group" aria-labelledby="budget-l">
                {BUDGETS.map((b) => (
                  <button key={String(b)} aria-pressed={constraints.budgetUsd === b} onClick={() => setConstraints({ ...constraints, budgetUsd: b })}>
                    {b === null ? "No limit" : formatUsd(b)}
                  </button>
                ))}
              </div>
              <div className="budget-input">
                <label htmlFor="budget-custom" className="faint" style={{ margin: 0, fontWeight: 450 }}>
                  Or enter an amount in dollars
                </label>
                <input
                  id="budget-custom"
                  type="number"
                  min={0}
                  step={5000}
                  inputMode="numeric"
                  value={constraints.budgetUsd ?? ""}
                  placeholder="No limit"
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setConstraints({ ...constraints, budgetUsd: v === "" ? null : Number(v) });
                  }}
                />
              </div>
            </div>
            <div>
              <span className="field-label" id="window-l">
                Must be finished within
              </span>
              <div className="seg" role="group" aria-labelledby="window-l">
                {WINDOWS.map((w) => (
                  <button key={String(w)} aria-pressed={constraints.windowHours === w} onClick={() => setConstraints({ ...constraints, windowHours: w })}>
                    {w === null ? "Any time" : `${w} h`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="field-label" id="crews-l">
                Crews available
              </span>
              <div className="seg" role="group" aria-labelledby="crews-l">
                {[1, 2, 3, 4].map((c) => (
                  <button key={c} aria-pressed={constraints.crews === c} onClick={() => setConstraints({ ...constraints, crews: c })}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="field-label" id="obj-l">
                Priority
              </span>
              <div className="seg" role="group" aria-labelledby="obj-l">
                <button aria-pressed={constraints.objective === "max_access"} onClick={() => setConstraints({ ...constraints, objective: "max_access" })}>
                  Most access overall
                </button>
                <button aria-pressed={constraints.objective === "ems_first"} onClick={() => setConstraints({ ...constraints, objective: "ems_first" })}>
                  Ambulance routes first
                </button>
              </div>
            </div>
            <div>
              <span className="field-label" id="hz-l">
                Planning horizon
              </span>
              <div className="seg" role="group" aria-labelledby="hz-l">
                {HORIZON_OPTIONS.map((h) => (
                  <button key={h.hours} aria-pressed={constraints.horizonHours === h.hours} onClick={() => setConstraints({ ...constraints, horizonHours: h.hours })}>
                    {h.label}
                  </button>
                ))}
              </div>
              <p className="faint" style={{ margin: "6px 0 0", fontSize: 13 }}>
                Access restored sooner counts for more. A three-week repair is worth little over a 72-hour horizon.
              </p>
            </div>
          </div>
        </section>
      </div>

      <NetworkSheet
        world={world}
        metrics={m}
        highlight={props.highlight}
        stateVersion={props.stateVersion}
        stateHash={props.stateHash}
        onEntity={props.onEntity}
      />
    </div>
  );
}
