/**
 * Register ASTER's tables in Neural Pulse and seed entity aliases, on EVERY key in EVOROZEN_API_KEYS.
 * Safe to run again: existing tables and aliases are left alone.
 *   npm run pulse:setup
 */
import { PulseClient, pulseKeys } from "../src/pulse/client";
import { setupPulse } from "../src/pulse/store";

const keys = pulseKeys();
if (keys.length === 0) {
  console.error("No keys found. Put your keys in .env.local as EVOROZEN_API_KEYS=key1,key2,...");
  process.exit(1);
}

async function main() {
  let failed = 0;
  for (let i = 0; i < keys.length; i++) {
    console.log(`\nKey ${i + 1} of ${keys.length} (…${keys[i].slice(-4)})`);
    const pulse = new PulseClient({
      apiKey: keys[i],
      baseUrl: process.env.EVOROZEN_BASE_URL || undefined,
      onCall: (c) => console.log(`  ${c.ok ? "ok " : "ERR"} ${c.action.padEnd(14)} ${String(c.status).padEnd(4)} ${c.ms}ms${c.traceId ? ` trace=${c.traceId}` : ""}`),
    });
    try {
      const r = await setupPulse(pulse);
      console.log(`  Created: ${r.created.join(", ") || "none"}`);
      console.log(`  Already present: ${r.existing.join(", ") || "none"}`);
      console.log(`  Aliases seeded: ${r.aliasesSeeded}`);
    } catch (e) {
      failed++;
      console.log(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(failed ? `\n${failed} key(s) failed. The app will skip keys it cannot use.` : "\nAll keys ready.");
}

main();
