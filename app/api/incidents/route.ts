import { NextResponse } from "next/server";
import { pulseFromEnv, pulseKeys, PulseError, type PulseClient } from "@/src/pulse/client";
import { createIncident, loadIncident, setupPulse } from "@/src/pulse/store";
import { writeSession } from "@/src/server/session";
import { clientKey, jsonError, pulseFailure, rateLimit } from "@/src/server/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Round-robin start point so visitors spread across keys (per server instance). */
let nextStart = 0;

async function createOn(pulse: PulseClient): Promise<string> {
  try {
    return await createIncident(pulse);
  } catch (e) {
    // A key whose tables were never set up: set them up once and retry.
    if (e instanceof PulseError && e.kind === "http" && !e.quota && /table|not found|does not exist|unknown/i.test(e.message)) {
      await setupPulse(pulse);
      return await createIncident(pulse);
    }
    throw e;
  }
}

/**
 * Load a fresh copy of the demo incident into Neural Pulse for this visitor.
 * Tries each configured key in turn, skipping keys that are at their limit or unreachable.
 * The chosen key is remembered in a cookie (as an index) because the incident's data lives there.
 */
export async function POST(req: Request) {
  if (!rateLimit(`incident:${clientKey(req)}`, 3, 2)) return jsonError(429, "Too many new incidents from this address. Wait a minute and try again.");
  const keys = pulseKeys();
  if (keys.length === 0) return jsonError(503, "Neural Pulse is not configured on this deployment.");

  const start = nextStart++ % keys.length;
  const skipped: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    const keyIndex = (start + i) % keys.length;
    const pulse = pulseFromEnv(undefined, keyIndex);
    try {
      const incidentId = await createOn(pulse);
      const snapshot = await loadIncident(pulse, incidentId);
      if (!snapshot) return jsonError(502, "The incident was written to Neural Pulse but could not be read back. Try loading it again.");
      await writeSession(incidentId, keyIndex);
      return NextResponse.json({ snapshot, pulseConfigured: true, keyIndex, keyCount: keys.length }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof PulseError && (e.quota || e.transient)) {
        skipped.push(`key ${keyIndex + 1}: ${e.quota ? "limit reached" : e.message}`);
        continue;
      }
      return pulseFailure(e);
    }
  }
  return jsonError(429, `Every configured Neural Pulse key is at its limit or unreachable (${skipped.join("; ")}). Try again later.`);
}
