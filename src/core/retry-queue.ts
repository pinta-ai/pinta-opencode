import type { OtlpPayload } from "./otlp.js";

const MAX_ENTRIES = 1000;

/**
 * In-memory retry buffer. The plugin is a long-lived in-process module
 * (verified H-C1), so failed OTLP payloads are buffered in memory and flushed
 * on the next event. Oldest entries are dropped past the cap. (Disk persistence
 * across instance restarts is an optional future enhancement — SPEC §6.)
 */
export class RetryQueue {
  private entries: OtlpPayload[] = [];

  enqueue(payload: OtlpPayload): void {
    this.entries.push(payload);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
  }

  /** Remove and return all buffered payloads. */
  drain(): OtlpPayload[] {
    const out = this.entries;
    this.entries = [];
    return out;
  }

  get size(): number {
    return this.entries.length;
  }
}
