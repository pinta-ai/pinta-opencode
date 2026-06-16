import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PintaOpencode } from "../src/plugin.js";

// A real local collector + guard. Spans POSTed to /v1/traces are captured;
// /guard returns DENY when the tool input contains "DENYME", else ALLOW.
let server: http.Server;
let base: string;
const spans: any[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url?.includes("/v1/traces")) {
        spans.push(JSON.parse(body || "{}"));
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      } else if (req.url?.includes("/guard")) {
        const deny = body.includes("DENYME");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(
          deny
            ? { decision: "DENY", reason: "rule_x", userMessage: "⛔ Blocked by Pinta AI — rule_x" }
            : { decision: "ALLOW", reason: null },
        ));
      } else {
        res.writeHead(200);
        res.end("ok");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => (spans.length = 0));

function hooks(opts: Record<string, unknown> = {}) {
  return PintaOpencode({}, { endpoint: `${base}/v1/traces`, guard: `${base}/guard`, ...opts });
}

describe("integration (real collector + guard)", () => {
  it("ALLOW: tool runs, before+after spans reach the collector", async () => {
    const h = await hooks();
    await h["chat.message"]({ sessionID: "ses_1" });
    await h["tool.execute.before"]({ tool: "bash", sessionID: "ses_1", callID: "c1" }, { args: { command: "echo hi" } });
    await h["tool.execute.after"]({ tool: "bash", sessionID: "ses_1", callID: "c1" }, { title: "t", output: "hi", metadata: { exit: 0 } });
    // give async sends a tick
    await new Promise((r) => setTimeout(r, 30));
    const kinds = spans.flatMap((p) => p.resourceSpans[0].scopeSpans[0].spans[0].attributes)
      .filter((a: any) => a.key === "opencode.kind").map((a: any) => a.value.stringValue);
    expect(kinds).toContain("tool.before");
    expect(kinds).toContain("tool.after");
  });

  it("DENY: before hook throws the reason and blocks the tool", async () => {
    const h = await hooks();
    await expect(
      h["tool.execute.before"]({ tool: "bash", sessionID: "ses_2", callID: "c2" }, { args: { command: "DENYME now" } }),
    ).rejects.toThrow("⛔ Blocked by Pinta AI — rule_x");
  });

  it("fail-open: guard server unreachable → before hook does not throw", async () => {
    const h = await PintaOpencode({}, { guard: "http://127.0.0.1:1/guard", guardTimeoutMs: 30 });
    await expect(
      h["tool.execute.before"]({ tool: "bash", sessionID: "ses_3", callID: "c3" }, { args: { command: "DENYME" } }),
    ).resolves.toBeUndefined();
  });

  it("lifecycle span reaches the collector and session.idle flushes", async () => {
    const h = await hooks();
    await h.event({ event: { type: "session.idle", properties: { sessionID: "ses_4" } } });
    await new Promise((r) => setTimeout(r, 30));
    const types = spans.flatMap((p) => p.resourceSpans[0].scopeSpans[0].spans[0].attributes)
      .filter((a: any) => a.key === "opencode.event_type").map((a: any) => a.value.stringValue);
    expect(types).toContain("session.idle");
  });
});
