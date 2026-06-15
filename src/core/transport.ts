import { RetryQueue } from "./retry-queue.js";
import { mergeBatch, type OtlpPayload } from "./otlp.js";

const TIMEOUT_MS = 5000;

export interface TransportConfig {
  /** Full OTLP/HTTP traces URL. Undefined → telemetry silently disabled. */
  endpoint?: string;
  headers: Record<string, string>;
}

/**
 * Best-effort OTLP/HTTP transport with an in-memory retry buffer. Never throws;
 * failures are buffered and re-sent (batched) on the next event. Silent-disable
 * when no endpoint is configured.
 */
export class Transport {
  private queue = new RetryQueue();

  constructor(private config: TransportConfig) {}

  async send(payload: OtlpPayload): Promise<void> {
    if (!this.config.endpoint) return;
    const ok = await this.post(payload);
    if (!ok) this.queue.enqueue(payload);
  }

  /** Drain the retry buffer as one batched POST; re-buffer on failure. */
  async flush(): Promise<void> {
    if (!this.config.endpoint) return;
    if (this.queue.size === 0) return;
    const entries = this.queue.drain();
    const ok = await this.post(mergeBatch(entries));
    if (!ok) for (const e of entries) this.queue.enqueue(e);
  }

  private async post(payload: OtlpPayload): Promise<boolean> {
    const endpoint = this.config.endpoint;
    if (!endpoint) return false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.config.headers },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const hint =
          res.status === 401 || res.status === 403
            ? " — check relay token"
            : res.status === 404
              ? " — check traces endpoint path"
              : res.status >= 500
                ? " — collector may be down"
                : "";
        process.stderr.write(`[pinta-opencode] OTLP POST ${res.status} ${endpoint}${hint}\n`);
        return false;
      }
      return true;
    } catch (err) {
      process.stderr.write(`[pinta-opencode] OTLP POST failed: ${(err as Error).message ?? String(err)}\n`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
