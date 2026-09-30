"use client";

import type { WorldState } from "../engine/types";
import { entityModes } from "../engine/world";
import type { IncidentSnapshot } from "../pulse/store";
import type { ObservationRow } from "../pulse/tables";
import { MODE_WORD, SOURCE_WORD, STATUS_WORD, clock, entityName, modesPhrase } from "./format";

function Obs({ o, supersededBy }: { o: ObservationRow; supersededBy?: ObservationRow }) {
  return (
    <li className={supersededBy ? "superseded" : undefined}>
      <time dateTime={o.observedAt} className="faint num">
        {clock(o.observedAt)}
      </time>
      <div>
        <p>{o.rawText}</p>
        <div className="meta">
          {SOURCE_WORD[o.source]}, read as {STATUS_WORD[o.status].toLowerCase()}
          {o.status === "LIMITED" ? ` (${modesPhrase(o.status, o.modes)})` : ""}
          {o.hedged ? ", hedged" : ""}
          {o.interpreter === "pulse-chat" ? ", interpreted by Neural Pulse" : o.interpreter === "rules" ? ", interpreted by rules" : ""}
          {o.resolution === "human" ? ", matched by a person" : ""}
          {supersededBy ? `. Superseded at ${clock(supersededBy.observedAt)} by: “${supersededBy.rawText}”` : ""}
        </div>
      </div>
    </li>
  );
}

export default function Evidence({
  world,
  snapshot,
  selected,
  onSelect,
}: {
  world: WorldState;
  snapshot: IncidentSnapshot;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const st = world.entities[selected];
  const obsById = new Map(snapshot.observations.map((o) => [o.obsId, o]));
  const all = snapshot.observations.filter((o) => o.entityId === selected);
  const supporting = st.supporting.map((id) => obsById.get(id)).filter((o): o is ObservationRow => Boolean(o));
  const superseded = all.filter((o) => o.supersededBy || st.superseded.includes(o.obsId));
  const history = snapshot.transitions.filter((t) => t.entityId === selected);
  const allowed = entityModes(st);

  return (
    <div className="evidence">
      <nav className="panel" aria-label="Infrastructure">
        <ul className="entities">
          {world.region.entities.map((e) => {
            const s = world.entities[e.id];
            return (
              <li key={e.id}>
                <button aria-current={e.id === selected} onClick={() => onSelect(e.id)}>
                  <span>{e.name}</span>
                  <span className={`status ${s.status}`}>{STATUS_WORD[s.status]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="panel" aria-labelledby="ev-h">
        <div className="panel-h">
          <h2 id="ev-h">{entityName(selected)}</h2>
          <span className={`status ${st.status}`}>{STATUS_WORD[st.status]}</span>
        </div>
        <div className="panel-b">
          <dl className="facts">
            <div>
              <dt>Usable by</dt>
              <dd>{allowed.length ? allowed.map((m) => MODE_WORD[m]).join(", ") : "Nothing"}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd className="num">
                {Math.round(st.confidence * 100)}%{st.tentative ? ", tentative" : ""}
                <div className="conf" aria-hidden="true">
                  <span style={{ width: `${Math.round(st.confidence * 100)}%` }} />
                </div>
              </dd>
            </div>
            <div>
              <dt>Last confirmed</dt>
              <dd className="num">{clock(st.lastConfirmedAt)}</dd>
            </div>
            <div>
              <dt>Reports on file</dt>
              <dd className="num">{all.length}</dd>
            </div>
          </dl>

          {st.status === "UNCERTAIN" && st.alternatives ? (
            <div className="pending" style={{ marginTop: 0, marginBottom: 18 }}>
              <p>
                <strong>Reports conflict.</strong> ASTER treats this link as closed until someone confirms which is right, and checks whether the
                recommendation would change if it is actually passable.
              </p>
              <ul style={{ margin: 0 }}>
                {st.alternatives.map((a, i) => {
                  const o = a.obsId ? obsById.get(a.obsId) : undefined;
                  return (
                    <li key={i}>
                      {STATUS_WORD[a.status]}
                      {a.status === "LIMITED" ? `, ${modesPhrase(a.status, a.modes)}` : ""}
                      {o ? ` (${SOURCE_WORD[o.source]}, ${clock(o.observedAt)})` : " (no reports: normal operation)"}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <h3 className="sec">Current evidence</h3>
          {supporting.length ? (
            <ul className="obs-list">
              {supporting.map((o) => (
                <Obs key={o.obsId} o={o} />
              ))}
            </ul>
          ) : (
            <p className="muted">
              {world.region.entities.find((e) => e.id === selected)?.kind === "temporary_crossing"
                ? "No reports. Not built, so treated as closed."
                : "No reports. Assumed open, as in normal operation."}
            </p>
          )}

          {superseded.length ? (
            <>
              <h3 className="sec">Superseded</h3>
              <ul className="obs-list">
                {superseded.map((o) => (
                  <Obs key={o.obsId} o={o} supersededBy={o.supersededBy ? obsById.get(o.supersededBy) : undefined} />
                ))}
              </ul>
            </>
          ) : null}

          {history.length ? (
            <>
              <h3 className="sec">History</h3>
              <ol className="timeline">
                {history.map((t) => (
                  <li key={t.transitionId}>
                    <time dateTime={t.at}>{clock(t.at)}</time>
                    <div className="what">
                      <span className={`status ${t.fromStatus}`}>{STATUS_WORD[t.fromStatus]}</span>
                      <span>to</span>
                      <span className={`status ${t.toStatus}`}>{STATUS_WORD[t.toStatus]}</span>
                      <span className="faint" style={{ fontSize: 13 }}>
                        state version {t.stateVersion}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
