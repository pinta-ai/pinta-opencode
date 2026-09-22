export interface OpencodeModel {
  id?: string;
  modelID?: string;
  providerID?: string;
}

type ModelValue = string | OpencodeModel;

interface MessageReference {
  id?: string;
  sessionID?: string;
  agent?: string;
  model?: ModelValue;
  time?: { created?: number };
}

export interface ChatMessageInput {
  sessionID?: string;
  agent?: string;
  model?: ModelValue;
  messageID?: string;
  variant?: string;
}

export interface ChatMessageOutput {
  message?: MessageReference;
  parts?: unknown[];
}

export interface ChatParamsInput {
  sessionID: string;
  agent: string;
  model: OpencodeModel;
  message: MessageReference;
}

export interface ChatParamsOutput {
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens?: number;
  options: Record<string, unknown>;
}

export interface ToolModelInput {
  tool: string;
  sessionID: string;
  callID: string;
  // Not present in the currently verified tool hooks. Read explicit fields if
  // a host version supplies them; never replace them with a session default.
  model?: ModelValue;
  modelID?: string;
  providerID?: string;
  agent?: string;
  messageID?: string;
}

export interface ModelEvidence {
  model: string;
  source: string;
  provider?: string;
  agent?: string;
  messageID?: string;
}

export const MODEL_CACHE_LIMITS = {
  messages: 1024,
  requests: 512,
  calls: 2048,
  endedSessions: 128,
  ttlMs: 15 * 60 * 1000,
} as const;

const PLACEHOLDERS = new Set([
  "unknown", "undefined", "null", "n/a", "none", "-", "auto", "default",
]);

function identifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= 1024 ? text : undefined;
}

function modelId(value: unknown): string | undefined {
  const id = identifier(value);
  if (!id || id.startsWith("{") || id.startsWith("[") || PLACEHOLDERS.has(id.toLowerCase())) return undefined;
  return id;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function fromModel(value: unknown, source: string, provider?: unknown): ModelEvidence | undefined {
  const obj = record(value);
  const model = obj ? modelId(obj.modelID) ?? modelId(obj.id) : modelId(value);
  if (!model) return undefined;
  return {
    model,
    source: obj ? `${source}.${modelId(obj.modelID) ? "modelID" : "id"}` : source,
    provider: modelId(obj?.providerID ?? provider),
  };
}

function key(...parts: string[]): string {
  return JSON.stringify(parts);
}

function agreed(...values: unknown[]): string | undefined {
  const ids = values.map(identifier).filter((id): id is string => id !== undefined);
  return ids.every((id) => id === ids[0]) ? ids[0] : undefined;
}

export function eventSessionID(type: string | undefined, props: Record<string, unknown>): string | undefined {
  const info = record(props.info);
  const part = record(props.part);
  return typeof type === "string" && type.startsWith("session.")
    ? agreed(props.sessionID, info?.id)
    : agreed(props.sessionID, info?.sessionID, part?.sessionID);
}

interface SessionEntry {
  sessionID: string;
}

class BoundedCache<T extends SessionEntry> {
  private entries = new Map<string, { value: T; expires: number }>();

  constructor(private limit: number, private now: () => number) {}

  get(id: string): T | undefined {
    const entry = this.entries.get(id);
    if (entry && entry.expires > this.now()) return entry.value;
    this.entries.delete(id);
    return undefined;
  }

  set(id: string, value: T): void {
    this.entries.delete(id);
    this.entries.set(id, { value, expires: this.now() + MODEL_CACHE_LIMITS.ttlMs });
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }

  removeWhere(predicate: (value: T) => boolean): void {
    for (const [id, entry] of this.entries) {
      if (predicate(entry.value)) this.entries.delete(id);
    }
  }

  clearSession(sessionID: string): void {
    this.removeWhere((entry) => entry.sessionID === sessionID);
  }
}

interface MessageEntry extends SessionEntry {
  messageID: string;
  evidence?: ModelEvidence;
  ambiguous?: boolean;
}

interface RequestEntry extends SessionEntry {
  messageID: string;
  evidence?: ModelEvidence;
}

interface CallEntry extends SessionEntry {
  messageID: string;
  partID?: string;
  tool?: string;
  pinned?: ModelEvidence;
  closed?: boolean;
  ambiguous?: boolean;
}

/**
 * Only exact message/call joins, never a "last model" per process or session.
 * Caches hold identifiers/evidence, not messages, prompts or tool arguments.
 */
export class ModelTracker {
  private messages: BoundedCache<MessageEntry>;
  private requests: BoundedCache<RequestEntry>;
  private calls: BoundedCache<CallEntry>;
  private ended = new Map<string, true>();

  constructor(private now: () => number = Date.now) {
    this.messages = new BoundedCache(MODEL_CACHE_LIMITS.messages, now);
    this.requests = new BoundedCache(MODEL_CACHE_LIMITS.requests, now);
    this.calls = new BoundedCache(MODEL_CACHE_LIMITS.calls, now);
  }

  chatMessage(input: ChatMessageInput, output?: ChatMessageOutput): void {
    const sessionID = agreed(input.sessionID, output?.message?.sessionID);
    if (!sessionID) return;
    this.ended.delete(sessionID);
    const messageID = agreed(input.messageID, output?.message?.id);
    if (!messageID) return;
    const agent = identifier(output?.message?.agent ?? input.agent);
    const supplied = output?.message?.model !== undefined;
    this.requests.set(key(sessionID, messageID, agent ?? ""), {
      sessionID, messageID,
      evidence: fromModel(
        supplied ? output.message?.model : input.model,
        supplied ? "requested:chat.message.message.model" : "requested:chat.message.model",
      ),
    });
  }

  chatParams(input: ChatParamsInput): void {
    const sessionID = agreed(input.sessionID, input.message?.sessionID);
    const messageID = identifier(input.message?.id);
    const agent = identifier(input.agent);
    if (!sessionID || !messageID || !agent || this.ended.has(sessionID)) return;
    this.requests.set(key(sessionID, messageID, agent), {
      sessionID, messageID,
      evidence: fromModel(input.model, "requested:chat.params.model"),
    });
  }

  private fresh(timestamp: unknown): boolean {
    return timestamp === undefined
      || (typeof timestamp === "number" && Number.isFinite(timestamp)
        && timestamp >= this.now() - MODEL_CACHE_LIMITS.ttlMs);
  }

  private clearSession(sessionID: string): void {
    this.messages.clearSession(sessionID);
    this.requests.clearSession(sessionID);
    this.calls.clearSession(sessionID);
  }

  event(type: string | undefined, props: Record<string, unknown>): ModelEvidence | undefined {
    const sessionID = eventSessionID(type, props);
    const info = record(props.info);
    const part = record(props.part);
    const ended = ["session.idle", "session.deleted", "session.error"].includes(type ?? "")
      || (type === "session.status" && record(props.status)?.type === "idle");
    if (sessionID && ended) {
      this.clearSession(sessionID);
      this.ended.delete(sessionID);
      this.ended.set(sessionID, true);
      if (this.ended.size > MODEL_CACHE_LIMITS.endedSessions) this.ended.delete(this.ended.keys().next().value!);
    } else if (sessionID && type === "session.created") {
      this.clearSession(sessionID);
      this.ended.delete(sessionID);
    }

    if (type === "message.updated" && info) {
      // Conflicting envelope identities are not a usable attribution.
      if (!agreed(props.sessionID, info.sessionID) && (props.sessionID || info.sessionID)) return undefined;
      const messageID = identifier(info.id);
      const agent = identifier(info.agent);
      const role = info.role;
      let evidence = role === "assistant"
        ? fromModel(modelId(info.modelID), "reported:message.updated.info.modelID", info.providerID)
          ?? fromModel(info.model, "reported:message.updated.info.model")
        : role === "user"
          ? fromModel(info.model, "requested:message.updated.info.model")
          : undefined;
      if (!evidence && role === "user" && !("model" in info) && sessionID && messageID) {
        evidence = this.requests.get(key(sessionID, messageID, agent ?? ""))?.evidence;
      }
      if (role === "user" && "model" in info && !evidence && sessionID && messageID) {
        this.requests.set(key(sessionID, messageID, agent ?? ""), { sessionID, messageID });
      }
      if (evidence) evidence = { ...evidence, agent, messageID };
      if (sessionID && messageID
        && !this.ended.has(sessionID) && this.fresh(record(info.time)?.created)) {
        const old = this.messages.get(key(sessionID, messageID));
        const ambiguous = old?.ambiguous || Boolean(role === "assistant" && old?.evidence && evidence
          && (old.evidence.model !== evidence.model || old.evidence.provider !== evidence.provider
            || old.evidence.agent !== evidence.agent));
        this.messages.set(key(sessionID, messageID), {
          sessionID, messageID, evidence: ambiguous ? undefined : evidence, ambiguous,
        });
      }
      return evidence;
    }

    if (sessionID && type === "message.removed") {
      const messageID = identifier(props.messageID);
      this.messages.removeWhere((entry) => entry.sessionID === sessionID && entry.messageID === messageID);
      this.requests.removeWhere((entry) => entry.sessionID === sessionID && entry.messageID === messageID);
      this.calls.removeWhere((entry) => entry.sessionID === sessionID && entry.messageID === messageID);
    }
    if (sessionID && type === "message.part.removed") {
      const partID = identifier(props.partID);
      if (partID) this.calls.removeWhere((entry) => entry.sessionID === sessionID && entry.partID === partID);
    }
    if (type === "message.part.delta") {
      const messageID = identifier(props.messageID);
      return sessionID && messageID && !this.ended.has(sessionID)
        ? this.messages.get(key(sessionID, messageID))?.evidence
        : undefined;
    }
    if (type === "message.part.updated" && part) {
      if (!sessionID || this.ended.has(sessionID) || !this.fresh(props.time)) return undefined;
      const messageID = identifier(part.messageID);
      if (!messageID) return undefined;
      const callID = identifier(part.callID);
      if (part.type === "tool" && callID) {
        const callKey = key(sessionID, callID);
        const old = this.calls.get(callKey);
        if (!old?.closed) {
          const tool = identifier(part.tool);
          this.calls.set(callKey, {
            sessionID, messageID, partID: identifier(part.id), tool, pinned: old?.pinned,
            ambiguous: old?.ambiguous || Boolean(old && (old.messageID !== messageID || old.tool !== tool)),
          });
        }
      }
      return this.messages.get(key(sessionID, messageID))?.evidence;
    }

    if (typeof type === "string" && type.startsWith("session.")) {
      return fromModel(info?.model, `selected:${type}.info.model`)
        ?? fromModel(props.model, `selected:${type}.model`);
    }
    return fromModel(props.model, "reported:event.model")
      ?? fromModel(modelId(props.modelID), "reported:event.modelID", props.providerID);
  }

  private tool(input: ToolModelInput, after: boolean): ModelEvidence | undefined {
    const direct = fromModel(modelId(input.modelID), "reported:tool.modelID", input.providerID)
      ?? fromModel(input.model, "reported:tool.model", input.providerID);
    const sessionID = identifier(input.sessionID);
    const callID = identifier(input.callID);
    if (!sessionID || !callID) return direct;
    const callKey = key(sessionID, callID);
    const call = this.calls.get(callKey);
    let evidence = direct;
    if (!("model" in input) && !("modelID" in input) && call && !call.closed && !call.ambiguous
      && !this.ended.has(sessionID) && (!call.tool || call.tool === input.tool)) {
      const message = this.messages.get(key(sessionID, call.messageID));
      if (!message?.ambiguous) evidence = call.pinned ?? message?.evidence;
      if ((input.agent && evidence?.agent && input.agent !== evidence.agent)
        || (input.messageID && input.messageID !== call.messageID)) evidence = undefined;
    }
    if (call && !call.closed) {
      this.calls.set(callKey, {
        ...call, pinned: after ? undefined : evidence, closed: after,
      });
    }
    return evidence;
  }

  beforeTool(input: ToolModelInput): ModelEvidence | undefined {
    return this.tool(input, false);
  }

  afterTool(input: ToolModelInput): ModelEvidence | undefined {
    return this.tool(input, true);
  }
}

export function modelFields(fields: Record<string, unknown>, evidence?: ModelEvidence): Record<string, unknown> {
  const { model: rawModel, model_source: rawSource, ...out } = fields;
  if ("model" in fields && rawModel !== evidence?.model) out.model_raw = rawModel;
  if ("model_source" in fields) out.model_source_raw = rawSource;
  if (evidence) {
    out.model = evidence.model;
    out.model_source = evidence.source;
    if (evidence.provider) {
      if ("provider" in out && out.provider !== evidence.provider) out.provider_raw = out.provider;
      out.provider = evidence.provider;
    }
    if (out.agent === undefined) out.agent = evidence.agent;
    if (out.message_id === undefined) out.message_id = evidence.messageID;
  }
  return out;
}
