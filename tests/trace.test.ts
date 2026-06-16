import { describe, it, expect } from "vitest";
import { TraceManager } from "../src/core/trace.js";

describe("TraceManager", () => {
  it("currentTrace creates then reuses a trace per session", () => {
    const tm = new TraceManager();
    const a = tm.currentTrace("ses_1");
    expect(a).toHaveLength(26);
    expect(tm.currentTrace("ses_1")).toBe(a);
  });

  it("newTrace rotates the trace for a session", () => {
    const tm = new TraceManager();
    const a = tm.currentTrace("ses_1");
    const b = tm.newTrace("ses_1");
    expect(b).not.toBe(a);
    expect(tm.currentTrace("ses_1")).toBe(b);
  });

  it("keeps separate traces per session", () => {
    const tm = new TraceManager();
    expect(tm.currentTrace("ses_1")).not.toBe(tm.currentTrace("ses_2"));
  });

  it("caps stored sessions (evicts oldest)", () => {
    const tm = new TraceManager();
    const first = tm.newTrace("ses_first");
    for (let i = 0; i < 250; i++) tm.newTrace(`ses_${i}`);
    // ses_first was evicted → a fresh trace differs from the original.
    expect(tm.currentTrace("ses_first")).not.toBe(first);
  });
});
