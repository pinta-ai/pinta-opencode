import { MAX_POST_BYTES, MemoryRetryQueue, type OtlpPayload } from "@pinta-ai/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Transport } from "../src/core/transport.js";
import { buildOtlpPayload } from "../src/core/otlp.js";
import { PintaOpencode } from "../src/plugin.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function payload() {
  return buildOtlpPayload({
    name: "opencode.tool.after", traceId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    fields: { hook: "tool.execute.after", tool_response: "original" }, serviceVersion: "1.18.31",
  });
}

describe("deadline-safe memory retention", () => {
  it("starts the queued denial before awaiting the idle-event collector acknowledgement", async () => {
    vi.stubEnv("OPENCODE_CONFIG_DIR", `${process.cwd()}/.output-test-no-config`);
    vi.stubEnv("PINTA_OPENCODE_GUARD_DISABLED", "0");
    const collected: OtlpPayload[] = [];
    let acknowledge!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      if (url === "http://guard") return new Response(JSON.stringify({ decision: "DENY", reason: "fixture" }));
      collected.push(JSON.parse(String(options.body)) as OtlpPayload);
      if (collected.length === 1) return new Promise<Response>(resolve => { acknowledge = resolve; });
      return new Response("{}");
    }));
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    await expect(hooks["tool.execute.after"]({ tool: "read", sessionID: "s", callID: "c" }, { output: "original" }))
      .rejects.toThrow("Pinta withheld this tool output");
    expect(collected).toHaveLength(0);
    const idle = hooks.event({ event: { type: "session.idle", properties: { sessionID: "s" } } });
    await vi.waitFor(() => expect(collected).toHaveLength(1));
    expect(collected[0].resourceSpans[0].scopeSpans[0].spans[0].name).toBe("opencode.tool.after");
    acknowledge(new Response("{}"));
    await idle;
    expect(collected[1].resourceSpans[0].scopeSpans[0].spans[0].name).toBe("opencode.event.session.idle");
  });

  it.each(["before", "after"] as const)("%s denial never starts collector IO; idle drains original masked evidence", async phase => {
    vi.stubEnv("OPENCODE_CONFIG_DIR", `${process.cwd()}/.output-test-no-config`);
    vi.stubEnv("PINTA_OPENCODE_GUARD_DISABLED", "0");
    const collected: OtlpPayload[] = [];
    let judged: OtlpPayload | undefined;
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as OtlpPayload;
      if (url === "http://guard") {
        judged = body;
        return new Response(JSON.stringify({ decision: "DENY", reason: "fixture-policy", durationMs: 1 }));
      }
      collected.push(body);
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    const hooks = await PintaOpencode({}, { guard: "http://guard", endpoint: "http://collector" });
    const input = { tool: "bash", sessionID: "s", callID: "c" };
    const text = "mysql -pfixturepw";
    const invocation = phase === "before"
      ? hooks["tool.execute.before"](input, { args: { command: text } })
      : hooks["tool.execute.after"](input, { output: text, metadata: { exit: 0 } });
    await expect(invocation).rejects.toThrow(phase === "before" ? "fixture-policy" : "Pinta withheld this tool output");
    expect(collected).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const judgedSpan = judged!.resourceSpans[0].scopeSpans[0].spans[0];
    expect(JSON.stringify(judged)).not.toContain("fixturepw");
    expect(JSON.stringify(judged)).toContain("[REDACTED:cli_password_short]");
    await hooks.event({ event: { type: "session.idle", properties: { sessionID: "s" } } });
    const stored = collected.flatMap(p => p.resourceSpans.flatMap(r => r.scopeSpans.flatMap(s => s.spans)))
      .find(s => s.spanId === judgedSpan.spanId)!;
    expect(stored.traceId).toBe(judgedSpan.traceId);
    expect(stored.attributes).toEqual(expect.arrayContaining(judgedSpan.attributes));
    expect(JSON.stringify(stored)).not.toContain("fixturepw");
  });

  it.each([MAX_POST_BYTES, MAX_POST_BYTES + 1])("enforces the exact UTF-8 POST budget at %s bytes", async bytes => {
    const queued = vi.spyOn(MemoryRetryQueue.prototype, "enqueue");
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const warning = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const p = payload();
    const value = { stringValue: "" };
    p.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({ key: "fixture", value });
    const fillBytes = bytes - Buffer.byteLength(JSON.stringify(p), "utf8");
    value.stringValue = "\u00e9".repeat(Math.floor(fillBytes / 2)) + "x".repeat(fillBytes % 2);
    expect(Buffer.byteLength(JSON.stringify(p), "utf8")).toBe(bytes);
    const transport = new Transport({ endpoint: "http://collector", headers: {} });
    transport.defer(p);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queued).toHaveBeenCalledTimes(bytes <= MAX_POST_BYTES ? 1 : 0);
    expect(warning).toHaveBeenCalledTimes(bytes > MAX_POST_BYTES ? 1 : 0);
    await transport.flush();
    expect(fetchMock).toHaveBeenCalledTimes(bytes <= MAX_POST_BYTES ? 1 : 0);
  });

  it("does not retain telemetry in a guard-only configuration", async () => {
    const queued = vi.spyOn(MemoryRetryQueue.prototype, "enqueue");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const transport = new Transport({ headers: {} });
    transport.defer(payload());
    await transport.flush();
    expect(queued).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
