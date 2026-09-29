import { describe, it, expect, vi, beforeEach } from "vitest";

// The binding's job here is the number it hands core: core >=0.9.0 both aborts
// on it and declares it to the manager as `x-pinta-guard-budget-ms`, so this is
// the value the manager plans its own work around (PTA-579). Asserted at the
// core boundary rather than by timing a real abort, which would be slow and flaky.
const coreEvaluateGuard = vi.fn(async () => null);
vi.mock("@pinta-ai/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pinta-ai/core")>()),
  evaluateGuard: coreEvaluateGuard,
}));

const { evaluateGuard } = await import("../src/core/guard.js");

beforeEach(() => coreEvaluateGuard.mockClear());

describe("guard timeout handed to core", () => {
  it("defaults to 100ms", async () => {
    await evaluateGuard({ resourceSpans: [] }, "http://x");
    expect(coreEvaluateGuard).toHaveBeenCalledTimes(1);
    expect(coreEvaluateGuard.mock.calls[0]?.[2]).toMatchObject({ timeoutMs: 100 });
  });

  it("passes an explicit timeout through unchanged", async () => {
    await evaluateGuard({ resourceSpans: [] }, "http://x", { timeoutMs: 300 });
    expect(coreEvaluateGuard.mock.calls[0]?.[2]).toMatchObject({ timeoutMs: 300 });
  });
});
