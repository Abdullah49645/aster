import { NextResponse } from "next/server";
import { pulseFromEnv, pulseKeys } from "@/src/pulse/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Checks the first key only (each check costs one Pulse call). */
export async function GET() {
  const count = pulseKeys().length;
  if (count === 0) return NextResponse.json({ ok: true, pulse: "not_configured", keys: 0 });
  const t0 = Date.now();
  try {
    await pulseFromEnv(undefined, 0).listTables();
    return NextResponse.json({ ok: true, pulse: "reachable", keys: count, ms: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({ ok: false, pulse: "unreachable", keys: count, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
