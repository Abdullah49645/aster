import type { Mode, SourceKind, Status } from "../engine/types";
import { HARLAN_VALLEY } from "../data/harlan-valley";

export const MODE_WORD: Record<Mode, string> = { ems: "ambulances", light: "cars and 4x4s", heavy: "trucks" };
export const SOURCE_WORD: Record<SourceKind, string> = { engineer: "Engineer", ems: "EMS", field_crew: "Field crew", public: "Public" };
export const STATUS_WORD: Record<Status, string> = { OPEN: "Open", LIMITED: "Limited", CLOSED: "Closed", DAMAGED: "Damaged", UNCERTAIN: "Uncertain" };

export const entityName = (id: string | null | undefined) => HARLAN_VALLEY.entities.find((e) => e.id === id)?.name ?? id ?? "Unresolved";
export const interventionLabel = (id: string) => HARLAN_VALLEY.interventions.find((i) => i.id === id)?.label ?? id;
export const nodeName = (id: string) => HARLAN_VALLEY.nodes.find((n) => n.id === id)?.name ?? id;

export function modesPhrase(status: Status, modes: Mode[]): string {
  if (status !== "LIMITED") return "";
  if (modes.length === 0) return "no vehicles";
  return `${modes.map((m) => MODE_WORD[m]).join(", ")} only`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export const fmt = (n: number) => n.toLocaleString("en-US");
export const plus = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
