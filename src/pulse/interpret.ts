import { z } from "zod";
import type { Mode, Status } from "../engine/types";
import { MODES } from "../engine/types";
import { normalizeModes } from "../engine/world";
import type { PulseClient } from "./client";

/**
 * Interpretation turns one free-text field report into zero or more claims:
 *   { mention, status, modes, hedged }
 * It NEVER decides which entity a mention refers to (that is resolution, done against Pulse memory),
 * and it never produces numbers used by the engine.
 *
 * Two interpreters:
 *  - "pulse-chat": the Neural Pulse `chat` action, asked for strict JSON and validated with zod.
 *  - "rules":      a deterministic keyword interpreter. Used when configured, or when chat output fails
 *                  validation. The trace always says which interpreter produced each claim.
 */

export interface InterpretedClaim {
  mention: string;
  status: Status;
  modes: Mode[];
  hedged: boolean;
}

export interface Interpretation {
  interpreter: "pulse-chat" | "rules";
  claims: InterpretedClaim[];
  note?: string;
  traceId?: string;
}

const ClaimSchema = z.object({
  mention: z.string().min(2).max(200),
  status: z.enum(["OPEN", "LIMITED", "CLOSED", "DAMAGED"]),
  modes: z.array(z.enum(["ems", "light", "heavy"])).optional().default([]),
  hedged: z.boolean().optional().default(false),
});
const ChatOutputSchema = z.object({ claims: z.array(ClaimSchema).max(6) });

export function buildChatPrompt(report: string): string {
  return [
    "Extract infrastructure status claims from a field report after a flood.",
    'Reply with JSON only, shaped exactly as {"claims":[{"mention":string,"status":string,"modes":string[],"hedged":boolean}]}.',
    "mention: the words in the report that name the road, bridge, culvert, ford, crossing or underpass.",
    "status: OPEN (all vehicles), LIMITED (some vehicle classes only), CLOSED (no vehicles), DAMAGED (structural damage or worsening damage beyond routine repair).",
    "modes: only for LIMITED, the classes still allowed, from ems (ambulances and emergency vehicles), light (cars and 4x4), heavy (trucks).",
    "hedged: true if the report is uncertain (may, might, possibly, heard, unconfirmed).",
    "One claim per piece of infrastructure mentioned. If nothing is described, return an empty claims array.",
    `Report: ${JSON.stringify(report)}`,
  ].join("\n");
}

/** Pull the first JSON object out of a chat response and validate it. */
export function parseChatClaims(text: string): InterpretedClaim[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = ChatOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.claims.map((c) => ({
    mention: c.mention.trim(),
    status: c.status,
    modes: normalizeModes(c.status, c.modes as Mode[]),
    hedged: c.hedged,
  }));
}

// ---------------- deterministic rules interpreter ----------------

const HEDGE = /\b(may|might|possibly|reportedly|heard|unconfirmed|could be|appears|seems|rumou?r)\b|\?/i;
const LIMITED = [
  /open to (light|4x4|four[- ]wheel|emergency)/i,
  /\b(4x4|four[- ]wheel[- ]drive)\b/i,
  /\bone lane\b|\bsingle lane\b/i,
  /\bno (heavy|trucks?)\b/i,
  /\brestricted\b/i,
  /usable by (emergency|ambulances?|ems)/i,
  /\b(emergency|ems) (vehicles )?only\b/i,
  /\blight (traffic|vehicles)\b/i,
  /unsafe for (heavy|trucks?)/i,
];
const DAMAGED = /\b(worsen(ed|ing)?|structural(ly)?|cracked|scoured|undermined|damaged|collapsing)\b/i;
const CLOSED =
  /\b(closed|closing|impassable|blocked|washed out|failed|collapsed|not usable|out of service|shut|submerged|flooded|not in service|landslide|slide|trees? down|debris (flow|across)|water (is )?(running )?over)\b/i;
/** A clause that names specific infrastructure (vs. a continuation like "Road fully blocked."). */
const SPECIFIC_NOUN = /\b(bridge|culvert|crossing|ford|causeway|underpass|span|pipe)\b/i;
const isContinuation = (clause: string) => !SPECIFIC_NOUN.test(clause) && !/\s[A-Z0-9]/.test(clause.slice(1));
const OPEN = /\b(re-?opened|open|cleared|passable|in service)\b/i;
const INFRA = /\b(bridge|culvert|crossing|ford|road|rd|lane|causeway|underpass|route|span|pipe|highway|street)\b/i;

function limitedModes(text: string): Mode[] {
  const t = text.toLowerCase();
  if (/usable by (emergency|ambulances?|ems)|(emergency|ems) (vehicles )?only/.test(t)) return ["ems"];
  const modes = new Set<Mode>();
  if (/emergency|ambulance|\bems\b/.test(t)) modes.add("ems");
  if (/light|4x4|four[- ]wheel|cars?\b|one lane|single lane|no heavy|no trucks?|unsafe for (heavy|trucks?)/.test(t)) {
    modes.add("light");
    modes.add("ems");
  }
  if (modes.size === 0) return ["ems", "light"];
  return MODES.filter((m) => modes.has(m));
}

const INFRA_WORD = /^(bridge|culvert|crossing|ford|road|rd|lane|causeway|underpass|route|span|pipe|highway|street|st)$/i;
const BOUNDARY = new Set(
  "is are was were be been being has have had at on in the a an heard hear says said say that cleared clear enough debris across over down and but now still may might could can will reports reported report crew crews ems units big large water running flow for by to of from after before near".split(" "),
);

/**
 * The words that REFER to infrastructure ("the Mile 8 culvert", "Oak Rd ford", "north bridge"),
 * stripped of status language, so resolution compares references with references.
 */
export function referencePhrase(clause: string): string {
  const words = clause.replace(/[.!?;,]+/g, " ").split(/\s+/).filter(Boolean);
  const i = words.findIndex((w) => INFRA_WORD.test(w));
  if (i < 0) return clause.trim();
  let start = i;
  while (start - 1 >= 0 && i - (start - 1) <= 4 && !BOUNDARY.has(words[start - 1].toLowerCase())) start--;
  let end = i;
  // consecutive infrastructure words / numbers: "Route 9 culvert", "Oak Rd ford"
  while (end + 1 < words.length && (INFRA_WORD.test(words[end + 1]) || /^\d+[a-z]?$/i.test(words[end + 1]))) end++;
  // trailing locator: "at Mile 8", "on Route 9", "on 14"
  let j = end + 1;
  while (j < words.length && /^(at|on|near)$/i.test(words[j]) && j + 1 < words.length && /^([A-Z]|\d)/.test(words[j + 1])) {
    let k = j + 1;
    while (k < words.length && k - j <= 3 && /^([A-Z]|\d)/.test(words[k])) k++;
    end = k - 1;
    j = k;
  }
  return words.slice(start, end + 1).join(" ");
}

export function classifyClause(clause: string): InterpretedClaim | null {
  const text = clause.trim();
  if (text.length < 3 || !INFRA.test(text)) return null;
  const hedged = HEDGE.test(text);
  let status: Status | null = null;
  if (/unsafe for (heavy|trucks?)/i.test(text)) status = "LIMITED";
  else if (DAMAGED.test(text) && !/\b(no|not) (structural )?damage/i.test(text)) status = /\b(worsen|structural|collaps)/i.test(text) ? "DAMAGED" : CLOSED.test(text) ? "CLOSED" : "DAMAGED";
  else if (LIMITED.some((r) => r.test(text))) status = "LIMITED";
  else if (CLOSED.test(text)) status = "CLOSED";
  else if (OPEN.test(text)) status = "OPEN";
  if (!status) return null;
  return { mention: text.replace(/[.!?]+$/, ""), status, modes: status === "LIMITED" ? limitedModes(text) : normalizeModes(status, []), hedged };
}

export function interpretWithRules(report: string): InterpretedClaim[] {
  const clauses = report
    .split(/(?<=[.!?;])\s+|\s+(?:but|while|whereas)\s+|,\s+(?:and\s+)?(?=(?:the\s+)?[a-z0-9-]+\s+(?:bridge|culvert|crossing|ford|road|lane|causeway|underpass))/i)
    .map((c) => c.trim())
    .filter(Boolean);
  // Merge continuation clauses ("One lane open, no trucks.") into the clause that named the infrastructure.
  const groups: { mention: string; text: string }[] = [];
  for (const c of clauses) {
    const last = groups[groups.length - 1];
    if (last && isContinuation(c)) last.text = `${last.text} ${c}`;
    else groups.push({ mention: c.replace(/[.!?;]+$/, ""), text: c });
  }
  const out: InterpretedClaim[] = [];
  for (const g of groups) {
    const claim = classifyClause(g.text);
    if (claim) out.push({ ...claim, mention: referencePhrase(g.mention) });
  }
  return out;
}

function excerpt(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export async function interpret(report: string, pulse: PulseClient, mode: "pulse-chat" | "rules"): Promise<Interpretation> {
  if (mode === "rules") return { interpreter: "rules", claims: interpretWithRules(report) };
  try {
    const res = await pulse.chat(buildChatPrompt(report));
    const text = typeof res.response === "string" ? res.response : JSON.stringify(res);
    const claims = parseChatClaims(text);
    if (claims) return { interpreter: "pulse-chat", claims, traceId: res.traceId };
    return {
      interpreter: "rules",
      claims: interpretWithRules(report),
      note: `Neural Pulse chat answered, but not with the structured claims ASTER needs. Used the rules interpreter instead. Pulse replied: "${excerpt(text)}"`,
      traceId: res.traceId,
    };
  } catch (e) {
    return {
      interpreter: "rules",
      claims: interpretWithRules(report),
      note: `Neural Pulse chat unavailable (${e instanceof Error ? e.message : String(e)}). Used the rules interpreter instead.`,
    };
  }
}
