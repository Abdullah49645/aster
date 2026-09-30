"use client";

import { useState } from "react";
import type { SourceKind } from "../engine/types";
import { SOURCES } from "../engine/types";
import { HARLAN_VALLEY } from "../data/harlan-valley";
import { SAMPLE_REPORTS } from "../data/demo-incident";
import type { IncidentSnapshot, IngestResult } from "../pulse/store";
import { SOURCE_WORD, STATUS_WORD, clock, entityName, interventionLabel, modesPhrase } from "./format";

const STAGE_WORD: Record<string, string> = {
  interpret: "Interpret the report",
  resolve: "Resolve what it refers to",
  ledger: "Append to the ledger",
  fold: "Reconstruct state",
  state: "Write state",
  recompute: "Recompute the decision",
};

export default function LiveState(props: {
  snapshot: IncidentSnapshot;
  lastResult: IngestResult | null;
  busy: boolean;
  onSubmit: (text: string, source: SourceKind) => Promise<boolean>;
  onResolve: (obsId: string, entityId: string) => Promise<void>;
  onEntity: (id: string) => void;
}) {
  const { snapshot, lastResult, busy } = props;
  const [text, setText] = useState("");
  const [source, setSource] = useState<SourceKind>("field_crew");
  const cached = snapshot.source === "cached";
  const pending = snapshot.observations.filter((o) => o.resolution === "ambiguous" || o.resolution === "unresolved");
  const obsById = new Map(snapshot.observations.map((o) => [o.obsId, o]));
  const timeline = [...snapshot.transitions].reverse().slice(0, 40);

  const submit = async () => {
    if (!text.trim() || busy) return;
    const ok = await props.onSubmit(text.trim(), source);
    if (ok) setText("");
  };

  return (
    <div className="live">
      <div className="stack">
        <section className="panel composer" aria-labelledby="report-h">
          <div className="panel-h">
            <h2 id="report-h">New field report</h2>
            <span className="faint" style={{ fontSize: 13 }}>
              {text.length}/500
            </span>
          </div>
          <div className="panel-b">
            <label htmlFor="report-text" className="sr">
              Report text
            </label>
            <textarea
              id="report-text"
              value={text}
              maxLength={500}
              disabled={cached || busy}
              placeholder="Write what was seen, the way it was radioed in. For example: the crossing over Harlan Creek on 14 is closed to trucks."
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            <div className="row">
              <label htmlFor="report-source" style={{ fontSize: 13, color: "var(--ink-2)" }}>
                Reported by
              </label>
              <select
                id="report-source"
                value={source}
                disabled={cached || busy}
                onChange={(e) => setSource(e.target.value as SourceKind)}
                style={{ padding: "6px 8px", border: "1px solid var(--rule)", borderRadius: 3, background: "#fff" }}
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_WORD[s]}
                  </option>
                ))}
              </select>
              <span style={{ flex: 1 }} />
              <button className="btn primary" disabled={cached || busy || text.trim().length < 4} onClick={submit}>
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Recording
                  </>
                ) : (
                  "Record report"
                )}
              </button>
            </div>
            <p className="hint">
              {cached
                ? "Reports are paused: Neural Pulse is not available, so nothing could be recorded."
                : "Engineers outrank field crews and EMS, who outrank the public, when reports conflict within six hours."}
            </p>
            <div className="samples" aria-label="Example reports">
              {SAMPLE_REPORTS.map((s) => (
                <button
                  key={s.label}
                  className="sample"
                  disabled={cached || busy}
                  title={s.text}
                  onClick={() => {
                    setText(s.text);
                    setSource(s.source);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {pending.map((p) => {
              const choices = p.candidates.length ? p.candidates.map((c) => c.entityId) : [];
              return (
                <div className="pending" key={p.obsId} role="group" aria-label="Needs a person to resolve">
                  <p>
                    <strong>Which does &ldquo;{p.mention ?? p.rawText}&rdquo; mean?</strong> The report is recorded but has not changed any state.
                  </p>
                  <div className="choices">
                    {choices.map((id) => (
                      <button key={id} className="btn" disabled={busy} onClick={() => props.onResolve(p.obsId, id)}>
                        {entityName(id)}
                      </button>
                    ))}
                    <select
                      aria-label="Choose another entity"
                      disabled={busy}
                      defaultValue=""
                      onChange={(e) => e.target.value && props.onResolve(p.obsId, e.target.value)}
                      style={{ padding: "6px 8px", border: "1px solid var(--rule)", borderRadius: 3, background: "#fff" }}
                    >
                      <option value="">{choices.length ? "Something else" : "Choose the infrastructure"}</option>
                      {HARLAN_VALLEY.entities
                        .filter((e) => !choices.includes(e.id))
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel" aria-labelledby="timeline-h">
          <div className="panel-h">
            <h2 id="timeline-h">State changes</h2>
            <span className="faint" style={{ fontSize: 13 }}>
              From Neural Pulse, newest first
            </span>
          </div>
          <div className="panel-b">
            <ol className="timeline">
              {timeline.map((t) => {
                const o = obsById.get(t.obsId);
                return (
                  <li key={t.transitionId}>
                    <time dateTime={t.at}>{clock(t.at)}</time>
                    <div>
                      <div className="what">
                        <button className="btn link" onClick={() => props.onEntity(t.entityId)}>
                          {entityName(t.entityId)}
                        </button>
                        <span className={`status ${t.fromStatus}`}>{STATUS_WORD[t.fromStatus]}</span>
                        <span aria-label="became">to</span>
                        <span className={`status ${t.toStatus}`}>
                          {STATUS_WORD[t.toStatus]}
                          {t.toStatus === "LIMITED" ? `: ${modesPhrase(t.toStatus, t.toModes)}` : ""}
                        </span>
                      </div>
                      {o ? (
                        <q>
                          {o.rawText} <span className="faint">({SOURCE_WORD[o.source]})</span>
                        </q>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="trace-h" aria-live="polite">
        <div className="panel-h">
          <h2 id="trace-h">What happened to the last report</h2>
          {lastResult ? (
            <span className="faint" style={{ fontSize: 13 }}>
              {lastResult.trace.reduce((s, t) => s + t.calls.length, 0)} Neural Pulse calls,{" "}
              {lastResult.trace.reduce((s, t) => s + t.ms, 0).toLocaleString()} ms
            </span>
          ) : null}
        </div>
        <div className="panel-b">
          {busy ? (
            <ol className="trace">
              {Object.values(STAGE_WORD).map((w, i) => (
                <li key={w} className="pending-step">
                  <h3>
                    {w} {i === 0 ? <span className="spinner" aria-hidden="true" /> : null}
                  </h3>
                </li>
              ))}
            </ol>
          ) : !lastResult ? (
            <p className="muted" style={{ margin: 0, maxWidth: "60ch" }}>
              Record a report to see it travel through the pipeline: interpreted, resolved against Neural Pulse memory, appended to the ledger, folded into
              current state, and pushed through the network engine to a new recommendation. Every Neural Pulse call is listed with its timing.
            </p>
          ) : (
            <>
              <ol className="trace">
                {lastResult.trace.map((t, i) => (
                  <li key={i} className={t.outcome === "ok" ? "" : t.outcome}>
                    <div className="stage">
                      {STAGE_WORD[t.stage]}, {t.ms} ms
                    </div>
                    <h3 className={t.stage === "recompute" && t.title === "Recommendation changed" ? "changed" : undefined}>{t.title}</h3>
                    {t.detail.length ? (
                      <ul>
                        {t.detail.map((d, j) => (
                          <li key={j}>{d}</li>
                        ))}
                      </ul>
                    ) : null}
                    {t.calls.length ? (
                      <div className="calls" aria-label="Neural Pulse calls">
                        {t.calls.map((c, j) => (
                          <span key={j} className={`call${c.ok ? "" : " fail"}`} title={c.traceId ? `traceId ${c.traceId}` : undefined}>
                            {c.action} {c.status ?? "no response"}, {c.ms} ms
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
              {lastResult.recommendationBefore.join() !== lastResult.recommendationAfter.join() ? (
                <p className="aside">
                  With default constraints, the recommendation moved from{" "}
                  <strong>{lastResult.recommendationBefore.map(interventionLabel).join(" + ") || "nothing"}</strong> to{" "}
                  <strong>{lastResult.recommendationAfter.map(interventionLabel).join(" + ") || "nothing"}</strong>.
                </p>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
