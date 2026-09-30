import { describe, expect, it } from "vitest";
import { HARLAN_VALLEY } from "../src/data/harlan-valley";
import { seedClaims } from "../src/data/seed";
import {
  applyInterventions,
  computeMetrics,
  DEFAULT_CONSTRAINTS,
  explain,
  foldEntity,
  foldWorld,
  normalizeModes,
  optimize,
  reachableFromHubs,
  stateHash,
  type Claim,
  type Constraints,
  type Region,
  type WorldState,
} from "../src/engine";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const claim = (obsId: string, entityId: string, status: Claim["status"], minute: number, extra: Partial<Claim> = {}): Claim => ({
  obsId,
  reportId: obsId,
  entityId,
  status,
  modes: normalizeModes(status, extra.modes ?? []),
  hedged: false,
  source: "field_crew",
  observedAt: new Date(NOW + minute * 60_000).toISOString(),
  rawText: obsId,
  ...extra,
});
const worldFrom = (claims: Claim[]): WorldState => ({ region: HARLAN_VALLEY, entities: foldWorld(HARLAN_VALLEY, claims).entities });
const seeded = () => seedClaims("inc", NOW);
const C = (c: Partial<Constraints> = {}): Constraints => ({ ...DEFAULT_CONSTRAINTS, ...c });

describe("world model: state fold", () => {
  it("evolves one entity through DAMAGED → LIMITED → CLOSED and keeps history", () => {
    const r = foldEntity("CULVERT-M8", [
      claim("a", "CULVERT-M8", "DAMAGED", 0),
      claim("b", "CULVERT-M8", "LIMITED", 60, { modes: ["light"] }),
      claim("c", "CULVERT-M8", "CLOSED", 120),
    ]);
    expect(r.state.status).toBe("CLOSED");
    expect(r.transitions.map((t) => t.toStatus)).toEqual(["DAMAGED", "LIMITED", "CLOSED"]);
    expect(r.state.superseded).toEqual(["a", "b"]);
    expect(r.supersededBy).toEqual({ a: "b", b: "c" });
  });

  it("keeps agreeing evidence as supporting, not superseded", () => {
    const r = foldEntity("CR14-BRIDGE", [
      claim("a", "CR14-BRIDGE", "CLOSED", 0),
      claim("b", "CR14-BRIDGE", "CLOSED", 10),
      claim("c", "CR14-BRIDGE", "CLOSED", 20),
    ]);
    expect(r.state.supporting).toEqual(["a", "b", "c"]);
    expect(r.state.superseded).toEqual([]);
    expect(r.state.confidence).toBeGreaterThan(0.85);
  });

  it("marks a hedged contradicting report UNCERTAIN without superseding firm evidence", () => {
    const r = foldEntity("CR14-BRIDGE", [
      claim("a", "CR14-BRIDGE", "LIMITED", 0, { modes: ["ems", "light"], source: "engineer" }),
      claim("b", "CR14-BRIDGE", "CLOSED", 30, { hedged: true, source: "public" }),
    ]);
    expect(r.state.status).toBe("UNCERTAIN");
    expect(r.state.alternatives?.map((a) => a.status)).toEqual(["LIMITED", "CLOSED"]);
    expect(r.state.superseded).toEqual([]);
  });

  it("treats a less reliable contradiction inside the window as UNCERTAIN, and a later firm report resolves it", () => {
    const r = foldEntity("OAK-FORD", [
      claim("a", "OAK-FORD", "CLOSED", 0, { source: "engineer" }),
      claim("b", "OAK-FORD", "OPEN", 30, { source: "public" }),
      claim("c", "OAK-FORD", "CLOSED", 60, { source: "engineer" }),
    ]);
    expect(r.transitions.map((t) => t.toStatus)).toEqual(["CLOSED", "UNCERTAIN", "CLOSED"]);
    expect(r.state.status).toBe("CLOSED");
    expect(r.supersededBy.b).toBe("c");
  });

  it("does not treat an escalation (CLOSED → DAMAGED) as a contradiction", () => {
    const r = foldEntity("CR14-BRIDGE", [claim("a", "CR14-BRIDGE", "CLOSED", 0, { source: "engineer" }), claim("b", "CR14-BRIDGE", "DAMAGED", 5, { source: "field_crew" })]);
    expect(r.state.status).toBe("DAMAGED");
  });

  it("is order-independent in input and stable in hash", () => {
    const a = foldWorld(HARLAN_VALLEY, seeded());
    const b = foldWorld(HARLAN_VALLEY, [...seeded()].reverse());
    expect(stateHash(a.entities)).toBe(stateHash(b.entities));
  });
});

describe("network engine", () => {
  const tiny: Region = {
    id: "t",
    name: "t",
    nodes: [
      { id: "H", name: "H", kind: "hub", x: 0, y: 0, properties: 0 },
      { id: "A", name: "A", kind: "settlement", x: 0, y: 0, properties: 10 },
      { id: "B", name: "B", kind: "settlement", x: 0, y: 0, properties: 5 },
      { id: "F", name: "F", kind: "facility", facility: "clinic", x: 0, y: 0, properties: 0 },
    ],
    edges: [
      { id: "HA", from: "H", to: "A", name: "", entityId: "X", baseModes: ["ems", "light", "heavy"], lengthKm: 1 },
      { id: "AB", from: "A", to: "B", name: "", baseModes: ["light"], lengthKm: 1 },
      { id: "AF", from: "A", to: "F", name: "", baseModes: ["ems", "light", "heavy"], lengthKm: 1 },
    ],
    entities: [{ id: "X", kind: "bridge", name: "X", aliases: [] }],
    interventions: [],
  };
  const w = (status: "OPEN" | "LIMITED" | "CLOSED", modes: ("ems" | "light" | "heavy")[] = []) => ({
    region: tiny,
    entities: { X: { entityId: "X", status, modes, confidence: 1, tentative: false, lastConfirmedAt: null, supporting: [], superseded: [] } },
  });

  it("closures disconnect everything behind them", () => {
    const m = computeMetrics(w("CLOSED"));
    expect(m.isolatedProperties).toBe(15);
    expect(m.facilitiesWithoutEms).toEqual(["F"]);
    expect(m.components).toBe(2); // {H} and {A, B, F}
  });

  it("partial capacity restricts by mode, and base link modes still apply", () => {
    const m = computeMetrics(w("LIMITED", ["light"]));
    expect(m.reachableProperties.light).toBe(15);
    expect(m.reachableProperties.ems).toBe(0);
    expect(reachableFromHubs(tiny, w("OPEN").entities, "heavy").has("B")).toBe(false);
  });
});

describe("scenario engine", () => {
  it("never mutates the live state", () => {
    const world = worldFrom(seeded());
    const before = JSON.stringify(world.entities);
    applyInterventions(world, HARLAN_VALLEY.interventions);
    optimize(world, C({ crews: 3 }));
    expect(JSON.stringify(world.entities)).toBe(before);
  });
});

describe("optimizer", () => {
  const closed = () => worldFrom([...seeded(), claim("d1", "CR14-BRIDGE", "CLOSED", 5, { source: "engineer" })]);

  it("recommends repairing CR-14 once it closes, with engine-derived consequences", () => {
    const r = optimize(closed(), C());
    expect(r.best?.ids).toEqual(["INT-CR14-REPAIR"]);
    expect(r.baseline.isolatedProperties).toBe(790);
    expect(r.best?.delta.lightProperties).toBe(680);
    expect(r.best?.delta.facilitiesWithEms).toBe(2);
  });

  it("recomputes under a budget rather than filtering a static list", () => {
    const r = optimize(closed(), C({ budgetUsd: 50_000 }));
    expect(r.best?.ids).toEqual(["INT-CR14-TEMP"]);
    expect(r.singles.find((s) => s.intervention.id === "INT-CR14-REPAIR")?.reasons).toContain("over_budget");
  });

  it("respects the time window", () => {
    const r = optimize(closed(), C({ windowHours: 10 }));
    expect(r.best?.durationHours).toBeLessThanOrEqual(10);
    expect(r.best?.ids).toEqual(["INT-OAK-FORD"]);
  });

  it("excludes a repair whose scope no longer matches the reported condition", () => {
    const w = worldFrom([...seeded(), claim("d1", "CR14-BRIDGE", "DAMAGED", 5, { source: "engineer" })]);
    const r = optimize(w, C());
    expect(r.singles.find((s) => s.intervention.id === "INT-CR14-REPAIR")?.reasons).toContain("outside_scope");
    expect(r.best?.ids).toEqual(["INT-CR14-TEMP"]);
  });

  it("finds multi-crew plans exactly and within budget", () => {
    const r = optimize(closed(), C({ crews: 3, budgetUsd: 150_000 }));
    expect(r.best!.costUsd).toBeLessThanOrEqual(150_000);
    expect(r.best!.ids.length).toBeGreaterThan(1);
    expect(r.best!.metrics.isolatedProperties).toBe(0);
  });

  it("is deterministic", () => {
    const a = optimize(closed(), C({ crews: 2 }));
    const b = optimize(closed(), C({ crews: 2 }));
    expect(a.ranked.map((c) => c.ids.join("+"))).toEqual(b.ranked.map((c) => c.ids.join("+")));
    expect(a.stateHash).toBe(b.stateHash);
  });

  it("rejects invalid constraints instead of guessing", () => {
    const r = optimize(closed(), C({ budgetUsd: -5 }));
    expect(r.best).toBeNull();
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it("returns no recommendation when nothing improves access", () => {
    const allOpen = worldFrom([]);
    expect(optimize(allOpen, C()).best).toBeNull();
  });

  it("the recommendation depends on the engine, not on a static ranking", () => {
    // Same interventions, different state ⇒ different answer.
    const a = optimize(worldFrom(seeded()), C()).best?.ids;
    const b = optimize(closed(), C()).best?.ids;
    expect(a).not.toEqual(b);
  });

  it("explains the recommendation and checks robustness under uncertainty", () => {
    const w = worldFrom([...seeded(), claim("d1", "CR14-BRIDGE", "CLOSED", 5, { source: "engineer" }), claim("d2", "OAK-FORD", "OPEN", 6, { hedged: true, source: "public" })]);
    const r = optimize(w, C());
    const e = explain(w, r)!;
    expect(e.reconnected.map((n) => n.id)).toContain("MIL");
    expect(e.facilitiesRestored.map((f) => f.id)).toContain("FAC-MIL");
    expect(e.robustness.find((x) => x.entityId === "OAK-FORD")).toBeDefined();
  });
});

describe("world model: damage is sticky", () => {
  it("a later CLOSED report supports, not erases, a DAMAGED assessment", () => {
    const r = foldEntity("CR14-BRIDGE", [
      claim("a", "CR14-BRIDGE", "CLOSED", 0, { source: "engineer" }),
      claim("b", "CR14-BRIDGE", "DAMAGED", 10),
      claim("c", "CR14-BRIDGE", "CLOSED", 20, { source: "public" }),
    ]);
    expect(r.state.status).toBe("DAMAGED");
    expect(r.state.supporting).toContain("c");
  });
  it("a passable report still clears damage", () => {
    const r = foldEntity("CR14-BRIDGE", [claim("a", "CR14-BRIDGE", "DAMAGED", 0), claim("b", "CR14-BRIDGE", "OPEN", 30, { source: "engineer" })]);
    expect(r.state.status).toBe("OPEN");
  });
});

describe("world model: provisional links", () => {
  it("a temporary crossing starts closed, so 'not in service' is not a transition", () => {
    const f = foldWorld(HARLAN_VALLEY, seeded());
    expect(f.entities["CR14-TEMP"].status).toBe("CLOSED");
    expect(f.transitions.some((t) => t.entityId === "CR14-TEMP")).toBe(false);
  });
});
