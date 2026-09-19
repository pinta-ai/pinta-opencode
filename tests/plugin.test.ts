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
 * The guard is asked about the span the plugin is about to relay.
 *
 * It used to get a hand-picked summary of the invocation: `method` naming the
 * opencode hook, deliberately not a Claude Code hook name, so the manager would
 * not take a tool called `read` for Claude Code's and read its arguments as
 * content (PTA-207); `cwd`, this process's directory, so a relative target
 * could be located (PTA-176). Both are on the span as `opencode.hook` and
 * `opencode.cwd`, and since core 0.8.0 the span itself is what the manager
 * reads — projected through the same AgentEvent assembly the backend stores
 * it with. One reading, judged and stored alike.
 */
describe("plugin — the guard is asked about the span that is then sent", () => {
  it("puts the span — event and working directory included — on the wire, unwrapped", async () => {
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
    expect("input" in sent).toBe(false);
    const attrs = Object.fromEntries(
      sent.resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a: { key: string; value: { stringValue?: string } }) => [a.key, a.value.stringValue]),
    );
    expect(attrs).toMatchObject({
      "ingest.type": "opencode",
      "opencode.hook": "tool.execute.before",
      "opencode.cwd": process.cwd(),
      "opencode.tool_name": "bash",
    });
    expect(attrs["opencode.tool_input"]).toContain("rm -rf passwd");
  });
});
