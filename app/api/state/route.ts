import { NextResponse } from "next/server";
import { pulseFromEnv, pulseKeys, PulseError } from "@/src/pulse/client";
import { cachedSnapshot, loadIncident } from "@/src/pulse/store";
import { readSession } from "@/src/server/session";
import { QUOTA_MESSAGE, pulseFailure } from "@/src/server/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  if (pulseKeys().length === 0) {
    return NextResponse.json(
      {
        snapshot: cachedSnapshot("Neural Pulse is not configured on this deployment, so this is the seeded demo state computed locally. Reports cannot be submitted."),
        pulseConfigured: false,
      },
      noStore,
    );
  }
  const session = await readSession();
  if (!session) return NextResponse.json({ needsIncident: true, pulseConfigured: true }, noStore);
  const pulse = pulseFromEnv(undefined, session.keyIndex);
  try {
    const snapshot = await loadIncident(pulse, session.incidentId);
    if (!snapshot) return NextResponse.json({ needsIncident: true, pulseConfigured: true }, noStore);
    return NextResponse.json({ snapshot, pulseConfigured: true }, noStore);
  } catch (e) {
    if (e instanceof PulseError && (e.quota || e.transient)) {
      const reason = e.quota
        ? `${QUOTA_MESSAGE} Until then this is the seeded demo state computed locally.`
        : `Neural Pulse is unreachable (${e.message}). Showing the seeded demo state computed locally. New reports are paused until Pulse responds.`;
      return NextResponse.json({ snapshot: cachedSnapshot(reason), pulseConfigured: true }, noStore);
    }
    return pulseFailure(e);
  }
}
