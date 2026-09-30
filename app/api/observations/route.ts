import { NextResponse } from "next/server";
import { pulseFromEnv, pulseKeys } from "@/src/pulse/client";
import { ingestReport, loadIncident } from "@/src/pulse/store";
import type { SourceKind } from "@/src/engine/types";
import { readSession } from "@/src/server/session";
import { ReportInput, clientKey, interpreterMode, jsonError, pulseFailure, rateLimit } from "@/src/server/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Submit a free-text field report: interpret → resolve → ledger → fold → state → recompute. */
export async function POST(req: Request) {
  if (!rateLimit(`report:${clientKey(req)}`, 10, 10)) return jsonError(429, "Too many reports from this address. Wait a minute and try again.");
  const body = await req.json().catch(() => null);
  const parsed = ReportInput.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid report.");

  if (pulseKeys().length === 0) return jsonError(503, "Neural Pulse is not configured on this deployment, so reports cannot be recorded.");
  const session = await readSession();
  if (!session) return jsonError(409, "Load the demo incident first.");
  const pulse = pulseFromEnv(undefined, session.keyIndex);
  try {
    const snapshot = await loadIncident(pulse, session.incidentId);
    if (!snapshot) return jsonError(409, "This incident no longer exists in Neural Pulse. Load the demo incident again.");
    const result = await ingestReport(pulse, snapshot, { text: parsed.data.text, source: parsed.data.source as SourceKind }, interpreterMode());
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return pulseFailure(e);
  }
}
