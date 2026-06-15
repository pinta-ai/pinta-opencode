import { describe, it, expect, vi, afterEach } from "vitest";
import { PintaOpencode } from "../src/plugin.js";

afterEach(() => vi.restoreAllMocks());

function okFetch(json: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => json, text: async () => "" });
}

describe("plugin", () => {
  it("DENY from guard throws (blocks the tool) with the reason", async () => {
    vi.stubGlobal("fetch", okFetch({ decision: "DENY", reason: "rule_x", userMessage: "⛔ Blocked by Pinta AI — rule_x" }));
    const hooks = await PintaOpencode({}, { guard: "http://guard" });
    await expect(
      hooks["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "rm -rf /" } }),
    ).rejects.toThrow("⛔ Blocked by Pinta AI — rule_x");
  });

  it("ALLOW from guard does not throw", async () => {
    vi.stubGlobal("fetch", okFetch({ decision: "ALLOW", reason: null }));
    const hooks = await PintaOpencode({}, { guard: "http://guard" });
    await expect(
      hooks["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "echo hi" } }),
    ).resolves.toBeUndefined();
  });

  it("guard infra error is fail-open (no throw) — telemetry without endpoint is a no-op", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const hooks = await PintaOpencode({}, { guard: "http://guard" });
    await expect(
      hooks["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: "c" }, { args: {} }),
    ).resolves.toBeUndefined();
  });

  it("no guard endpoint → before hook never throws", async () => {
    const hooks = await PintaOpencode({}, {});
    await expect(
      hooks["tool.execute.before"]({ tool: "read", sessionID: "s", callID: "c" }, { args: { path: "/x" } }),
    ).resolves.toBeUndefined();
  });

  it("lifecycle/after hooks never throw without an endpoint", async () => {
    const hooks = await PintaOpencode({}, {});
    await expect(hooks["chat.message"]({ sessionID: "s" })).resolves.toBeUndefined();
    await expect(hooks.event({ event: { type: "session.idle", properties: { sessionID: "s" } } })).resolves.toBeUndefined();
    await expect(
      hooks["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: "c" }, { title: "t", output: "o", metadata: { exit: 0 } }),
    ).resolves.toBeUndefined();
  });
});
