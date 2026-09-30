import { cookies } from "next/headers";
import { pulseKeys } from "../pulse/client";

const INCIDENT = "aster_incident";
const KEY = "aster_key";
const ID = /^inc_[a-f0-9]{16}$/;

const opts = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 14,
});

/**
 * The visitor's incident and WHICH configured key it lives on (an index, never the key itself).
 * An incident's data is stored under one key, so every request for it must use that same key.
 */
export async function readSession(): Promise<{ incidentId: string; keyIndex: number } | null> {
  const jar = await cookies();
  const id = jar.get(INCIDENT)?.value ?? null;
  if (!id || !ID.test(id)) return null;
  const idx = Number(jar.get(KEY)?.value ?? "0");
  const keyIndex = Number.isInteger(idx) && idx >= 0 && idx < pulseKeys().length ? idx : 0;
  return { incidentId: id, keyIndex };
}

export async function writeSession(incidentId: string, keyIndex: number) {
  const jar = await cookies();
  jar.set(INCIDENT, incidentId, opts());
  jar.set(KEY, String(keyIndex), opts());
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(INCIDENT);
  jar.delete(KEY);
}
