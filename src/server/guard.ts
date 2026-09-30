import { NextResponse } from "next/server";
import { z } from "zod";
import { SOURCES } from "../engine/types";
import { PulseError } from "../pulse/client";

// ---------------- validation ----------------

export const ReportInput = z.object({
  text: z
    .string()
    .trim()
    .min(4, "Write at least a few words about what was observed.")
    .max(500, "Keep a single report under 500 characters. Split longer updates into separate reports."),
  source: z.enum(SOURCES as unknown as [string, ...string[]]),
});

export const ResolveInput = z.object({
  obsId: z.string().min(3).max(200),
  entityId: z.string().min(2).max(60),
});

// ---------------- rate limiting ----------------
// Best-effort, per-instance token bucket. On serverless this bounds bursts per warm instance; it is a
// courtesy limit protecting the shared Pulse quota, not a security boundary.

const buckets = new Map<string, { tokens: number; at: number }>();

export function rateLimit(key: string, capacity: number, refillPerMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 60_000) * refillPerMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

// ---------------- responses ----------------

export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export const QUOTA_MESSAGE =
  "The Neural Pulse key this incident is stored on has reached its usage limit. Press Reset demo to continue on another key.";

export function pulseFailure(e: unknown) {
  if (e instanceof PulseError && e.quota) {
    return jsonError(429, QUOTA_MESSAGE, { pulse: { kind: e.kind, status: e.status, traceId: e.traceId, action: e.action } });
  }
  if (e instanceof PulseError) {
    if (e.kind === "config" && !e.action) return jsonError(400, e.message);
    const status = e.kind === "config" ? 503 : e.status === 429 ? 429 : 502;
    return jsonError(status, `Neural Pulse: ${e.message}`, { pulse: { kind: e.kind, status: e.status, traceId: e.traceId, action: e.action } });
  }
  console.error(e);
  return jsonError(500, "Unexpected server error. Nothing was written.");
}

export function interpreterMode(): "pulse-chat" | "rules" {
  return process.env.ASTER_INTERPRETER === "rules" ? "rules" : "pulse-chat";
}
