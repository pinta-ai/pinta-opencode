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

/**
 * What the guard is told about the invocation.
 *
 * `method` names the opencode hook, and it is deliberately not a Claude Code
 * hook name: the manager only trusts a tool name when it can see a CC hook
 * behind it, so naming the real event stops an opencode tool called `read`
 * from being taken for Claude Code's and having its arguments read as content
 * rather than as a command (PTA-207).
 *
 * `cwd` is this process's directory — for an in-process plugin, opencode's
 * own, the directory its relative tool paths resolve against. Without it
 * `rm -rf passwd` reads as routine work no matter where it erases from
 * (PTA-176).
 */
describe("plugin — what the guard is told about the invocation", () => {
  it("puts the event and the working directory on the wire", async () => {
    const fetchMock = okFetch({ decision: "ALLOW", reason: null });
    vi.stubGlobal("fetch", fetchMock);
    const hooks = await PintaOpencode({}, { guard: "http://guard" });
    await hooks["tool.execute.before"](
      { tool: "bash", sessionID: "s", callID: "c" },
      { args: { command: "rm -rf passwd" } },
    );
    const guardCall = fetchMock.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes("guard"),
    );
    const sent = JSON.parse(String((guardCall?.[1] as { body?: string })?.body));
    expect(sent.input).toMatchObject({
      method: "tool.execute.before",
      cwd: process.cwd(),
    });
  });
});
