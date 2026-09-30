"use client";

import { useMemo } from "react";
import type { NetworkMetrics } from "../engine/network";
import { edgeModes } from "../engine/network";
import type { FacilityKind, RegionEdge, WorldState } from "../engine/types";
import { STATUS_WORD, entityName, modesPhrase } from "./format";

const GLYPH: Record<FacilityKind, string> = { hospital: "H", clinic: "C", shelter: "S", fire: "F", water: "W" };
const FACILITY_WORD: Record<FacilityKind, string> = { hospital: "Hospital", clinic: "Clinic", shelter: "Shelter", fire: "Fire station", water: "Water works" };

export interface SheetHighlight {
  key: string;
  targetEntityIds: string[];
  reconnectedNodeIds: string[];
}

function edgeClass(edge: RegionEdge, world: WorldState): string {
  if (!edge.entityId) return "full";
  const st = world.entities[edge.entityId];
  if (st?.status === "UNCERTAIN") return "uncertain";
  const modes = edgeModes(edge, world.entities);
  if (edge.provisional && modes.length === 0) return "unbuilt";
  if (modes.length === edge.baseModes.length) return "full";
  if (modes.length === 0) return "none";
  return "partial";
}

export default function NetworkSheet({
  world,
  metrics,
  highlight,
  stateVersion,
  stateHash,
  onEntity,
}: {
  world: WorldState;
  metrics: NetworkMetrics;
  highlight: SheetHighlight | null;
  stateVersion: number;
  stateHash: string;
  onEntity: (entityId: string) => void;
}) {
  const { region } = world;
  const nodes = useMemo(() => new Map(region.nodes.map((n) => [n.id, n])), [region]);
  const lightReach = useMemo(() => new Set(metrics.reachable.light), [metrics]);
  const emsReach = useMemo(() => new Set(metrics.reachable.ems), [metrics]);

  // Offset parallel links (e.g. the CR-14 bridge and its temporary crossing) so both are visible.
  const geometry = useMemo(() => {
    const seen = new Map<string, number>();
    return region.edges.map((e) => {
      const a = nodes.get(e.from)!;
      const b = nodes.get(e.to)!;
      const key = [e.from, e.to].sort().join("|");
      const k = seen.get(key) ?? 0;
      seen.set(key, k + 1);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = k === 0 ? 0 : 16 * k;
      const ox = (-dy / len) * off;
      const oy = (dx / len) * off;
      return { e, x1: a.x + ox, y1: a.y + oy, x2: b.x + ox, y2: b.y + oy };
    });
  }, [region, nodes]);

  const planEntities = new Set(highlight?.targetEntityIds ?? []);
  const reconnected = new Set(highlight?.reconnectedNodeIds ?? []);

  return (
    <figure className="sheet" style={{ margin: 0 }}>
      <svg viewBox="0 0 1000 720" role="img" aria-label={`Road network schematic of ${region.name}. ${metrics.isolatedSettlements.length} settlements cut off.`}>
        <g className="graticule" aria-hidden="true">
          {Array.from({ length: 19 }, (_, i) => (
            <line key={`v${i}`} x1={(i + 1) * 50} y1={0} x2={(i + 1) * 50} y2={720} />
          ))}
          {Array.from({ length: 14 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={(i + 1) * 50} x2={1000} y2={(i + 1) * 50} />
          ))}
        </g>

        <path className="creek" d="M-10,478 C110,440 210,492 320,464 S515,440 620,466 S820,494 1010,450" aria-hidden="true" />
        <text className="creek-label" x={60} y={446} aria-hidden="true">
          Harlan Creek
        </text>

        {highlight &&
          [...reconnected].map((id) => {
            const n = nodes.get(id);
            if (!n || n.kind === "junction") return null;
            return <circle key={`halo-${highlight.key}-${id}`} className="halo" cx={n.x} cy={n.y} r={n.kind === "settlement" ? 30 : 20} />;
          })}

        {geometry.map(({ e, x1, y1, x2, y2 }) => {
          const cls = edgeClass(e, world);
          const st = e.entityId ? world.entities[e.entityId] : undefined;
          const title = e.entityId
            ? `${entityName(e.entityId)}: ${STATUS_WORD[st?.status ?? "OPEN"]}${st?.status === "LIMITED" ? `, ${modesPhrase(st.status, st.modes)}` : ""}`
            : e.name;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          return (
            <g key={e.id}>
              {e.entityId ? (
                <line
                  className="hit"
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  tabIndex={0}
                  role="button"
                  aria-label={`${title}. Show evidence.`}
                  onClick={() => onEntity(e.entityId!)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onEntity(e.entityId!);
                    }
                  }}
                >
                  <title>{title}</title>
                </line>
              ) : null}
              <line className={`edge ${cls}`} x1={x1} y1={y1} x2={x2} y2={y2}>
                <title>{title}</title>
              </line>
              {cls === "none" && e.entityId ? (
                <g aria-hidden="true">
                  <line className="xmark" x1={mx - 7} y1={my - 7} x2={mx + 7} y2={my + 7} />
                  <line className="xmark" x1={mx - 7} y1={my + 7} x2={mx + 7} y2={my - 7} />
                </g>
              ) : null}
              {e.entityId && planEntities.has(e.entityId) ? (
                <line key={`plan-${highlight!.key}`} className="edge plan" x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1000} />
              ) : null}
            </g>
          );
        })}

        {region.nodes.map((n) => {
          const isolated = !lightReach.has(n.id);
          if (n.kind === "junction") return <circle key={n.id} className="node-junction" cx={n.x} cy={n.y} r={3} />;
          if (n.kind === "hub")
            return (
              <g key={n.id}>
                <rect className="node-hub" x={n.x - 9} y={n.y - 9} width={18} height={18} />
                <text className="label" x={n.x + 14} y={n.y + 5}>
                  {n.name}
                </text>
              </g>
            );
          if (n.kind === "facility") {
            const noEms = !emsReach.has(n.id);
            return (
              <g key={n.id} className={`facility${noEms ? " no-ems" : ""}`}>
                <title>{`${n.name} (${FACILITY_WORD[n.facility!]})${noEms ? ": no ambulance route" : ""}`}</title>
                <rect x={n.x - 9} y={n.y - 9} width={18} height={18} rx={2} />
                <text x={n.x} y={n.y + 0.5}>
                  {GLYPH[n.facility!]}
                </text>
              </g>
            );
          }
          const r = 5 + Math.sqrt(n.properties) / 2.2;
          const left = n.x > 840;
          return (
            <g key={n.id}>
              <title>{`${n.name}: ${n.properties} properties${isolated ? ", cut off" : ""}`}</title>
              <circle className={`node-settlement${isolated ? " isolated" : ""}`} cx={n.x} cy={n.y} r={r} />
              <text className={`label${isolated ? " isolated" : ""}`} x={left ? n.x - r - 6 : n.x + r + 6} y={n.y + 5} textAnchor={left ? "end" : "start"}>
                {n.name}
              </text>
            </g>
          );
        })}

        <g className="titleblock" transform="translate(716 18)">
          <rect width={266} height={96} />
          <line x1={0} y1={34} x2={266} y2={34} />
          <line x1={0} y1={64} x2={266} y2={64} />
          <line x1={150} y1={34} x2={150} y2={96} />
          <text className="tb-title" x={12} y={23}>
            {region.name}
          </text>
          <text x={12} y={54}>
            Road network schematic
          </text>
          <text x={160} y={54}>
            Not to scale
          </text>
          <text x={12} y={85}>
            {`State version ${stateVersion}`}
          </text>
          <text x={160} y={85}>
            {`Hash ${stateHash}`}
          </text>
        </g>
      </svg>
      <figcaption className="legend">
        <span>
          <svg viewBox="0 0 26 10" aria-hidden="true">
            <line x1="1" y1="5" x2="25" y2="5" stroke="var(--ink)" strokeWidth="2.6" />
          </svg>
          Open
        </span>
        <span>
          <svg viewBox="0 0 26 10" aria-hidden="true">
            <line x1="1" y1="5" x2="25" y2="5" stroke="var(--limited)" strokeWidth="3" strokeDasharray="6 4" />
          </svg>
          Some vehicles only
        </span>
        <span>
          <svg viewBox="0 0 26 10" aria-hidden="true">
            <line x1="1" y1="5" x2="25" y2="5" stroke="var(--closed)" strokeWidth="3" strokeDasharray="2 4" strokeLinecap="round" />
          </svg>
          Closed or damaged
        </span>
        <span>
          <svg viewBox="0 0 26 10" aria-hidden="true">
            <line x1="1" y1="5" x2="25" y2="5" stroke="var(--uncertain)" strokeWidth="3" strokeDasharray="8 3 2 3" />
          </svg>
          Conflicting reports
        </span>
        <span>
          <svg viewBox="0 0 26 10" aria-hidden="true">
            <circle cx="13" cy="5" r="4" fill="var(--sheet)" stroke="var(--closed)" strokeWidth="2" />
          </svg>
          Cut off
        </span>
        {highlight ? (
          <span>
            <svg viewBox="0 0 26 10" aria-hidden="true">
              <line x1="1" y1="5" x2="25" y2="5" stroke="var(--survey)" strokeWidth="5" />
            </svg>
            Recommended work
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
