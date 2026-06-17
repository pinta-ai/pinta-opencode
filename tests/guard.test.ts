import { describe, it, expect, vi, afterEach } from "vitest";
import { evaluateGuard } from "../src/core/guard.js";

afterEach(() => vi.restoreAllMocks());

describe("evaluateGuard", () => {
  it("returns null with no endpoint (governance disabled)", async () => {
    expect(await evaluateGuard({ spanId: "s" }, undefined)).toBeNull();
  });

  it("returns null when disabled", async () => {
    expect(await evaluateGuard({ spanId: "s" }, "http://x", { disabled: true })).toBeNull();
  });

  it("passes through a DENY decision with reason/userMessage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ decision: "DENY", reason: "rule_x", userMessage: "⛔ blocked" }),
    }));
    const r = await evaluateGuard({ spanId: "s", toolName: "bash" }, "http://x");
    expect(r?.decision).toBe("DENY");
    expect(r?.userMessage).toBe("⛔ blocked");
  });

  it("fail-opens to ALLOW on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, json: async () => ({}) }));
    const r = await evaluateGuard({ spanId: "s" }, "http://x");
    expect(r?.decision).toBe("ALLOW");
    expect(r?.failOpenReason).toBe("error");
  });

  it("fail-opens to ALLOW on timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    const r = await evaluateGuard({ spanId: "s" }, "http://x", { timeoutMs: 10 });
    expect(r?.decision).toBe("ALLOW");
    expect(r?.failOpenReason).toBe("timeout");
  });

  it("sends the relay token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ decision: "ALLOW", reason: null }) });
    vi.stubGlobal("fetch", fetchMock);
    await evaluateGuard({ spanId: "s" }, "http://x", { token: "tok123" });
    expect(fetchMock.mock.calls[0][1].headers["x-pinta-relay-token"]).toBe("tok123");
  });

  it("self-identifies via the User-Agent header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ decision: "ALLOW", reason: null }) });
    vi.stubGlobal("fetch", fetchMock);
    await evaluateGuard({ spanId: "s" }, "http://x");
    expect(fetchMock.mock.calls[0][1].headers["user-agent"]).toBe("pinta-opencode/0.3.0");
  });
});
