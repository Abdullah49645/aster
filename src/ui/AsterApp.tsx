"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Constraints, SourceKind, WorldState } from "../engine/types";
import { DEFAULT_CONSTRAINTS } from "../engine/types";
import { optimize } from "../engine/optimizer";
import { explain } from "../engine/explain";
import { HARLAN_VALLEY } from "../data/harlan-valley";
import { DEMO_INCIDENT_LABEL, SEED_OBSERVATIONS } from "../data/demo-incident";
import type { IncidentSnapshot, IngestResult } from "../pulse/store";
import Overview from "./Overview";
import LiveState from "./LiveState";
import Interventions from "./Interventions";
import Evidence from "./Evidence";
import type { SheetHighlight } from "./NetworkSheet";

type Tab = "overview" | "live" | "interventions" | "evidence";
type Phase = { kind: "loading" } | { kind: "onboard" } | { kind: "ready" } | { kind: "fatal"; message: string };

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { error: `The server answered ${res.status} without a readable body.` };
  }
}

export default function AsterApp() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [snapshot, setSnapshot] = useState<IncidentSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [constraints, setConstraints] = useState<Constraints>(DEFAULT_CONSTRAINTS);
  const [asked, setAsked] = useState(false);
  const [selected, setSelected] = useState<string>("CR14-BRIDGE");
  const [lastResult, setLastResult] = useState<IngestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulseConfigured, setPulseConfigured] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const body = await readJson(res);
      if (!res.ok) throw new Error(String(body.error ?? `Could not load state (${res.status}).`));
      setPulseConfigured(Boolean(body.pulseConfigured));
      if (body.needsIncident) {
        setPhase({ kind: "onboard" });
        return;
      }
      setSnapshot(body.snapshot as IncidentSnapshot);
      setPhase({ kind: "ready" });
    } catch (e) {
      setPhase({ kind: "fatal", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createIncident = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/incidents", { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) throw new Error(String(body.error ?? "Could not create the incident."));
      setSnapshot(body.snapshot as IncidentSnapshot);
      setPulseConfigured(true);
      setAsked(false);
      setLastResult(null);
      setPhase({ kind: "ready" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const submitReport = async (text: string, source: SourceKind): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/observations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, source }) });
      const body = await readJson(res);
      if (!res.ok) throw new Error(String(body.error ?? "The report could not be recorded."));
      const r = body as unknown as IngestResult;
      setSnapshot(r.snapshot);
      setLastResult(r);
      return true;
    } catch (e) {
      setError(
        `${e instanceof Error ? e.message : String(e)} The report may be only partly recorded. ASTER re-checks the ledger against the stored state on every load and repairs any mismatch on the next report.`,
      );
      return false;
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (obsId: string, entityId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/observations/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obsId, entityId }) });
      const body = await readJson(res);
      if (!res.ok) throw new Error(String(body.error ?? "Could not resolve the report."));
      const r = body as unknown as IngestResult;
      setSnapshot(r.snapshot);
      setLastResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const world: WorldState | null = useMemo(() => (snapshot ? { region: HARLAN_VALLEY, entities: snapshot.entities } : null), [snapshot]);
  const result = useMemo(() => (world ? optimize(world, constraints) : null), [world, constraints]);
  const explanation = useMemo(() => (world && result ? explain(world, result) : null), [world, result]);

  const highlight: SheetHighlight | null = useMemo(() => {
    if (!asked || !result?.best || !explanation) return null;
    return {
      key: `${result.stateHash}:${result.best.ids.join("+")}`,
      targetEntityIds: result.best.interventions.map((i) => i.targetEntityId),
      reconnectedNodeIds: [...new Set([...explanation.reconnected, ...explanation.emsRestored].map((n) => n.id))],
    };
  }, [asked, result, explanation]);

  const openEvidence = (id: string) => {
    setSelected(id);
    setTab("evidence");
  };

  if (phase.kind === "loading") {
    return (
      <div className="frame">
        <header className="bar">
          <span className="wordmark">ASTER</span>
        </header>
        <main className="muted">
          <span className="spinner" aria-hidden="true" /> Reading the incident from Neural Pulse
        </main>
      </div>
    );
  }

  if (phase.kind === "fatal") {
    return (
      <div className="frame">
        <header className="bar">
          <span className="wordmark">ASTER</span>
        </header>
        <div className="notice error" role="alert">
          {phase.message}
        </div>
        <main>
          <button className="btn" onClick={() => location.reload()}>
            Try again
          </button>
        </main>
      </div>
    );
  }

  if (phase.kind === "onboard" || !snapshot || !world || !result) {
    return (
      <div className="frame">
        <header className="bar">
          <span className="wordmark">ASTER</span>
          <span className="incident">Tactical recovery engine</span>
        </header>
        {error ? (
          <div className="notice error" role="alert">
            {error}
          </div>
        ) : null}
        <main>
          <div className="onboard">
            <h1>After a flood, every report changes what should be fixed first.</h1>
            <p>
              ASTER keeps the incident&rsquo;s operational memory in Evorozen Neural Pulse, reconstructs the current condition of every bridge, culvert and
              road from conflicting field reports, and recomputes which repair restores the most access. This demo runs on a synthetic flood in the
              invented Harlan Valley.
            </p>
            <ol className="steps">
              <li>Load the incident. {SEED_OBSERVATIONS.length} field reports from the first six hours are written to a fresh workspace in Neural Pulse.</li>
              <li>Ask what to fix. Every feasible repair is evaluated against the live road network.</li>
              <li>Send a new report and watch the state, the network and the answer change.</li>
            </ol>
            <button className="ask" onClick={createIncident} disabled={creating}>
              {creating ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Writing to Neural Pulse
                </>
              ) : (
                `Load the ${DEMO_INCIDENT_LABEL}`
              )}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const cached = snapshot.source === "cached";
  const pendingCount = snapshot.observations.filter((o) => o.resolution === "ambiguous" || o.resolution === "unresolved").length;

  return (
    <div className="frame">
      <header className="bar">
        <span className="wordmark">ASTER</span>
        <span className="incident">
          {snapshot.label}, {HARLAN_VALLEY.name}
        </span>
        <span className="spacer" />
        <span className={`source-pill${cached ? " cached" : ""}`} title={cached ? snapshot.notice ?? "" : `Incident ${snapshot.incidentId}`}>
          <span className="dot" aria-hidden="true" />
          {cached ? "Cached demo state" : `Live from Neural Pulse, state version ${snapshot.stateVersion}`}
        </span>
        {!cached || pulseConfigured ? (
          <button
            className="btn"
            style={{ background: "transparent", color: "#e8eeea", borderColor: "#3b4c53" }}
            disabled={creating}
            onClick={() => {
              if (confirm("Start over with a fresh copy of the demo incident? Your reports stay in Neural Pulse under the old incident, and the new one may use a different key.")) createIncident();
            }}
          >
            {creating ? "Resetting" : "Reset demo"}
          </button>
        ) : null}
      </header>

      <nav className="tabs" role="tablist" aria-label="Views">
        {(
          [
            ["overview", "Overview"],
            ["live", "Live state"],
            ["interventions", "Interventions"],
            ["evidence", "Evidence"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
            {id === "live" && pendingCount > 0 ? <span className="count">{pendingCount} to resolve</span> : null}
          </button>
        ))}
      </nav>

      {snapshot.notice ? <div className="notice">{snapshot.notice}</div> : null}
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}

      <main>
        {tab === "overview" ? (
          <Overview
            world={world}
            result={result}
            explanation={explanation}
            constraints={constraints}
            setConstraints={setConstraints}
            asked={asked}
            onAsk={() => setAsked(true)}
            highlight={highlight}
            stateVersion={snapshot.stateVersion}
            stateHash={snapshot.stateHash}
            onEntity={openEvidence}
            onCompare={() => setTab("interventions")}
            lastChange={
              // The server's before/after uses default constraints; only claim "the last report changed this" when that matches.
              lastResult && JSON.stringify(constraints) === JSON.stringify(DEFAULT_CONSTRAINTS)
                ? { before: lastResult.recommendationBefore, after: lastResult.recommendationAfter }
                : null
            }
          />
        ) : tab === "live" ? (
          <LiveState snapshot={snapshot} lastResult={lastResult} busy={busy} onSubmit={submitReport} onResolve={resolve} onEntity={openEvidence} />
        ) : tab === "interventions" ? (
          <Interventions world={world} result={result} constraints={constraints} onEntity={openEvidence} />
        ) : (
          <Evidence world={world} snapshot={snapshot} selected={selected} onSelect={setSelected} />
        )}
      </main>
      <footer className="foot">
        Synthetic data. Harlan Valley, its roads and its incident are invented for demonstration. Every figure is computed by ASTER&rsquo;s network engine
        from the current state.
      </footer>
    </div>
  );
}
