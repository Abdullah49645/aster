import type { Mode, SourceKind, Status } from "../engine/types";

/**
 * The "Harlan Creek flood" demo incident — SYNTHETIC.
 *
 * These are the field reports that arrived during the first ~6 hours of the incident, already
 * interpreted and resolved (resolution = "seed"). Loading the incident writes them into the
 * Neural Pulse observation ledger for a fresh incident id; from then on every new report goes
 * through the live interpret → resolve → fold pipeline.
 *
 * minutesAfterStart is relative to the incident start (creation time − INCIDENT_LOOKBACK_MIN).
 */
export const INCIDENT_LOOKBACK_MIN = 420;

export interface SeedObservation {
  key: string;
  minutesAfterStart: number;
  source: SourceKind;
  entityId: string;
  status: Status;
  modes?: Mode[];
  hedged?: boolean;
  text: string;
}

export const DEMO_INCIDENT_LABEL = "Harlan Creek flood";

export const SEED_OBSERVATIONS: SeedObservation[] = [
  { key: "s01", minutesAfterStart: 35, source: "engineer", entityId: "CR14-BRIDGE", status: "LIMITED", modes: ["ems", "light"], text: "CR-14 bridge open to light vehicles only, inspection pending." },
  { key: "s02", minutesAfterStart: 40, source: "public", entityId: "OAK-FORD", status: "CLOSED", text: "Water is running over Oak Road at the low-water crossing." },
  { key: "s03", minutesAfterStart: 60, source: "field_crew", entityId: "CULVERT-M8", status: "DAMAGED", text: "Culvert at Mile 8 on Route 9 is damaged, water over the road." },
  { key: "s04", minutesAfterStart: 70, source: "ems", entityId: "DUN-UNDERPASS", status: "CLOSED", text: "Dunmore underpass flooded, about three feet of water. Units rerouting." },
  { key: "s05", minutesAfterStart: 90, source: "field_crew", entityId: "ASHBY-RD", status: "LIMITED", modes: ["ems", "light"], text: "Ashby Road partly washed out at the creek. One lane open, no trucks." },
  { key: "s06", minutesAfterStart: 100, source: "public", entityId: "PINE-LANE", status: "CLOSED", text: "Big tree down across Pine Hollow Lane." },
  { key: "s07", minutesAfterStart: 110, source: "field_crew", entityId: "KEEL-RD", status: "CLOSED", text: "Landslide on Keel Ridge Road above Millbrook. Road fully blocked." },
  { key: "s08", minutesAfterStart: 120, source: "engineer", entityId: "NF-BRIDGE", status: "CLOSED", text: "North Fork bridge abutment scoured. Closed to all traffic." },
  { key: "s09", minutesAfterStart: 140, source: "field_crew", entityId: "HATCHER-RD", status: "CLOSED", text: "Debris flow across Hatcher Road near the mill." },
  { key: "s10", minutesAfterStart: 150, source: "field_crew", entityId: "CULVERT-M8", status: "LIMITED", modes: ["light"], text: "Crew cleared enough debris at the Mile 8 culvert for 4x4 traffic." },
  { key: "s11", minutesAfterStart: 160, source: "field_crew", entityId: "STL-CAUSEWAY", status: "OPEN", text: "Stillwater Causeway checked. Open to all vehicles." },
  { key: "s12", minutesAfterStart: 180, source: "field_crew", entityId: "CR14-BRIDGE", status: "LIMITED", modes: ["ems", "light"], text: "County Road 14 crossing restricted. No heavy vehicles until engineers clear it." },
  { key: "s13", minutesAfterStart: 200, source: "ems", entityId: "OAK-FORD", status: "CLOSED", text: "EMS says the Oak Rd ford is impassable for ambulances." },
  { key: "s14", minutesAfterStart: 210, source: "field_crew", entityId: "PINE-LANE", status: "OPEN", text: "Pine Hollow Lane cleared and open." },
  { key: "s15", minutesAfterStart: 230, source: "field_crew", entityId: "CR14-TEMP", status: "CLOSED", text: "Temporary crossing panels staged beside CR-14, not in service yet." },
  { key: "s16", minutesAfterStart: 250, source: "public", entityId: "CR14-BRIDGE", status: "CLOSED", hedged: true, text: "Heard the north bridge might be closing?" },
  { key: "s17", minutesAfterStart: 260, source: "field_crew", entityId: "DUN-UNDERPASS", status: "CLOSED", text: "Underpass on Dunmore Road still flooded. Pumps requested." },
  { key: "s18", minutesAfterStart: 290, source: "engineer", entityId: "KEEL-RD", status: "CLOSED", text: "Keel Ridge slide still moving. Do not send crews yet." },
  { key: "s19", minutesAfterStart: 300, source: "engineer", entityId: "CR14-BRIDGE", status: "LIMITED", modes: ["ems", "light"], text: "Bridge on 14 still carrying light traffic. Heavy restriction stands." },
  { key: "s20", minutesAfterStart: 320, source: "field_crew", entityId: "CULVERT-M8", status: "CLOSED", text: "Mile 8 culvert failed again after the overnight rain. Route 9 closed." },
];

/** Reports offered as one-click examples on the Live State screen. These go through the LIVE pipeline. */
export const SAMPLE_REPORTS: { label: string; text: string; source: SourceKind }[] = [
  { label: "Bridge closes", text: "County 14 bridge is completely closed after the second span shifted.", source: "engineer" },
  { label: "Temporary crossing opens", text: "Temporary crossing is now usable by emergency vehicles.", source: "field_crew" },
  { label: "Damage worsens", text: "CR-14 bridge damage worsened. Temporary crossing is closed.", source: "field_crew" },
  { label: "Ambiguous reference", text: "The bridge is shut.", source: "public" },
  { label: "Ford opens to 4x4", text: "Oak Road is technically open to 4x4 vehicles now.", source: "field_crew" },
  { label: "Hedged report", text: "Heard the Stillwater Causeway may be unsafe for trucks.", source: "public" },
];
