import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OtlpPayload } from "@pinta-ai/core";
import * as guardClient from "../src/core/guard.js";
import { Transport } from "../src/core/transport.js";
import { PintaOpencode } from "../src/plugin.js";
import type { ToolAfterOutput } from "../src/telemetry.js";

const safeMessage = "Pinta withheld this tool output because it violated an active policy.";
const input = { tool: "audit_read", sessionID: "session-a", callID: "call-a", args: { path: "README.md" } };
const outputs: [string, ToolAfterOutput][] = [
  ["builtin success", { title: "Read", output: "original result", metadata: { exit: 0, truncated: false } }],
  ["builtin semantic failure", { title: "Shell", output: "original error", metadata: { exit: 1 } }],
  ["MCP success", { content: [{ type: "text", text: "original result" }], isError: false }],
  ["MCP semantic failure", { content: [{ type: "text", text: "original error" }], isError: true }],
  ["MCP structured content", { content: [], structuredContent: { detail: "original structured result" } }],
  ["MCP resource content", { content: [{ type: "resource", resource: { uri: "audit://readme", text: "original resource" } }] }],
];

function attrs(payload: OtlpPayload) {
  return Object.fromEntries(payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.map(({ key, value }) =>
    [key, Object.values(value)[0]]));
}

function reply(decision: string) {
  return new Response(JSON.stringify({
    decision, reason: "untrusted guard reason", userMessage: "untrusted guard message", durationMs: 2,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubEnv("OPENCODE_CONFIG_DIR", `${process.cwd()}/.output-test-no-config`);
  vi.stubEnv("PINTA_OPENCODE_GUARD_DISABLED", "0");
  vi.spyOn(Transport.prototype, "send").mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("native after-result guard", () => {
  it.each(outputs)("withholds %s without rewriting original execution evidence", async (_name, output) => {
    const original = structuredClone(output);
    const fetchMock = vi.fn(async () => reply("DENY"));
    vi.stubGlobal("fetch", fetchMock);
    const evaluate = vi.spyOn(guardClient, "evaluateGuard");
    const defer = vi.spyOn(Transport.prototype, "defer");
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    await expect(hooks["tool.execute.after"](input, output)).rejects.toThrow(safeMessage);
    expect(output).toEqual(original);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(Transport.prototype.send).not.toHaveBeenCalled();
    expect(defer).toHaveBeenCalledOnce();
    const payload = defer.mock.calls[0][0];
    expect(evaluate.mock.calls[0][0]).toBe(payload);
    const fields = attrs(payload);
    expect(fields).toMatchObject({
      "opencode.hook": "tool.execute.after", "opencode.tool_use_id": input.callID,
      "opencode.tool_input": JSON.stringify(input.args),
      "pinta.guard.target": "tool_output", "pinta.guard.decision": "deny",
      "pinta.guard.matched_rule": "untrusted guard reason",
      "pinta.guard.duration_ms": 2,
    });
    if (output.content !== undefined) {
      expect(JSON.parse(String(fields["opencode.tool_response"]))).toEqual(output);
    } else {
      expect(fields["opencode.tool_response"]).toBe(output.output);
      expect(fields["opencode.exit"]).toBe(output.metadata?.exit);
    }
    expect(fields["opencode.error"]).toBeUndefined();
  });

  it.each(["ALLOW", "REVIEW"])("preserves %s output and attaches the target only after evaluation", async decision => {
    let judged: OtlpPayload | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      judged = JSON.parse(String(options.body)) as OtlpPayload;
      return reply(decision);
    }));
    const evaluate = vi.spyOn(guardClient, "evaluateGuard");
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    const output = { output: "untouched" };
    await hooks["tool.execute.after"](input, output);
    expect(output.output).toBe("untouched");
    const sent = vi.mocked(Transport.prototype.send).mock.calls[0][0];
    expect(evaluate.mock.calls[0][0]).toBe(sent);
    expect(attrs(judged!)["pinta.guard.target"]).toBeUndefined();
    expect(attrs(judged!)["pinta.guard.decision"]).toBeUndefined();
    expect(attrs(sent)).toMatchObject({
      "pinta.guard.target": "tool_output", "pinta.guard.decision": decision.toLowerCase(),
    });
    expect(sent.resourceSpans[0].scopeSpans[0].spans[0].spanId)
      .toBe(judged!.resourceSpans[0].scopeSpans[0].spans[0].spanId);
  });

  it.each(["unconfigured", "disabled"])("keeps %s guarding inactive without inventing a target", async mode => {
    vi.stubEnv("PINTA_OPENCODE_GUARD", "");
    if (mode === "disabled") vi.stubEnv("PINTA_OPENCODE_GUARD_DISABLED", "1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hooks = await PintaOpencode({}, {
      ...(mode === "disabled" ? { guard: "http://guard" } : {}), endpoint: "http://collector",
    });
    await hooks["tool.execute.after"](input, { output: "untouched" });
    expect(fetchMock).not.toHaveBeenCalled();
    const fields = attrs(vi.mocked(Transport.prototype.send).mock.calls[0][0]);
    expect(fields["pinta.guard.target"]).toBeUndefined();
    expect(fields["pinta.guard.decision"]).toBeUndefined();
  });

  it.each(["connection", "http", "refused", "timeout"])("fails open explicitly on %s", async failure => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
      if (failure === "connection") throw new Error("unavailable");
      if (failure !== "timeout") return new Response("", { status: failure === "refused" ? 410 : 503 });
      return new Promise<Response>((_resolve, reject) => options.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError"))));
    }));
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector", guardTimeoutMs: 10 });
    const output = { output: "untouched" };
    await hooks["tool.execute.after"](input, output);
    expect(output.output).toBe("untouched");
    expect(attrs(vi.mocked(Transport.prototype.send).mock.calls[0][0])).toMatchObject({
      "pinta.guard.target": "tool_output", "pinta.guard.decision": "allow",
      "pinta.guard.fail_open_reason": failure === "timeout" || failure === "refused" ? failure : "error",
    });
  });

  it("preserves a decided denial if retention fails, without collector fallback", async () => {
    const fetchMock = vi.fn(async () => reply("DENY"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Transport.prototype, "defer").mockImplementation(() => { throw new Error("buffer unavailable"); });
    const warning = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    await expect(hooks["tool.execute.after"](input, { output: "original" })).rejects.toThrow(safeMessage);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("buffer unavailable"));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(Transport.prototype.send).not.toHaveBeenCalled();
  });
});
