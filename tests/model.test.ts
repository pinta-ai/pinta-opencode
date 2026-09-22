import { describe, expect, it } from "vitest";
import {
  MODEL_CACHE_LIMITS, ModelTracker, eventSessionID, modelFields,
  type ToolModelInput,
} from "../src/model.js";

function message(
  models: ModelTracker, sessionID: string, id: string, model: unknown,
  agent = "build", extra: Record<string, unknown> = {},
) {
  return models.event("message.updated", {
    sessionID, info: { sessionID, id, role: "assistant", modelID: model, providerID: "provider", agent, ...extra },
  });
}

function part(models: ModelTracker, sessionID: string, messageID: string, callID: string, extra = {}) {
  return models.event("message.part.updated", {
    sessionID, part: { id: `part-${callID}`, sessionID, messageID, type: "tool", callID, tool: "read", ...extra },
  });
}

function tool(sessionID = "s", callID = "c"): ToolModelInput {
  return { sessionID, callID, tool: "read" };
}

describe("OpenCode model evidence", () => {
  it("extracts each verified host model shape with exact provider/source", () => {
    const models = new ModelTracker();
    expect(message(models, "s", "m", "vendor/model-v1")).toMatchObject({
      model: "vendor/model-v1", provider: "provider", source: "reported:message.updated.info.modelID",
    });
    expect(models.event("message.updated", {
      info: { sessionID: "s", id: "u", role: "user", model: { modelID: "selected", providerID: "router" } },
    })).toMatchObject({ model: "selected", provider: "router", source: "requested:message.updated.info.model.modelID" });
    expect(models.event("session.updated", {
      info: { id: "s", model: { id: "catalog-id", providerID: "router" } },
    })).toMatchObject({ model: "catalog-id", source: "selected:session.updated.info.model.id" });
    expect(models.event("session.next.model.switched", {
      sessionID: "s", model: { id: "next", providerID: "router" },
    })).toMatchObject({ model: "next", source: "selected:session.next.model.switched.model.id" });
    expect(models.beforeTool(tool())).toBeUndefined(); // no session default is borrowed
  });

  it("captures chat.message output and chat.params only for the exact user message AND agent", () => {
    const models = new ModelTracker();
    models.chatMessage({ sessionID: "s", model: { modelID: "input-default" } }, {
      message: { sessionID: "s", id: "u", agent: "build", model: { modelID: "output-selection" } },
    });
    const update = (id: string, agent = "build") => models.event("message.updated", {
      info: { sessionID: "s", id, role: "user", agent },
    });
    expect(update("u")).toMatchObject({
      model: "output-selection", source: "requested:chat.message.message.model.modelID",
    });
    models.chatParams({
      sessionID: "s", agent: "build", message: { id: "u", sessionID: "s" },
      model: { id: "effective-request", providerID: "provider" },
    });
    expect(update("u")).toMatchObject({ model: "effective-request", source: "requested:chat.params.model.id" });
    expect(update("u", "explore")).toBeUndefined();
    expect(update("different-message")).toBeUndefined();
    expect(models.beforeTool(tool())).toBeUndefined();
    expect(models.event("message.updated", {
      info: { sessionID: "s", id: "assistant", parentID: "u", role: "assistant", agent: "build" },
    })).toBeUndefined(); // a request on the parent is not the assistant's identity
  });

  it("prefers explicit message fields and invalidates an unusable selection", () => {
    const models = new ModelTracker();
    models.chatMessage({ sessionID: "s", messageID: "u", agent: "build", model: "cached" });
    const event = { sessionID: "s", id: "u", role: "user", agent: "build" };
    expect(models.event("message.updated", { info: { ...event, model: "explicit" } })?.model).toBe("explicit");
    expect(models.event("message.updated", { info: { ...event, model: "unknown" } })).toBeUndefined();
    expect(models.event("message.updated", { info: event })).toBeUndefined();
  });

  it.each([
    undefined, null, "", " \t", "UNKNOWN", "none", "n/a", "auto", "default", 42, {}, [], { id: "unknown" },
    "{}", "[]", '{"id":"model"}', '["model"]', "{", "[", "{truncated", "[truncated", " \t{broken", "\n [broken",
  ])(
    "omits unusable model %j from the canonical scalar", (model) => {
      const models = new ModelTracker();
      const fields = modelFields({ model }, models.event("test", { model }));
      expect(fields.model).toBeUndefined();
      expect(fields.model_source).toBeUndefined();
      expect(fields.model_raw).toEqual(model);
    },
  );

  it("preserves a raw model object and conflicting source/provider without mutation", () => {
    const models = new ModelTracker();
    const fields = { model: { id: "id", providerID: "router" }, provider: { raw: "value" }, model_source: "host-value" };
    const out = modelFields(fields, models.event("session.next.model.switched", fields));
    expect(out).toMatchObject({
      model: "id", provider: "router", model_raw: fields.model,
      provider_raw: fields.provider, model_source_raw: "host-value",
    });
    expect(fields.model).toEqual({ id: "id", providerID: "router" });
  });

  it("accepts model objects only at model, not at the scalar modelID field", () => {
    const models = new ModelTracker();
    expect(message(models, "s", "m", { id: "wrong-shape" })).toBeUndefined();
    expect(models.event("test", { modelID: { modelID: "wrong-shape" } })).toBeUndefined();
    expect(models.event("test", { model: "x".repeat(1025) })).toBeUndefined();
  });

  it("rejects JSON-prefixed IDs in supported model objects, messages and tool metadata", () => {
    const models = new ModelTracker();
    for (const model of ["{", "[", " \t{truncated", "\n [truncated"]) {
      expect(message(models, "s", "m", model)).toBeUndefined();
      expect(models.event("test", { modelID: model })).toBeUndefined();
      expect(models.event("test", { model: { id: model } })).toBeUndefined();
      expect(models.event("test", { model: { modelID: model } })).toBeUndefined();
      expect(models.beforeTool({ ...tool(), modelID: model })).toBeUndefined();
      expect(models.beforeTool({ ...tool(), model: { id: model } })).toBeUndefined();
      models.chatParams({ sessionID: "s", agent: "build", message: { id: "u" }, model: { id: model } });
      expect(models.event("message.updated", {
        info: { sessionID: "s", id: "u", role: "user", agent: "build" },
      })).toBeUndefined();
    }
    expect(models.event("test", { model: "  provider/model[variant]  " })?.model).toBe("provider/model[variant]");
  });
});

describe("bounded exact call/message correlation", () => {
  it("joins tools only through their message.part.updated callID", () => {
    const models = new ModelTracker();
    message(models, "s", "m", "model-a");
    expect(models.beforeTool(tool())).toBeUndefined();
    part(models, "s", "m", "c");
    expect(models.beforeTool(tool())).toMatchObject({ model: "model-a", agent: "build", messageID: "m" });
    expect(models.afterTool(tool())?.model).toBe("model-a");
    part(models, "s", "m", "c"); // delayed terminal update must not reopen a consumed call
    expect(models.beforeTool(tool())).toBeUndefined();
  });

  it("does not borrow a subagent model or a model from a concurrent session", () => {
    const models = new ModelTracker();
    message(models, "s", "main", "main-model");
    message(models, "s", "child", "child-model", "explore");
    message(models, "other", "main", "other-model");
    part(models, "s", "main", "same-call");
    part(models, "s", "child", "child-call");
    part(models, "other", "main", "same-call");
    expect(models.beforeTool(tool("s", "same-call"))?.model).toBe("main-model");
    expect(models.beforeTool(tool("s", "child-call"))?.model).toBe("child-model");
    expect(models.beforeTool(tool("other", "same-call"))?.model).toBe("other-model");
    expect(models.beforeTool({ ...tool("s", "child-call"), agent: "build" })).toBeUndefined();
    expect(models.beforeTool(tool("s", "no-binding"))).toBeUndefined();
  });

  it("keeps a call bound to its original message across a model switch and overlapping turns", () => {
    const models = new ModelTracker();
    message(models, "s", "a", "model-a");
    part(models, "s", "a", "a");
    expect(models.beforeTool(tool("s", "a"))?.model).toBe("model-a");
    models.chatMessage({ sessionID: "s", messageID: "new-user", model: "model-b" });
    models.event("session.next.model.switched", { sessionID: "s", model: { id: "model-b" } });
    message(models, "s", "b", "model-b");
    part(models, "s", "b", "b");
    expect(models.beforeTool(tool("s", "b"))?.model).toBe("model-b");
    expect(models.afterTool(tool("s", "a"))?.model).toBe("model-a");
  });

  it("handles parts arriving before messages and omits before-spans when evidence arrives late", () => {
    const models = new ModelTracker();
    part(models, "s", "m", "c");
    expect(models.beforeTool(tool())).toBeUndefined();
    message(models, "s", "m", "late-but-matching");
    expect(models.afterTool(tool())?.model).toBe("late-but-matching");
  });

  it("attributes deltas only to their own message, not a later same-session subagent", () => {
    const models = new ModelTracker();
    message(models, "s", "main", "main-model");
    message(models, "s", "child", "child-model", "explore");
    expect(models.event("message.part.delta", {
      sessionID: "s", messageID: "main", partID: "text", field: "text", delta: "chunk",
    })?.model).toBe("main-model");
    expect(models.event("message.part.delta", { sessionID: "s", messageID: "unknown" })).toBeUndefined();
    expect(models.event("message.part.delta", { sessionID: "other", messageID: "main" })).toBeUndefined();
  });

  it("rejects conflicting message/call identities rather than trusting the last arrival", () => {
    const models = new ModelTracker();
    message(models, "s", "m", "model-a");
    part(models, "s", "m", "c");
    message(models, "s", "m", "model-b");
    expect(models.beforeTool(tool())).toBeUndefined();
    message(models, "s", "other", "other");
    part(models, "s", "other", "c");
    expect(models.beforeTool(tool())).toBeUndefined();
    expect(models.event("message.updated", {
      sessionID: "s", info: { sessionID: "other", id: "m", role: "assistant", modelID: "wrong" },
    })).toBeUndefined();
    expect(eventSessionID("message.part.updated", {
      sessionID: "s", part: { sessionID: "other" },
    })).toBeUndefined();
  });

  it("rejects a wrong tool name or an explicitly different message identity", () => {
    const models = new ModelTracker();
    message(models, "s", "m", "model-a");
    part(models, "s", "m", "c");
    expect(models.beforeTool({ ...tool(), tool: "bash" })).toBeUndefined();
    expect(models.beforeTool({ ...tool(), messageID: "other" })).toBeUndefined();
    expect(models.beforeTool({ ...tool(), model: "explicit" })?.model).toBe("explicit");
    expect(models.beforeTool({ ...tool(), model: "unknown" })).toBeUndefined();
  });

  it.each(["session.idle", "session.deleted", "session.error", "session.status"])(
    "clears %s state before any delayed event can repopulate it", (type) => {
      const models = new ModelTracker();
      message(models, "s", "m", "old");
      part(models, "s", "m", "c");
      models.event(type, type === "session.deleted"
        ? { info: { id: "s" } }
        : { sessionID: "s", status: { type: "idle" } });
      message(models, "s", "m", "old");
      part(models, "s", "m", "c");
      expect(models.beforeTool(tool())).toBeUndefined();
      models.chatMessage({ sessionID: "s", messageID: "next-user" });
      expect(models.beforeTool(tool())).toBeUndefined();
      message(models, "s", "next", "new");
      part(models, "s", "next", "next");
      expect(models.beforeTool(tool("s", "next"))?.model).toBe("new");
    },
  );

  it("drops removed messages and parts, including cached requests", () => {
    const models = new ModelTracker();
    models.chatMessage({ sessionID: "s", messageID: "m", agent: "build", model: "selection" });
    message(models, "s", "m", "model");
    part(models, "s", "m", "c");
    models.event("message.removed", { sessionID: "s", messageID: "m" });
    expect(models.beforeTool(tool())).toBeUndefined();
    expect(models.event("message.updated", { info: { sessionID: "s", id: "m", agent: "build", role: "user" } })).toBeUndefined();
    message(models, "s", "m", "model");
    part(models, "s", "m", "next");
    models.event("message.part.removed", { sessionID: "s", partID: "part-next" });
    expect(models.beforeTool(tool("s", "next"))).toBeUndefined();
  });

  it("expires cached evidence and refuses stale timestamped replays", () => {
    let now = 1_000_000;
    const models = new ModelTracker(() => now);
    message(models, "s", "m", "old");
    part(models, "s", "m", "c");
    models.beforeTool(tool());
    now += MODEL_CACHE_LIMITS.ttlMs + 1;
    expect(models.afterTool(tool())).toBeUndefined();
    message(models, "s", "m", "old", "build", { time: { created: 1_000_000 } });
    part(models, "s", "m", "replay");
    expect(models.beforeTool(tool("s", "replay"))).toBeUndefined();
    message(models, "s", "malformed", "unusable-time", "build", { time: { created: "not-a-timestamp" } });
    part(models, "s", "malformed", "malformed");
    expect(models.beforeTool(tool("s", "malformed"))).toBeUndefined();
  });

  it("bounds message, request and call memory by evicting rather than guessing", () => {
    const models = new ModelTracker();
    for (let i = 0; i <= MODEL_CACHE_LIMITS.messages; i++) message(models, "s", `m${i}`, `model-${i}`);
    part(models, "s", "m0", "old");
    expect(models.beforeTool(tool("s", "old"))).toBeUndefined();
    for (let i = 0; i <= MODEL_CACHE_LIMITS.calls; i++) part(models, "s", "m1", `call-${i}`);
    expect(models.beforeTool(tool("s", "call-0"))).toBeUndefined();
    for (let i = 0; i <= MODEL_CACHE_LIMITS.requests; i++) {
      models.chatMessage({ sessionID: "s", messageID: `u${i}`, agent: "build", model: "selected" });
    }
    expect(models.event("message.updated", {
      info: { sessionID: "s", id: "u0", role: "user", agent: "build" },
    })).toBeUndefined();
  });
});
