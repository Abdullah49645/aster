import { afterEach, describe, expect, it } from "vitest";
import { PulseClient, PulseError, pulseFromEnv, pulseKeys } from "../src/pulse/client";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("multiple Neural Pulse keys", () => {
  it("parses comma, space and newline separated keys, dropping blanks and duplicates", () => {
    process.env.EVOROZEN_API_KEYS = "evo_a, evo_b,,evo_c\nevo_a ";
    expect(pulseKeys()).toEqual(["evo_a", "evo_b", "evo_c"]);
  });

  it("still accepts the single-key variable", () => {
    delete process.env.EVOROZEN_API_KEYS;
    process.env.EVOROZEN_API_KEY = "evo_single";
    expect(pulseKeys()).toEqual(["evo_single"]);
  });

  it("builds a client for a specific key and falls back to the first for a bad index", async () => {
    process.env.EVOROZEN_API_KEYS = "evo_a,evo_b";
    const seen: string[] = [];
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("Authorization")!);
      return new Response(JSON.stringify({ tables: [] }), { status: 200 });
    }) as typeof fetch;
    const b = pulseFromEnv(undefined, 1);
    // swap in the fake fetch without touching the key selection
    await new PulseClient({ apiKey: (b as unknown as { opts: { apiKey: string } }).opts.apiKey, fetchImpl }).listTables();
    const bad = pulseFromEnv(undefined, 9);
    await new PulseClient({ apiKey: (bad as unknown as { opts: { apiKey: string } }).opts.apiKey, fetchImpl }).listTables();
    expect(seen).toEqual(["Bearer evo_b", "Bearer evo_a"]);
  });

  it("recognises usage-limit errors and does not burn a retry on them", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: "Daily request limit exceeded" }), { status: 429 });
    }) as typeof fetch;
    const c = new PulseClient({ apiKey: "evo_x", fetchImpl, retries: 1 });
    const err = await c.listTables().catch((e) => e as PulseError);
    expect(err).toBeInstanceOf(PulseError);
    expect(err.quota).toBe(true);
    expect(calls).toBe(1);
  });

  it("treats a 403 mentioning quota as a limit, but not a plain 403", () => {
    expect(new PulseError("Quota exceeded for this key", "http", 403).quota).toBe(true);
    expect(new PulseError("Invalid API key", "http", 403).quota).toBe(false);
  });

  it("still retries server errors once", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ tables: [] }), { status: 200 });
    }) as typeof fetch;
    await new PulseClient({ apiKey: "evo_x", fetchImpl, retries: 1 }).listTables();
    expect(calls).toBe(2);
  });
});

describe("live API contract: prompt is required", () => {
  it("sends a non-empty prompt on every data action", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: [], tables: [] }), { status: 200 });
    }) as typeof fetch;
    const c = new PulseClient({ apiKey: "evo_x", fetchImpl });
    await c.listTables();
    await c.select("aster_observations", { filter: { incident_id: "inc_1" } });
    await c.chat("Extract claims");
    for (const b of bodies) expect(typeof b.prompt === "string" && (b.prompt as string).trim().length > 0).toBe(true);
    expect(bodies[1].prompt).toContain("select_data");
    expect(bodies[1].prompt).toContain("aster_observations");
    expect(bodies[2].prompt).toBe("Extract claims");
  });
});

describe("slow live API safety", () => {
  it("never auto-retries an insert that timed out or failed (it may have been applied)", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    const c = new PulseClient({ apiKey: "evo_x", fetchImpl, retries: 1 });
    await c.bulkInsert("t", [{ a: 1 }]).catch(() => undefined);
    expect(calls).toBe(1);
    await c.upsert("t", { a: 1 }, ["a"]).catch(() => undefined);
    expect(calls).toBe(3); // idempotent upsert is retried once
  });
});

describe("upsert fallback", () => {
  it("falls back to update-then-insert when the live API rejects upsert_data", async () => {
    const actions: string[] = [];
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      actions.push(b.action_type);
      if (b.action_type === "upsert_data") return new Response(JSON.stringify({ error: "record is required" }), { status: 400 });
      if (b.action_type === "update_data") return new Response(JSON.stringify({ modified_count: 0 }), { status: 200 });
      return new Response(JSON.stringify({ status: "success" }), { status: 200 });
    }) as typeof fetch;
    await new PulseClient({ apiKey: "evo_x", fetchImpl }).upsert("t", { k: "a", v: 1 }, ["k"]);
    expect(actions).toEqual(["upsert_data", "update_data", "insert_data"]);
  });
});
