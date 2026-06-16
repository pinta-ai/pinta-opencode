import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "../src/config.js";

const SAVE = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in SAVE)) delete process.env[k];
  // clear keys we touch
  for (const k of [
    "PINTA_OPENCODE_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_ENDPOINT",
    "PINTA_OPENCODE_HEADERS", "OTEL_EXPORTER_OTLP_HEADERS", "PINTA_OPENCODE_GUARD", "PINTA_OPENCODE_TOKEN",
    "PINTA_OPENCODE_GUARD_TIMEOUT_MS", "PINTA_OPENCODE_GUARD_DISABLED",
  ]) delete process.env[k];
});
afterEach(() => Object.assign(process.env, SAVE));

describe("resolveConfig", () => {
  it("options win over env", () => {
    process.env.PINTA_OPENCODE_GUARD = "http://env-guard";
    const c = resolveConfig({ endpoint: "http://opt/v1/traces", guard: "http://opt-guard", token: "t" });
    expect(c.endpoint).toBe("http://opt/v1/traces");
    expect(c.guardEndpoint).toBe("http://opt-guard");
    expect(c.headers["x-pinta-relay-token"]).toBe("t");
  });

  it("reads PINTA_OPENCODE_* env names", () => {
    process.env.PINTA_OPENCODE_ENDPOINT = "http://env/v1/traces";
    process.env.PINTA_OPENCODE_GUARD = "http://env-guard";
    process.env.PINTA_OPENCODE_TOKEN = "tok";
    const c = resolveConfig();
    expect(c.endpoint).toBe("http://env/v1/traces");
    expect(c.guardEndpoint).toBe("http://env-guard");
    expect(c.relayToken).toBe("tok");
    expect(c.headers["x-pinta-relay-token"]).toBe("tok");
  });

  it("falls back to OTEL base endpoint with /v1/traces appended", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318/";
    expect(resolveConfig().endpoint).toBe("http://collector:4318/v1/traces");
  });

  it("parses header string and reads guard disabled flag", () => {
    process.env.PINTA_OPENCODE_GUARD_DISABLED = "1";
    const c = resolveConfig({ headers: "a=1,b=2" });
    expect(c.headers.a).toBe("1");
    expect(c.headers.b).toBe("2");
    expect(c.guardDisabled).toBe(true);
  });

  it("defaults guard timeout to 50ms, overridable", () => {
    expect(resolveConfig().guardTimeoutMs).toBe(50);
    expect(resolveConfig({ guardTimeoutMs: 300 }).guardTimeoutMs).toBe(300);
  });

  it("no endpoint configured → undefined (telemetry disabled)", () => {
    expect(resolveConfig().endpoint).toBeUndefined();
  });
});
