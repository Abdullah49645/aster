import type { PulseClient, Row } from "./client";
import { T } from "./tables";

/**
 * Entity resolution against Neural Pulse memory.
 *
 * The mention ("the crossing over Harlan Creek on 14") is sent to Pulse `vector_search` over the alias
 * table. Aliases grow over time: when a human resolves an ambiguous mention, that phrasing is written
 * back as a learned alias, so the next report using it resolves automatically.
 *
 * Decision rule (deterministic given Pulse's ranking):
 *  - If Pulse returns similarity scores: auto-resolve when the best entity scores >= MIN_SCORE and
 *    leads the next entity by >= MIN_MARGIN.
 *  - If Pulse returns only a ranking: auto-resolve only when the top two hits are the same entity (or it
 *    is the only entity returned). A bare "first place" is not evidence enough.
 *  - Otherwise the mention is AMBIGUOUS and a person picks from the candidates. ASTER never guesses.
 *
 * If vector_search fails, Pulse full-text `search` is tried on the alias column. If both fail or return
 * nothing, the mention is UNRESOLVED and the person picks from the full entity list.
 */

export const MIN_SCORE = 0.55;
export const MIN_MARGIN = 0.06;

export interface Candidate {
  entityId: string;
  score: number | null;
}

export interface Resolution {
  outcome: "auto" | "ambiguous" | "unresolved";
  entityId: string | null;
  candidates: Candidate[];
  method: "vector_search" | "search" | "none";
  scored: boolean;
  note?: string;
}

const SCORE_KEYS = ["score", "similarity", "_score", "_similarity", "relevance", "distance", "_distance"];

function rowScore(r: Row): { value: number; isDistance: boolean } | null {
  for (const k of SCORE_KEYS) {
    const v = r[k];
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) return { value: n, isDistance: k.includes("distance") };
  }
  return null;
}

function rowEntity(r: Row): string | null {
  const v = r.entity_id ?? (r.record as Row | undefined)?.entity_id ?? (r.row as Row | undefined)?.entity_id;
  return typeof v === "string" && v ? v : null;
}

export function decide(rows: Row[], knownEntities: Set<string>, method: Resolution["method"]): Resolution {
  const usable = rows.map((r) => ({ entityId: rowEntity(r), s: rowScore(r) })).filter((x): x is { entityId: string; s: ReturnType<typeof rowScore> } => Boolean(x.entityId && knownEntities.has(x.entityId)));
  if (usable.length === 0) return { outcome: "unresolved", entityId: null, candidates: [], method, scored: false };

  const scored = usable.every((u) => u.s !== null);
  const byEntity = new Map<string, number>();
  if (scored) {
    for (const u of usable) {
      const sim = u.s!.isDistance ? 1 - u.s!.value : u.s!.value;
      byEntity.set(u.entityId, Math.max(byEntity.get(u.entityId) ?? -Infinity, sim));
    }
  } else {
    usable.forEach((u, i) => byEntity.set(u.entityId, (byEntity.get(u.entityId) ?? 0) + 1 / (i + 1)));
  }
  const ranked = [...byEntity.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const candidates: Candidate[] = ranked.slice(0, 3).map(([entityId, v]) => ({ entityId, score: scored ? Math.round(v * 1000) / 1000 : null }));
  const [top, second] = ranked;

  let auto: boolean;
  if (scored) auto = top[1] >= MIN_SCORE && (!second || top[1] - second[1] >= MIN_MARGIN);
  else auto = !second || (usable.length >= 2 && usable[0].entityId === usable[1].entityId);

  return auto
    ? { outcome: "auto", entityId: top[0], candidates, method, scored }
    : { outcome: "ambiguous", entityId: null, candidates, method, scored };
}

export async function resolveMention(pulse: PulseClient, mention: string, knownEntities: Set<string>): Promise<Resolution> {
  try {
    const rows = await pulse.vectorSearch(T.aliases(), mention, 6);
    const r = decide(rows, knownEntities, "vector_search");
    if (r.outcome !== "unresolved") return r;
  } catch (e) {
    const fallbackNote = `vector_search failed (${e instanceof Error ? e.message : String(e)}); tried full-text search.`;
    try {
      const rows = await pulse.search(T.aliases(), "alias_text", mention);
      return { ...decide(rows, knownEntities, "search"), note: fallbackNote };
    } catch (e2) {
      return {
        outcome: "unresolved",
        entityId: null,
        candidates: [],
        method: "none",
        scored: false,
        note: `${fallbackNote} Full-text search also failed (${e2 instanceof Error ? e2.message : String(e2)}).`,
      };
    }
  }
  // vector_search worked but matched nothing we know — try lexical search before giving up.
  try {
    const rows = await pulse.search(T.aliases(), "alias_text", mention);
    return decide(rows, knownEntities, "search");
  } catch {
    return { outcome: "unresolved", entityId: null, candidates: [], method: "none", scored: false };
  }
}
