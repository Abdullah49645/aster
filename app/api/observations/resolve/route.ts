import { NextResponse } from "next/server";
import { pulseFromEnv, pulseKeys, PulseError } from "@/src/pulse/client";
import { confirmResolution, loadIncident } from "@/src/pulse/store";
import { readSession } from "@/src/server/session";
import { ResolveInput, clientKey, jsonError, pulseFailure, rateLimit } from "@/src/server/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** A person resolves an ambiguous mention. The phrasing becomes a learned alias in Pulse memory. */
export async function POST(req: Request) {
  if (!rateLimit(`resolve:${clientKey(req)}`, 10, 10)) return jsonError(429, "Too many requests. Wait a minute and try again.");
  const parsed = ResolveInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, "Choose one of the listed infrastructure entities.");
  if (pulseKeys().length === 0) return jsonError(503, "Neural Pulse is not configured on this deployment.");
  const session = await readSession();
  if (!session) return jsonError(409, "Load the demo incident first.");
  const pulse = pulseFromEnv(undefined, session.keyIndex);
  try {
    const snapshot = await loadIncident(pulse, session.incidentId);
    if (!snapshot) return jsonError(409, "This incident no longer exists in Neural Pulse. Load the demo incident again.");
    const result = await confirmResolution(pulse, snapshot, parsed.data);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof PulseError && e.kind === "config" && !e.action) return jsonError(400, e.message);
    return pulseFailure(e);
  }
}
