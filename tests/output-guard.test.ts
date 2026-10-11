import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OtlpPayload } from "@pinta-ai/core";
import * as guardClient from "../src/core/guard.js";
import { Transport } from "../src/core/transport.js";
import { PintaOpencode } from "../src/plugin.js";
import type { ToolAfterOutput } from "../src/telemetry.js";

const safeMessage = "untrusted guard message";
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

/**
 * PTA-695: a tool-output DENY now carries the policy's own `userMessage`, the
 * manager's `evaluationId` and a fixed recovery hint to the model, and — when
 * the manager marked the DENY as maskable — can deliver the output with only
 * the detected values replaced.
 *
 * OpenCode has one verified replacement channel for a denied output: the
 * after-hook `throw` (HYPOTHESIS_VALIDATION H-A1 covers the before hook; the
 * after-hook throw surfaces the same way). Whether the host reads back a
 * mutated `output.output` from `tool.execute.after` is NOT verified, so the
 * masked delivery is opt-in behind `PINTA_OPENCODE_OUTPUT_MASK=1` and the
 * default for `mask` is the same throw as `withhold` — never with the masked
 * text inside the error, which is where the host would echo it.
 */
describe("output denial v2 (PTA-695)", () => {
  const SECRET = "ctx7sk-FAKE0000";
  const SENSITIVE = `token ${SECRET} end`;
  const USER_MESSAGE = "Credential detected by org policy";
  const EVALUATION_ID = "eval-7f3a";

  function denyReply(extra: Record<string, unknown>) {
    return new Response(JSON.stringify({
      decision: "DENY", reason: "credential_rule", userMessage: USER_MESSAGE, durationMs: 2, ...extra,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const maskReply = () => denyReply({
    evaluationId: EVALUATION_ID, outputAction: "mask",
    redactions: [{ category: "CREDENTIAL", match: SECRET }],
  });

  function spanText(payload: OtlpPayload): string {
    return JSON.stringify(payload);
  }

  it("mask + flag off: throws notice + mask guidance without the output or the masked text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => maskReply()));
    const defer = vi.spyOn(Transport.prototype, "defer");
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    const output = { title: "Read", output: SENSITIVE, metadata: { exit: 0 } };
    let caught: Error | undefined;
    await hooks["tool.execute.after"](input, output).catch((e: Error) => { caught = e; });
    expect(caught).toBeInstanceOf(Error);
    const message = caught!.message;
    expect(message).toContain(USER_MESSAGE);
    expect(message).toContain(`evaluation ${EVALUATION_ID}`);
    expect(message).toContain("Pinta masked 1 detected value(s)");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("[REDACTED:CREDENTIAL]"); // the guidance copy names the marker shape only
    // the output object is left as the host produced it
    expect(output.output).toBe(SENSITIVE);
    // decided DENY still defers instead of awaiting collector IO, and the
    // deferred span carries the verdict + target but never the matched value
    expect(Transport.prototype.send).not.toHaveBeenCalled();
    expect(defer).toHaveBeenCalledOnce();
    const payload = defer.mock.calls[0][0];
    expect(attrs(payload)).toMatchObject({ "pinta.guard.target": "tool_output", "pinta.guard.decision": "deny" });
    // the original output is audit evidence on the span (redaction-aware),
    // but the manager's `redactions` list must not be copied onto it
    expect(spanText(payload)).not.toContain("redactions");
    expect(spanText(payload)).not.toContain("CREDENTIAL");
  });

  it("mask + flag on: delivers masked output with notice and guidance, no throw", async () => {
    vi.stubEnv("PINTA_OPENCODE_OUTPUT_MASK", "1");
    vi.stubGlobal("fetch", vi.fn(async () => maskReply()));
    const defer = vi.spyOn(Transport.prototype, "defer");
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    const output = { title: "Shell", output: SENSITIVE, metadata: { exit: 0, output: SENSITIVE } };
    await expect(hooks["tool.execute.after"](input, output)).resolves.toBeUndefined();
    expect(output.output).toContain("[REDACTED:CREDENTIAL]");
    expect(output.output).toContain(USER_MESSAGE);
    expect(output.output).toContain(`evaluation ${EVALUATION_ID}`);
    expect(output.output).toContain("Pinta masked 1 detected value(s)");
    expect(output.output).not.toContain(SECRET);
    // metadata.output mirrors the delivered text for builtin shell results
    expect(output.metadata.output).toBe(output.output);
    expect(output.metadata.exit).toBe(0);
    expect(defer).toHaveBeenCalledOnce();
    expect(Transport.prototype.send).not.toHaveBeenCalled();
  });

  it("mask + flag on via plugin option: same as the env flag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => maskReply()));
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector", outputMask: true });
    const output = { output: SENSITIVE };
    await expect(hooks["tool.execute.after"](input, output)).resolves.toBeUndefined();
    expect(output.output).toContain("[REDACTED:CREDENTIAL]");
    expect(output.output).not.toContain(SECRET);
  });

  it("mask + flag on, but the output is not a builtin string: still throws (no channel to mask)", async () => {
    vi.stubEnv("PINTA_OPENCODE_OUTPUT_MASK", "1");
    vi.stubGlobal("fetch", vi.fn(async () => maskReply()));
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    const output: ToolAfterOutput = { content: [{ type: "text", text: SENSITIVE }] };
    const original = structuredClone(output);
    let caught: Error | undefined;
    await hooks["tool.execute.after"](input, output).catch((e: Error) => { caught = e; });
    expect(caught!.message).toContain(USER_MESSAGE);
    expect(caught!.message).not.toContain(SECRET);
    expect(caught!.message).not.toContain("[REDACTED:CREDENTIAL]");
    expect(output).toEqual(original);
  });

  it("mask + flag on, but no redaction value occurs in the output: withholds", async () => {
    vi.stubEnv("PINTA_OPENCODE_OUTPUT_MASK", "1");
    vi.stubGlobal("fetch", vi.fn(async () => maskReply()));
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    const output = { output: "nothing sensitive here" };
    let caught: Error | undefined;
    await hooks["tool.execute.after"](input, output).catch((e: Error) => { caught = e; });
    expect(caught!.message).toContain(USER_MESSAGE);
    expect(caught!.message).toContain("Pinta withheld this tool output");
    expect(output.output).toBe("nothing sensitive here");
  });

  it("withhold from an old manager (no new fields): throws notice from userMessage + withhold guidance", async () => {
    vi.stubEnv("PINTA_OPENCODE_OUTPUT_MASK", "1");
    vi.stubGlobal("fetch", vi.fn(async () => denyReply({})));
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    const output = { output: SENSITIVE };
    let caught: Error | undefined;
    await hooks["tool.execute.after"](input, output).catch((e: Error) => { caught = e; });
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message.startsWith(USER_MESSAGE)).toBe(true);
    expect(caught!.message).not.toContain("(evaluation");
    expect(caught!.message).toContain("id unavailable");
    expect(caught!.message).toContain("do not retry it to bypass the block");
    expect(caught!.message).not.toContain(SECRET);
    expect(output.output).toBe(SENSITIVE);
  });

  it("withhold with a null userMessage: falls back to the default notice", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      decision: "DENY", reason: "r", userMessage: null, durationMs: 1, evaluationId: EVALUATION_ID, outputAction: "withhold",
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    let caught: Error | undefined;
    await hooks["tool.execute.after"](input, { output: SENSITIVE }).catch((e: Error) => { caught = e; });
    expect(caught!.message).toContain("Pinta blocked this tool output under your organization's security policy.");
    expect(caught!.message).toContain(`(evaluation ${EVALUATION_ID})`);
  });

  it("before-hook DENY is unchanged: throws userMessage ?? reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => maskReply()));
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    await expect(hooks["tool.execute.before"](input, { args: input.args })).rejects.toThrow(USER_MESSAGE);
    let caught: Error | undefined;
    await hooks["tool.execute.before"](input, { args: input.args }).catch((e: Error) => { caught = e; });
    expect(caught!.message).toBe(USER_MESSAGE);
  });
});
