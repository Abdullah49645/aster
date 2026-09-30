import type { Region } from "../engine/types";

/**
 * Harlan Valley — a SYNTHETIC region used for the ASTER demo.
 * Names are invented. Topology, property counts, costs and durations are illustrative inputs,
 * not real-world statistics. Every number ASTER displays is computed from these inputs by the engine.
 *
 * Geography: Harlan Creek runs east–west across the valley (y ≈ 460 on the schematic).
 * Fenwick (county seat, hospital) sits south of the creek. Four links cross it:
 * the County Road 14 bridge, a provisional temporary crossing beside it, the Oak Road low-water ford,
 * and Route 9 over the Mile 8 culvert.
 */
export const HARLAN_VALLEY: Region = {
  id: "harlan-valley",
  name: "Harlan Valley",
  nodes: [
    // South of the creek
    { id: "FEN", name: "Fenwick", kind: "hub", x: 500, y: 600, properties: 420 },
    { id: "FAC-HOSP", name: "Fenwick General Hospital", kind: "facility", facility: "hospital", x: 452, y: 646, properties: 0 },
    { id: "J-FW", name: "Fenwick West", kind: "junction", x: 380, y: 592, properties: 0 },
    { id: "J-FE", name: "Fenwick East", kind: "junction", x: 628, y: 592, properties: 0 },
    { id: "ASH", name: "Ashby", kind: "settlement", x: 248, y: 622, properties: 85 },
    { id: "FAC-ASH", name: "Ashby School", kind: "facility", facility: "shelter", x: 214, y: 664, properties: 0 },
    { id: "DUN", name: "Dunmore", kind: "settlement", x: 778, y: 628, properties: 110 },
    { id: "FAC-DUN", name: "Dunmore Fire Station", kind: "facility", facility: "fire", x: 822, y: 668, properties: 0 },
    { id: "TAL", name: "Talbot", kind: "settlement", x: 880, y: 540, properties: 30 },
    { id: "J-RIV-S", name: "CR-14 south landing", kind: "junction", x: 500, y: 506, properties: 0 },
    { id: "J-R9-S", name: "Route 9 south", kind: "junction", x: 700, y: 512, properties: 0 },
    { id: "J-OAK-S", name: "Oak Road south", kind: "junction", x: 300, y: 508, properties: 0 },
    { id: "LOW", name: "Lowry", kind: "settlement", x: 130, y: 560, properties: 25 },

    // North of the creek — central / west
    { id: "J-RIV-N", name: "CR-14 north landing", kind: "junction", x: 500, y: 414, properties: 0 },
    { id: "MIL", name: "Millbrook", kind: "settlement", x: 506, y: 336, properties: 160 },
    { id: "FAC-MIL", name: "Millbrook Clinic", kind: "facility", facility: "clinic", x: 552, y: 312, properties: 0 },
    { id: "J-OAK-N", name: "Oak Road north", kind: "junction", x: 300, y: 412, properties: 0 },
    { id: "PIN", name: "Pine Hollow", kind: "settlement", x: 200, y: 346, properties: 55 },
    { id: "ELM", name: "Elm Flats", kind: "settlement", x: 120, y: 262, properties: 35 },
    { id: "STL", name: "Stillwater", kind: "settlement", x: 368, y: 300, properties: 90 },
    { id: "FAC-STL", name: "Stillwater Grange", kind: "facility", facility: "shelter", x: 330, y: 262, properties: 0 },
    { id: "J-NF", name: "North Fork junction", kind: "junction", x: 616, y: 262, properties: 0 },
    { id: "KEE", name: "Keel Ridge", kind: "settlement", x: 452, y: 176, properties: 45 },
    { id: "UPH", name: "Upper Harlan", kind: "settlement", x: 520, y: 84, properties: 120 },
    { id: "FAC-WTP", name: "Upper Harlan Water Works", kind: "facility", facility: "water", x: 590, y: 62, properties: 0 },

    // North of the creek — east
    { id: "J-R9-N", name: "Route 9 north", kind: "junction", x: 706, y: 408, properties: 0 },
    { id: "CAR", name: "Carver's Gap", kind: "settlement", x: 792, y: 340, properties: 70 },
    { id: "FAC-CAR", name: "Carver's Gap Fire Company", kind: "facility", facility: "fire", x: 842, y: 372, properties: 0 },
    { id: "BRE", name: "Brennan", kind: "settlement", x: 664, y: 172, properties: 65 },
    { id: "HAT", name: "Hatcher's Mill", kind: "settlement", x: 822, y: 214, properties: 40 },
    { id: "J-GRV", name: "Graves Corner", kind: "junction", x: 606, y: 372, properties: 0 },
  ],
  edges: [
    // South network
    { id: "E-HOSP", from: "FEN", to: "FAC-HOSP", name: "Hospital Drive", baseModes: ["ems", "light", "heavy"], lengthKm: 0.8 },
    { id: "E-MAIN-W", from: "FEN", to: "J-FW", name: "Main Street west", baseModes: ["ems", "light", "heavy"], lengthKm: 1.6 },
    { id: "E-MAIN-E", from: "FEN", to: "J-FE", name: "Main Street east", baseModes: ["ems", "light", "heavy"], lengthKm: 1.7 },
    { id: "E-ASHBY", from: "J-FW", to: "ASH", name: "Ashby Road", entityId: "ASHBY-RD", baseModes: ["ems", "light", "heavy"], lengthKm: 3.1 },
    { id: "E-ASH-SCH", from: "ASH", to: "FAC-ASH", name: "School Lane", baseModes: ["ems", "light", "heavy"], lengthKm: 0.6 },
    { id: "E-LOWRY", from: "ASH", to: "LOW", name: "Lowry Road", baseModes: ["ems", "light", "heavy"], lengthKm: 2.4 },
    { id: "E-DUNMORE", from: "J-FE", to: "DUN", name: "Dunmore Road", entityId: "DUN-UNDERPASS", baseModes: ["ems", "light", "heavy"], lengthKm: 2.9 },
    { id: "E-DUN-FIRE", from: "DUN", to: "FAC-DUN", name: "Station Street", baseModes: ["ems", "light", "heavy"], lengthKm: 0.5 },
    { id: "E-TALBOT", from: "J-FE", to: "TAL", name: "Talbot Lane", baseModes: ["ems", "light", "heavy"], lengthKm: 4.2 },
    { id: "E-RIVER-RD", from: "FEN", to: "J-RIV-S", name: "River Road", baseModes: ["ems", "light", "heavy"], lengthKm: 1.4 },
    { id: "E-R9-S", from: "J-FE", to: "J-R9-S", name: "Route 9", baseModes: ["ems", "light", "heavy"], lengthKm: 1.9 },
    { id: "E-OAK-S", from: "J-FW", to: "J-OAK-S", name: "Oak Road", baseModes: ["ems", "light", "heavy"], lengthKm: 1.8 },

    // Creek crossings
    { id: "E-CR14", from: "J-RIV-S", to: "J-RIV-N", name: "County Road 14 Bridge", entityId: "CR14-BRIDGE", baseModes: ["ems", "light", "heavy"], lengthKm: 0.3 },
    { id: "E-CR14-TEMP", from: "J-RIV-S", to: "J-RIV-N", name: "CR-14 temporary crossing", entityId: "CR14-TEMP", baseModes: ["ems", "light"], lengthKm: 0.3, provisional: true },
    { id: "E-OAK-FORD", from: "J-OAK-S", to: "J-OAK-N", name: "Oak Road ford", entityId: "OAK-FORD", baseModes: ["ems", "light", "heavy"], lengthKm: 0.2 },
    { id: "E-R9-CULVERT", from: "J-R9-S", to: "J-R9-N", name: "Route 9 at Mile 8", entityId: "CULVERT-M8", baseModes: ["ems", "light", "heavy"], lengthKm: 0.4 },

    // North central / west
    { id: "E-CR14-N", from: "J-RIV-N", to: "MIL", name: "County Road 14 north", baseModes: ["ems", "light", "heavy"], lengthKm: 2.2 },
    { id: "E-MIL-CLINIC", from: "MIL", to: "FAC-MIL", name: "Clinic Road", baseModes: ["ems", "light", "heavy"], lengthKm: 0.5 },
    { id: "E-OAK-N", from: "J-OAK-N", to: "STL", name: "Oak Road north", baseModes: ["ems", "light", "heavy"], lengthKm: 3.0 },
    { id: "E-PINE", from: "J-OAK-N", to: "PIN", name: "Pine Hollow Lane", entityId: "PINE-LANE", baseModes: ["ems", "light", "heavy"], lengthKm: 2.6 },
    { id: "E-ELM", from: "PIN", to: "ELM", name: "Elm Flats track", baseModes: ["ems", "light"], lengthKm: 2.8 },
    { id: "E-STL-SHEL", from: "STL", to: "FAC-STL", name: "Grange Road", baseModes: ["ems", "light", "heavy"], lengthKm: 0.7 },
    { id: "E-CAUSEWAY", from: "STL", to: "MIL", name: "Stillwater Causeway", entityId: "STL-CAUSEWAY", baseModes: ["ems", "light", "heavy"], lengthKm: 3.4 },
    { id: "E-MIL-NF", from: "MIL", to: "J-NF", name: "North Fork Road", baseModes: ["ems", "light", "heavy"], lengthKm: 2.5 },
    { id: "E-MIL-GRV", from: "MIL", to: "J-GRV", name: "Graves Road", baseModes: ["ems", "light", "heavy"], lengthKm: 2.0 },
    { id: "E-GRV-R9", from: "J-GRV", to: "J-R9-N", name: "Graves Road east (gravel)", baseModes: ["light"], lengthKm: 1.4 },
    { id: "E-KEEL", from: "MIL", to: "KEE", name: "Keel Ridge Road", entityId: "KEEL-RD", baseModes: ["ems", "light", "heavy"], lengthKm: 3.9 },
    { id: "E-STL-KEE", from: "STL", to: "KEE", name: "Stillwater back road", baseModes: ["light"], lengthKm: 4.6 },
    { id: "E-UPH", from: "KEE", to: "UPH", name: "Upper Harlan Road", baseModes: ["ems", "light", "heavy"], lengthKm: 2.7 },
    { id: "E-WTP", from: "UPH", to: "FAC-WTP", name: "Water Works Road", baseModes: ["ems", "light", "heavy"], lengthKm: 1.1 },

    // North east
    { id: "E-R9-N", from: "J-R9-N", to: "CAR", name: "Route 9 north", baseModes: ["ems", "light", "heavy"], lengthKm: 2.3 },
    { id: "E-CAR-FIRE", from: "CAR", to: "FAC-CAR", name: "Firehouse Road", baseModes: ["ems", "light", "heavy"], lengthKm: 0.6 },
    { id: "E-NF-BRIDGE", from: "J-NF", to: "BRE", name: "North Fork Bridge", entityId: "NF-BRIDGE", baseModes: ["ems", "light", "heavy"], lengthKm: 0.4 },
    { id: "E-HATCHER", from: "CAR", to: "HAT", name: "Hatcher Road", entityId: "HATCHER-RD", baseModes: ["ems", "light", "heavy"], lengthKm: 3.3 },
    { id: "E-BRE-HAT", from: "BRE", to: "HAT", name: "Mill Track", baseModes: ["ems", "light", "heavy"], lengthKm: 3.6 },
    { id: "E-BRE-UPH", from: "BRE", to: "UPH", name: "Brennan Hill Road", baseModes: ["light"], lengthKm: 3.8 },
  ],
  entities: [
    {
      id: "CR14-BRIDGE",
      kind: "bridge",
      name: "County Road 14 Bridge",
      aliases: ["County Road 14 Bridge", "CR-14 bridge", "County 14 bridge", "the north bridge", "Harlan Creek bridge on 14", "the 14 span"],
    },
    {
      id: "CR14-TEMP",
      kind: "temporary_crossing",
      name: "CR-14 temporary crossing",
      aliases: ["CR-14 temporary crossing", "temporary crossing", "temp bridge at County 14", "emergency crossing beside the 14 bridge", "panel bridge at CR-14"],
    },
    {
      id: "CULVERT-M8",
      kind: "culvert",
      name: "Mile 8 culvert, Route 9",
      aliases: ["Mile 8 culvert", "culvert at mile 8", "Route 9 culvert", "Route 9 at mile marker 8", "the mile 8 pipe"],
    },
    { id: "OAK-FORD", kind: "ford", name: "Oak Road ford", aliases: ["Oak Road ford", "Oak Road low-water crossing", "Oak Rd crossing", "Oak Road"] },
    { id: "ASHBY-RD", kind: "road_segment", name: "Ashby Road", aliases: ["Ashby Road", "Ashby Rd washout", "the road to Ashby"] },
    { id: "DUN-UNDERPASS", kind: "underpass", name: "Dunmore Road underpass", aliases: ["Dunmore underpass", "Dunmore Road underpass", "rail underpass at Dunmore"] },
    { id: "PINE-LANE", kind: "road_segment", name: "Pine Hollow Lane", aliases: ["Pine Hollow Lane", "Pine Hollow road"] },
    { id: "STL-CAUSEWAY", kind: "causeway", name: "Stillwater Causeway", aliases: ["Stillwater Causeway", "the causeway to Millbrook"] },
    { id: "NF-BRIDGE", kind: "bridge", name: "North Fork Bridge", aliases: ["North Fork bridge", "Brennan bridge", "the bridge to Brennan"] },
    { id: "HATCHER-RD", kind: "road_segment", name: "Hatcher Road", aliases: ["Hatcher Road", "Hatcher Rd", "the road to Hatcher's Mill"] },
    { id: "KEEL-RD", kind: "road_segment", name: "Keel Ridge Road", aliases: ["Keel Ridge Road", "Keel Ridge slide", "the road up to Upper Harlan"] },
  ],
  interventions: [
    { id: "INT-CR14-REPAIR", targetEntityId: "CR14-BRIDGE", label: "Repair County Road 14 Bridge", kind: "repair", costUsd: 180_000, durationHours: 48, resultStatus: "OPEN", resultModes: ["ems", "light", "heavy"], applicableWhen: ["LIMITED", "CLOSED", "UNCERTAIN"] },
    { id: "INT-CR14-REPLACE", targetEntityId: "CR14-BRIDGE", label: "Replace County Road 14 Bridge span", kind: "repair", costUsd: 1_250_000, durationHours: 504, resultStatus: "OPEN", resultModes: ["ems", "light", "heavy"], applicableWhen: ["DAMAGED"] },
    { id: "INT-CR14-TEMP", targetEntityId: "CR14-TEMP", label: "Install CR-14 temporary crossing", kind: "temporary", costUsd: 40_000, durationHours: 12, resultStatus: "LIMITED", resultModes: ["ems", "light"] },
    { id: "INT-CULVERT-M8", targetEntityId: "CULVERT-M8", label: "Replace Mile 8 culvert", kind: "repair", costUsd: 65_000, durationHours: 24, resultStatus: "OPEN", resultModes: ["ems", "light", "heavy"] },
    { id: "INT-OAK-FORD", targetEntityId: "OAK-FORD", label: "Grade Oak Road ford for light vehicles", kind: "temporary", costUsd: 15_000, durationHours: 8, resultStatus: "LIMITED", resultModes: ["light"] },
    { id: "INT-KEEL", targetEntityId: "KEEL-RD", label: "Clear Keel Ridge landslide", kind: "clearance", costUsd: 95_000, durationHours: 36, resultStatus: "OPEN", resultModes: ["ems", "light", "heavy"] },
    { id: "INT-NF-BRIDGE", targetEntityId: "NF-BRIDGE", label: "Shore North Fork Bridge", kind: "temporary", costUsd: 120_000, durationHours: 72, resultStatus: "LIMITED", resultModes: ["ems", "light"] },
    { id: "INT-DUN-PUMP", targetEntityId: "DUN-UNDERPASS", label: "Pump out Dunmore underpass", kind: "pumping", costUsd: 25_000, durationHours: 10, resultStatus: "OPEN", resultModes: ["ems", "light", "heavy"] },
    { id: "INT-ASHBY", targetEntityId: "ASHBY-RD", label: "Fill Ashby Road washout", kind: "repair", costUsd: 30_000, durationHours: 16, resultStatus: "OPEN", resultModes: ["ems", "light", "heavy"] },
    { id: "INT-HATCHER", targetEntityId: "HATCHER-RD", label: "Clear Hatcher Road debris", kind: "clearance", costUsd: 12_000, durationHours: 6, resultStatus: "OPEN", resultModes: ["ems", "light", "heavy"] },
  ],
};

export function regionEntityName(id: string): string {
  return HARLAN_VALLEY.entities.find((e) => e.id === id)?.name ?? id;
}
