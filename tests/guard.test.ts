import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluateGuard } from "../src/core/guard.js";
import { buildOtlpPayload } from "../src/core/otlp.js";

/** The span the plugin is about to relay — what the guard is asked about. */
const payload = () =>
  buildOtlpPayload({
    name: "opencode.tool.before",
    traceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    fields: { hook: "tool.execute.before", tool_name: "bash", session_id: "s", tool_use_id: "c", cwd: "/w", tool_input: { command: "ls" } },
    serviceVersion: "1.0.0",
  });

// Read straight from package.json so this stays correct across `npm run bump`.
const PKG_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version as string;

afterEach(() => vi.restoreAllMocks());

describe("evaluateGuard", () => {
  it("returns null with no endpoint (governance disabled)", async () => {
    expect(await evaluateGuard(payload(), undefined)).toBeNull();
  });

  it("returns null when disabled", async () => {
    expect(await evaluateGuard(payload(), "http://x", { disabled: true })).toBeNull();
  });

  it("passes through a DENY decision with reason/userMessage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ decision: "DENY", reason: "rule_x", userMessage: "⛔ blocked" }),
    }));
    const r = await evaluateGuard(payload(), "http://x");
    expect(r?.decision).toBe("DENY");
    expect(r?.userMessage).toBe("⛔ blocked");
  });

  it("sends the span it was given as the body, unwrapped", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ decision: "ALLOW", reason: null }) });
    vi.stubGlobal("fetch", fetchMock);
    const p = payload();
    await evaluateGuard(p, "http://x");
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(sent).toEqual(p);
    expect("input" in sent).toBe(false);
  });

  it("records a 410 from the manager as failOpenReason=refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 410, json: async () => ({ error: "legacy_guard_input" }) }));
    const r = await evaluateGuard(payload(), "http://x");
    expect(r?.decision).toBe("ALLOW");
    expect(r?.failOpenReason).toBe("refused");
  });

  it("fail-opens to ALLOW on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, json: async () => ({}) }));
    const r = await evaluateGuard(payload(), "http://x");
    expect(r?.decision).toBe("ALLOW");
    expect(r?.failOpenReason).toBe("error");
  });

  it("fail-opens to ALLOW on timeout", async () => {
    // core >=0.5.0 aborts the fetch via AbortController on timeout, so the
    // mock must reject on signal abort — a never-settling promise would hang.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const r = await evaluateGuard(payload(), "http://x", { timeoutMs: 10 });
    expect(r?.decision).toBe("ALLOW");
    expect(r?.failOpenReason).toBe("timeout");
  });

  it("sends the relay token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ decision: "ALLOW", reason: null }) });
    vi.stubGlobal("fetch", fetchMock);
    await evaluateGuard(payload(), "http://x", { token: "tok123" });
    expect(fetchMock.mock.calls[0][1].headers["x-pinta-relay-token"]).toBe("tok123");
  });

  it("self-identifies via the User-Agent header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ decision: "ALLOW", reason: null }) });
    vi.stubGlobal("fetch", fetchMock);
    await evaluateGuard(payload(), "http://x");
    expect(fetchMock.mock.calls[0][1].headers["user-agent"]).toBe(`pinta-opencode/${PKG_VERSION}`);
  });
});
