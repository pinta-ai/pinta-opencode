import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateGuard } from "../src/core/guard.js";
import { resolveConfig } from "../src/config.js";

// The other half of `guard-timeout.test.ts`: that file pins the number handed
// to core, this one pins what reaches the wire. With core >=0.9.0 the manager
// reads `x-pinta-guard-budget-ms` and plans its own work around it instead of
// the copy of our default it keeps in `caller-budget.ts` (PTA-579). Real core,
// stubbed fetch — a core that stopped sending the header fails here.
function stubFetch() {
  const fetchMock = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ decision: "ALLOW", reason: null, durationMs: 1 }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>): Record<string, string> {
  return (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("guard budget header", () => {
  it("declares the 100ms default to the manager", async () => {
    vi.stubEnv("PINTA_OPENCODE_GUARD_TIMEOUT_MS", "");
    const fetchMock = stubFetch();
    const { guardTimeoutMs } = resolveConfig();
    await evaluateGuard({ resourceSpans: [] }, "http://127.0.0.1:5147/guard/evaluate", { timeoutMs: guardTimeoutMs });
    expect(sentHeaders(fetchMock)).toMatchObject({
      "x-pinta-guard-budget-ms": "100",
      "user-agent": expect.stringMatching(/^pinta-opencode\//),
    });
  });

  it("declares an operator override, not the default", async () => {
    vi.stubEnv("PINTA_OPENCODE_GUARD_TIMEOUT_MS", "250");
    const fetchMock = stubFetch();
    const { guardTimeoutMs } = resolveConfig();
    await evaluateGuard({ resourceSpans: [] }, "http://127.0.0.1:5147/guard/evaluate", { timeoutMs: guardTimeoutMs });
    expect(sentHeaders(fetchMock)["x-pinta-guard-budget-ms"]).toBe("250");
  });
});
