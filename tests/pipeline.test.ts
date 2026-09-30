import { beforeEach, describe, expect, it } from "vitest";
import { PulseClient } from "../src/pulse/client";
import { confirmResolution, createIncident, ingestReport, loadIncident, setupPulse } from "../src/pulse/store";
import { interpretWithRules, parseChatClaims } from "../src/pulse/interpret";
import { decide } from "../src/pulse/resolve";
import { T } from "../src/pulse/tables";
import { FakePulse } from "./fake-pulse";

const NOW = Date.parse("2026-09-28T12:00:00Z");
let fake: FakePulse;
let pulse: PulseClient;

async function freshIncident(opts: ConstructorParameters<typeof FakePulse>[0] = {}) {
  fake = new FakePulse(opts);
  pulse = new PulseClient({ apiKey: "evo_test", fetchImpl: fake.fetch as typeof fetch, retries: 0 });
  await setupPulse(pulse);
  const id = await createIncident(pulse, NOW);
  return (await loadIncident(pulse, id))!;
}

describe("interpretation", () => {
  it("rules: splits multi-entity reports and classifies each", () => {
    const c = interpretWithRules("Bridge damage worsened. Temporary crossing is closed.");
    expect(c.map((x) => x.status)).toEqual(["DAMAGED", "CLOSED"]);
  });
  it("rules: emergency-only access", () => {
    expect(interpretWithRules("Temporary crossing is now usable by emergency vehicles.")[0]).toMatchObject({ status: "LIMITED", modes: ["ems"] });
  });
  it("rules: hedging", () => {
    expect(interpretWithRules("Heard the Stillwater Causeway may be unsafe for trucks.")[0].hedged).toBe(true);
  });
  it("rules: plans are not status", () => {
    expect(interpretWithRules("Crew expects culvert repair tomorrow.")).toEqual([]);
  });
  it("chat: accepts valid JSON inside prose, rejects malformed output", () => {
    expect(parseChatClaims('Sure! {"claims":[{"mention":"CR-14 bridge","status":"CLOSED","modes":[],"hedged":false}]}')).toHaveLength(1);
    expect(parseChatClaims('{"claims":[{"mention":"x","status":"EXPLODED"}]}')).toBeNull();
    expect(parseChatClaims("I can help you design a schema.")).toBeNull();
  });
});

describe("resolution decision rule", () => {
  const known = new Set(["A", "B"]);
  it("auto-resolves a clear scored winner", () => {
    expect(decide([{ entity_id: "A", score: 0.9 }, { entity_id: "B", score: 0.6 }], known, "vector_search").outcome).toBe("auto");
  });
  it("flags close scores as ambiguous", () => {
    expect(decide([{ entity_id: "A", score: 0.71 }, { entity_id: "B", score: 0.69 }], known, "vector_search")).toMatchObject({ outcome: "ambiguous", entityId: null });
  });
  it("works from ranking alone when Pulse returns no scores", () => {
    expect(decide([{ entity_id: "A" }, { entity_id: "A" }, { entity_id: "B" }], known, "vector_search").outcome).toBe("auto");
    expect(decide([{ entity_id: "A" }, { entity_id: "B" }], known, "vector_search").outcome).toBe("ambiguous");
  });
  it("ignores entities it does not know", () => {
    expect(decide([{ entity_id: "ZZZ", score: 0.99 }], known, "vector_search").outcome).toBe("unresolved");
  });
});

describe("Pulse operational memory", () => {
  it("setup registers every table and seeds aliases once", async () => {
    await freshIncident();
    expect([...fake.tables.keys()].sort()).toEqual([T.aliases(), T.entityState(), T.incidents(), T.observations(), T.transitions()].sort());
    const aliasCount = fake.tables.get(T.aliases())!.rows.length;
    await setupPulse(pulse);
    expect(fake.tables.get(T.aliases())!.rows.length).toBe(aliasCount);
  });

  it("a loaded incident's state comes from Pulse and matches the ledger fold", async () => {
    const s = await freshIncident();
    expect(s.source).toBe("live");
    expect(s.drift).toEqual([]);
    expect(s.entities["CULVERT-M8"].status).toBe("CLOSED");
    expect(s.entities["CULVERT-M8"].superseded.length).toBe(2);
  });

  it("detects drift when materialized state disagrees with the ledger", async () => {
    const s = await freshIncident();
    const row = fake.tables.get(T.entityState())!.rows.find((r) => r.entity_id === "DUN-UNDERPASS")!;
    row.status = "OPEN";
    const again = await loadIncident(pulse, s.incidentId);
    expect(again!.drift).toEqual(["DUN-UNDERPASS"]);
  });
});

describe("resilience to duplicated / altered rows from the live service", () => {
  it("dedupes rows, restores seeded content, and derives state only from the ledger", async () => {
    const s = await freshIncident();
    const r = await ingestReport(pulse, s, { text: "County 14 bridge is completely closed.", source: "engineer" }, "rules", NOW + 60_000);
    const obs = fake.tables.get(T.observations())!.rows;
    // What the live service did: duplicate rows, and an Oak Road ford seed row copied with the bridge's id.
    const oak = obs.find((o) => String(o.obs_id).endsWith(":s02"))!;
    obs.push({ ...oak, entity_id: "CR14-BRIDGE", superseded_by: "junk" });
    const reportRow = obs.find((o) => o.report_id === r.reportId)!;
    obs.push({ ...reportRow }, { ...reportRow });
    const st = fake.tables.get(T.entityState())!.rows;
    st.push({ ...st.find((x) => x.entity_id === "CR14-BRIDGE")!, status: "OPEN", state_version: 0 });

    const again = (await loadIncident(pulse, s.incidentId))!;
    const ids = again.observations.map((o) => o.obsId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(again.observations.find((o) => o.obsId.endsWith(":s02"))?.entityId).toBe("OAK-FORD");
    expect(again.entities["CR14-BRIDGE"].status).toBe("CLOSED");
    expect(again.entities["CR14-BRIDGE"].supporting.every((id) => !id.endsWith(":s02") && !id.endsWith(":s13"))).toBe(true);
    expect(again.entities["OAK-FORD"].status).toBe("CLOSED");
  });

  it("never edits existing ledger rows", async () => {
    const s = await freshIncident();
    await ingestReport(pulse, s, { text: "County 14 bridge is completely closed.", source: "engineer" }, "rules", NOW + 60_000);
    expect(fake.calls.some((c) => c.action === "update_data")).toBe(false);
  });
});

describe("end to end: observation → Neural Pulse → state → network → recommendation", () => {
  beforeEach(() => undefined);

  it("a closure report changes state, supersedes evidence, and changes the recommendation", async () => {
    const s = await freshIncident();
    expect(s.entities["CR14-BRIDGE"].status).toBe("LIMITED");
    const r = await ingestReport(pulse, s, { text: "County 14 bridge is completely closed after the second span shifted.", source: "engineer" }, "rules", NOW + 60_000);

    expect(r.changedEntities).toContain("CR14-BRIDGE");
    expect(r.snapshot.entities["CR14-BRIDGE"].status).toBe("CLOSED");
    expect(r.recommendationBefore).not.toEqual(r.recommendationAfter);
    expect(r.recommendationAfter).toEqual(["INT-CR14-REPAIR"]);

    // Persisted in Pulse, not just returned
    const reloaded = (await loadIncident(pulse, s.incidentId))!;
    expect(reloaded.entities["CR14-BRIDGE"].status).toBe("CLOSED");
    expect(reloaded.stateVersion).toBe(2);
    expect(reloaded.transitions.some((t) => t.entityId === "CR14-BRIDGE" && t.toStatus === "CLOSED")).toBe(true);
    const oldObs = reloaded.observations.filter((o) => o.entityId === "CR14-BRIDGE" && o.supersededBy);
    expect(oldObs.length).toBeGreaterThan(0);
    expect(reloaded.drift).toEqual([]);

    // The full trace is visible
    expect(r.trace.map((t) => t.stage)).toEqual(["interpret", "resolve", "ledger", "fold", "state", "recompute"]);
    expect(r.trace.flatMap((t) => t.calls).every((c) => c.ok)).toBe(true);
  });

  it("the full demo sequence recomputes the recommendation at every step", async () => {
    let s = await freshIncident();
    const step = async (text: string, source: "engineer" | "field_crew", t: number) => {
      const r = await ingestReport(pulse, s, { text, source }, "rules", NOW + t * 60_000);
      s = r.snapshot;
      return r;
    };
    expect((await step("County 14 bridge is completely closed after the second span shifted.", "engineer", 1)).recommendationAfter).toEqual(["INT-CR14-REPAIR"]);
    const temp = await step("Temporary crossing is now usable by emergency vehicles.", "field_crew", 2);
    expect(temp.snapshot.entities["CR14-TEMP"]).toMatchObject({ status: "LIMITED", modes: ["ems"] });
    const worse = await step("CR-14 bridge damage worsened. Temporary crossing is closed.", "field_crew", 3);
    expect(worse.snapshot.entities["CR14-BRIDGE"].status).toBe("DAMAGED");
    expect(worse.snapshot.entities["CR14-TEMP"].status).toBe("CLOSED");
    expect(worse.recommendationAfter).toEqual(["INT-CR14-TEMP"]);
    // A vaguer public report afterwards must not undo the damage assessment.
    const vague = await step("County 14 bridge is shut.", "field_crew", 4);
    expect(vague.snapshot.entities["CR14-BRIDGE"].status).toBe("DAMAGED");
    expect(vague.recommendationAfter).toEqual(["INT-CR14-TEMP"]);
  });

  it("an unqualified 'the bridge' is ambiguous even with similarity scores", async () => {
    const s = await freshIncident();
    const r = await ingestReport(pulse, s, { text: "The bridge is shut.", source: "public" }, "rules", NOW + 60_000);
    expect(r.pending).toHaveLength(1);
    expect(r.pending[0].candidates.map((c) => c.entityId)).toEqual(expect.arrayContaining(["CR14-BRIDGE", "NF-BRIDGE"]));
  });

  it("uses Neural Pulse chat output when it is valid", async () => {
    const s = await freshIncident({
      chat: () => '{"claims":[{"mention":"Oak Road low-water crossing","status":"LIMITED","modes":["light"],"hedged":false}]}',
    });
    const r = await ingestReport(pulse, s, { text: "Oak Road is technically open to 4x4 vehicles now.", source: "field_crew" }, "pulse-chat", NOW + 60_000);
    expect(r.trace[0].title).toBe("Interpreted by Neural Pulse");
    expect(r.snapshot.entities["OAK-FORD"]).toMatchObject({ status: "LIMITED", modes: ["light"] });
    expect(r.snapshot.observations.find((o) => o.reportId === r.reportId)?.interpreter).toBe("pulse-chat");
  });

  it("falls back to rules — and says so — when chat output is unusable", async () => {
    const s = await freshIncident({ chat: () => "Here is a schema for your products table." });
    const r = await ingestReport(pulse, s, { text: "Pine Hollow Lane is blocked by a tree.", source: "public" }, "pulse-chat", NOW + 60_000);
    expect(r.trace[0].outcome).toBe("warn");
    expect(r.trace[0].detail[0]).toMatch(/rules interpreter/);
    expect(r.snapshot.observations.find((o) => o.reportId === r.reportId)?.interpreter).toBe("rules");
  });

  it("an ambiguous mention is recorded but changes nothing until a person resolves it; the phrasing is learned", async () => {
    const s = await freshIncident({ vectorScores: false });
    const r = await ingestReport(pulse, s, { text: "The bridge is shut.", source: "public" }, "rules", NOW + 60_000);
    expect(r.pending).toHaveLength(1);
    expect(r.changedEntities).toEqual([]);
    expect(r.snapshot.entities["CR14-BRIDGE"].status).toBe("LIMITED");
    const pending = r.pending[0];
    expect(pending.candidates.length).toBeGreaterThan(1);

    const done = await confirmResolution(pulse, r.snapshot, { obsId: pending.obsId, entityId: "NF-BRIDGE" }, NOW + 120_000);
    expect(done.snapshot.observations.find((o) => o.obsId === pending.obsId)?.resolution).toBe("human");
    expect(fake.tables.get(T.aliases())!.rows.some((a) => a.origin === "learned" && a.entity_id === "NF-BRIDGE")).toBe(true);
  });

  it("hedged reports produce UNCERTAIN state, never silent truth", async () => {
    const s = await freshIncident();
    const r = await ingestReport(pulse, s, { text: "Heard the Stillwater Causeway may be unsafe for trucks.", source: "public" }, "rules", NOW + 60_000);
    expect(r.snapshot.entities["STL-CAUSEWAY"].status).toBe("UNCERTAIN");
    expect(r.snapshot.entities["STL-CAUSEWAY"].alternatives).toHaveLength(2);
  });

  it("local names in memory resolve automatically ('the north bridge' is CR-14 here)", async () => {
    const s = await freshIncident();
    const r = await ingestReport(pulse, s, { text: "The north bridge is shut.", source: "engineer" }, "rules", NOW + 60_000);
    expect(r.pending).toEqual([]);
    expect(r.snapshot.entities["CR14-BRIDGE"].status).toBe("CLOSED");
  });

  it("a report with no infrastructure status writes nothing", async () => {
    const s = await freshIncident();
    const before = fake.tables.get(T.observations())!.rows.length;
    const r = await ingestReport(pulse, s, { text: "Crew expects culvert repair tomorrow.", source: "field_crew" }, "rules", NOW + 60_000);
    expect(r.changedEntities).toEqual([]);
    expect(fake.tables.get(T.observations())!.rows.length).toBe(before);
  });

  it("surfaces Pulse outages instead of inventing state", async () => {
    const s = await freshIncident();
    fake.opts.failActions = new Set(["bulk_insert"]);
    await expect(
      ingestReport(pulse, s, { text: "County 14 bridge is completely closed.", source: "engineer" }, "rules", NOW + 60_000),
    ).rejects.toMatchObject({ name: "PulseError", status: 503 });
    fake.opts.failActions = undefined;
    const reloaded = await loadIncident(pulse, s.incidentId);
    expect(reloaded!.entities["CR14-BRIDGE"].status).toBe("LIMITED");
  });
});
