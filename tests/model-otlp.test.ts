import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { OtlpPayload } from "@pinta-ai/core";
import type { PintaOpencode } from "../src/plugin.js";
import type { OpencodeEvent } from "../src/telemetry.js";
import { record } from "../src/model.js";

const scratch = `.model-wire-${randomUUID()}`;
const root = path.resolve(scratch);
const received: OtlpPayload[] = [];
const guarded: OtlpPayload[] = [];
let createPlugin: typeof PintaOpencode;
let server: Server;
let endpoint: string;

function span(payload: OtlpPayload) {
  return payload.resourceSpans[0].scopeSpans[0].spans[0];
}
function attrs(payload: OtlpPayload): Record<string, unknown> {
  return Object.fromEntries(span(payload).attributes.map(({ key, value }) => [key, Object.values(value)[0]]));
}

beforeAll(async () => {
  mkdirSync(scratch);
  await build({
    entryPoints: ["src/plugin.ts"], outfile: `${scratch}/plugin.mjs`, bundle: true,
    platform: "node", format: "esm", target: "node18", minify: true,
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
  vi.stubEnv("OPENCODE_CONFIG_DIR", `${root}/config`);
  vi.stubEnv("OPENCODE_VERSION", "1.15.3");
  vi.stubEnv("PINTA_OPENCODE_GUARD_DISABLED", "0");
  createPlugin = (await import(pathToFileURL(`${root}/plugin.mjs`).href)).PintaOpencode;
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const payload = JSON.parse(raw) as OtlpPayload;
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    if (req.url === "/guard") {
      guarded.push(payload);
      res.end(JSON.stringify({ decision: raw.includes("DENYME") ? "DENY" : "ALLOW", reason: "test-deny" }));
    } else {
      received.push(payload);
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});
beforeEach(() => { received.length = 0; guarded.length = 0; });

function hooks() {
  return createPlugin({}, {
    endpoint: `${endpoint}/v1/traces`, guard: `${endpoint}/guard`,
    headers: {}, token: "loopback-test-token", guardTimeoutMs: 1000,
  });
}

describe("built OpenCode plugin → loopback OTLP", () => {
  it("replays the checked-in host model shapes without rewriting their raw info/model", async () => {
    const h = await hooks();
    const fixtures = readFileSync(new URL("../phase1-e2e-events.jsonl", import.meta.url), "utf8")
      .trim().split("\n").map((line) => JSON.parse(line) as OpencodeEvent);
    const selected = [
      fixtures.find((event) => event.type === "session.next.model.switched")!,
      fixtures.find((event) => event.type === "session.updated")!,
      fixtures.find((event) => event.type === "message.updated" && record(event.properties?.info)?.role === "user")!,
      fixtures.find((event) => event.type === "message.updated" && record(event.properties?.info)?.role === "assistant")!,
    ];
    for (const event of selected) await h.event({ event });
    expect(received).toHaveLength(4);
    for (let i = 0; i < selected.length; i++) {
      const fields = attrs(received[i]);
      const props = selected[i].properties!;
      const info = record(props.info);
      const model = record(info?.model ?? props.model);
      const expected = info?.modelID ?? model?.modelID ?? model?.id;
      expect(typeof expected).toBe("string");
      expect(fields["opencode.model"]).toBe(expected);
      expect(fields["opencode.provider"]).toBe(info?.providerID ?? model?.providerID);
      if (info) expect(fields["opencode.info"]).toBe(JSON.stringify(info));
      if (props.model) expect(fields["opencode.model_raw"]).toBe(JSON.stringify(props.model));
    }
  });

  it("emits exact-message models across agents, sessions and switches with unchanged span counts", async () => {
    const h = await hooks();
    let expected = 0;
    const event = async (ev: OpencodeEvent) => { expected++; await h.event({ event: ev }); };
    const model = async (sessionID: string, id: string, selected: string, agent = "build") => event({
      type: "message.updated",
      properties: { info: { sessionID, id, role: "assistant", modelID: selected, providerID: "router", agent } },
    });
    const part = async (sessionID: string, messageID: string, callID: string) => event({
      type: "message.part.updated",
      properties: { part: { sessionID, messageID, callID, id: `part-${callID}`, type: "tool", tool: "read" } },
    });
    const before = async (sessionID: string, callID: string) => {
      expected++;
      await h["tool.execute.before"]({ sessionID, callID, tool: "read" }, { args: { model: "tool-argument-not-evidence" } });
    };
    await h["chat.message"]({ sessionID: "a", messageID: "user", agent: "build", model: { modelID: "main-v1" } });
    await h["chat.params"]({
      sessionID: "a", agent: "build", message: { id: "user", sessionID: "a" },
      model: { id: "main-v1", providerID: "router" },
    });
    expect(received).toHaveLength(0);
    await model("a", "main", "main-v1");
    await part("a", "main", "same-call");
    await model("a", "child", "child-v1", "explore");
    await part("a", "child", "child-call");
    await event({
      type: "message.part.delta",
      properties: { sessionID: "a", messageID: "main", partID: "text", field: "text", delta: "main chunk" },
    });
    await model("b", "main", "other-v1");
    await part("b", "main", "same-call");
    await Promise.all([before("a", "same-call"), before("a", "child-call"), before("b", "same-call"), before("a", "unrelated")]);
    await event({ type: "session.next.model.switched", properties: { sessionID: "a", model: { id: "main-v2", providerID: "router" } } });
    await model("a", "next", "main-v2");
    await part("a", "next", "next-call");
    await before("a", "next-call");
    expected++;
    await h["tool.execute.after"]({ sessionID: "a", callID: "same-call", tool: "read" }, { output: "done" });
    await event({ type: "session.status", properties: { sessionID: "a", status: { type: "idle" } } });
    await model("a", "main", "stale");
    await part("a", "main", "stale-call");
    await before("a", "stale-call");
    await vi.waitFor(() => expect(received).toHaveLength(expected));
    const find = (sessionID: string, callID: string, hook = "tool.execute.before") => attrs(received.find((p) => {
      const a = attrs(p);
      return a["opencode.session_id"] === sessionID && a["opencode.tool_use_id"] === callID && a["opencode.hook"] === hook;
    })!);
    expect(find("a", "same-call")).toMatchObject({
      "opencode.model": "main-v1", "opencode.provider": "router", "opencode.agent": "build",
      "opencode.message_id": "main", "opencode.model_source": "reported:message.updated.info.modelID",
    });
    expect(find("a", "child-call")["opencode.model"]).toBe("child-v1");
    expect(find("a", "child-call")["opencode.agent"]).toBe("explore");
    expect(find("b", "same-call")["opencode.model"]).toBe("other-v1");
    expect(find("a", "next-call")["opencode.model"]).toBe("main-v2");
    expect(find("a", "same-call", "tool.execute.after")["opencode.model"]).toBe("main-v1");
    const delta = received.find((p) => attrs(p)["opencode.event_type"] === "message.part.delta")!;
    expect(attrs(delta)["opencode.model"]).toBe("main-v1");
    for (const call of ["unrelated", "stale-call"]) expect(find("a", call)["opencode.model"]).toBeUndefined();
    const switched = attrs(received.find((p) => attrs(p)["opencode.event_type"] === "session.next.model.switched")!);
    expect(switched["opencode.model"]).toBe("main-v2");
    expect(switched["opencode.model_raw"]).toBe('{"id":"main-v2","providerID":"router"}');
  });

  it("preserves scalar typing, missing/malformed payloads, redaction and guard denial", async () => {
    const h = await hooks();
    await h["chat.message"]({ sessionID: "s", messageID: "user", agent: "build" });
    await h["chat.params"]({
      sessionID: "s", agent: "build", message: { sessionID: "s", id: "user" },
      model: { id: "selected-v1", providerID: "provider" },
    });
    await h.event({ event: { type: "message.updated", properties: {
      info: { sessionID: "s", id: "user", role: "user", agent: "build" },
    } } });
    expect(attrs(received[0])).toMatchObject({
      "opencode.model": "selected-v1", "opencode.model_source": "requested:chat.params.model.id",
    });
    for (const model of [undefined, "unknown", " ", { id: "unknown" }, "{}", "[]", " \t{truncated", "\n [truncated"]) {
      await h.event({ event: { type: "test", properties: { sessionID: "s", model } } });
    }
    for (const payload of received.slice(1)) expect(attrs(payload)["opencode.model"]).toBeUndefined();
    await h.event({ event: { type: "message.updated", properties: { sessionID: "s", info: ["malformed"] } } });
    await expect(h["tool.execute.before"]({
      sessionID: "s", callID: "denied", tool: "bash",
      model: { modelID: "explicit-model", providerID: "provider" },
    }, { args: { command: "DENYME mysql -psecretpw" } })).rejects.toThrow("test-deny");
    const denied = received.at(-1)!;
    expect(attrs(denied)).toMatchObject({
      "opencode.model": "explicit-model", "opencode.provider": "provider",
      "opencode.model_source": "reported:tool.model.modelID", "pinta.guard.decision": "deny",
    });
    expect(attrs(denied)["opencode.tool_input"]).not.toContain("secretpw");
    expect(attrs(denied)["opencode.tool_input"]).toContain("[REDACTED:cli_password_short]");
    expect(span(guarded[0]).spanId).toBe(span(denied).spanId);
    expect(attrs(guarded[0])["opencode.model"]).toBe("explicit-model");
    expect(received).toHaveLength(11);
  });
});
