import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveConfig } from "../src/config.js";

const SAVE = { ...process.env };
beforeEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in SAVE)) delete process.env[k];
  // clear keys we touch
  for (const k of [
    "PINTA_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_HEADERS", "PINTA_GUARD_ENDPOINT", "PINTA_RELAY_TOKEN",
    "PINTA_GUARD_TIMEOUT_MS", "PINTA_GUARD_DISABLED",
  ]) delete process.env[k];
});
afterEach(() => Object.assign(process.env, SAVE));

describe("resolveConfig", () => {
  it("options win over env", () => {
    process.env.PINTA_GUARD_ENDPOINT = "http://env-guard";
    const c = resolveConfig({ endpoint: "http://opt/v1/traces", guard: "http://opt-guard", token: "t" });
    expect(c.endpoint).toBe("http://opt/v1/traces");
    expect(c.guardEndpoint).toBe("http://opt-guard");
    expect(c.headers["x-pinta-relay-token"]).toBe("t");
  });

  it("falls back to OTEL base endpoint with /v1/traces appended", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318/";
    expect(resolveConfig().endpoint).toBe("http://collector:4318/v1/traces");
  });

  it("parses header string and reads guard disabled flag", () => {
    process.env.PINTA_GUARD_DISABLED = "1";
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
