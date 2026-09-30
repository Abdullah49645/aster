import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { pulseFromEnv, pulseKeys } from "@/src/pulse/client";
import { setupPulse } from "@/src/pulse/store";
import { jsonError } from "@/src/server/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** One-time: register ASTER's tables and seed aliases on EVERY configured key. Admin only. Idempotent. */
export async function POST(req: Request) {
  const expected = process.env.ASTER_ADMIN_TOKEN ?? "";
  const given = req.headers.get("x-admin-token") ?? "";
  const ok = expected.length >= 16 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return jsonError(401, "Missing or invalid admin token.");
  const keys = pulseKeys();
  if (keys.length === 0) return jsonError(503, "No Neural Pulse key is configured (EVOROZEN_API_KEYS).");
  const results = [];
  for (let i = 0; i < keys.length; i++) {
    try {
      results.push({ key: i + 1, ok: true, ...(await setupPulse(pulseFromEnv(undefined, i))) });
    } catch (e) {
      results.push({ key: i + 1, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ keys: results }, { status: results.every((r) => r.ok) ? 200 : 207 });
}
