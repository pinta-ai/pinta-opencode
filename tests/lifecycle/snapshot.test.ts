import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { snapshot, detectSqlite3, resetSqlite3Probe } from "../../src/lifecycle/snapshot";
import type { TranscriptFile } from "../../src/lifecycle/types";

let workDir: string; // holds the source "db"
let tmpDir: string; // injected snapshot output base

function dbFile(absPath: string): TranscriptFile {
  const st = fs.statSync(absPath);
  return {
    relPath: path.basename(absPath),
    absPath,
    size: st.size,
    mtime: st.mtime,
    semantics: "database",
  };
}

function hasSqlite3(): boolean {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pinta-opencode-snap-src-"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pinta-opencode-snap-out-"));
  resetSqlite3Probe();
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectSqlite3() memoization", () => {
  it("returns the same probe promise until reset", () => {
    const a = detectSqlite3();
    const b = detectSqlite3();
    expect(a).toBe(b);
    resetSqlite3Probe();
    expect(detectSqlite3()).not.toBe(a);
  });
});

describe("quiesce-copy fallback (sqlite3Path: null)", () => {
  it("copies the db (+wal/+shm) into the injected tmp dir and returns its path", async () => {
    const src = path.join(workDir, "opencode.db");
    fs.writeFileSync(src, "DB-BYTES-v1");
    fs.writeFileSync(`${src}-wal`, "WAL-BYTES");
    fs.writeFileSync(`${src}-shm`, "SHM-BYTES");
    // Age the mtime so the stability window passes immediately.
    const past = new Date(Date.now() - 60_000);
    for (const p of [src, `${src}-wal`, `${src}-shm`]) fs.utimesSync(p, past, past);

    const out = await snapshot(dbFile(src), { sqlite3Path: null, tmpDir, stableMs: 20 });

    expect(out.startsWith(tmpDir)).toBe(true);
    expect(fs.readFileSync(out, "utf8")).toBe("DB-BYTES-v1");
    expect(fs.readFileSync(`${out}-wal`, "utf8")).toBe("WAL-BYTES");
    expect(fs.readFileSync(`${out}-shm`, "utf8")).toBe("SHM-BYTES");
  });

  it("works when -wal/-shm are absent (checkpointed db)", async () => {
    const src = path.join(workDir, "opencode.db");
    fs.writeFileSync(src, "DB-ONLY");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(src, past, past);

    const out = await snapshot(dbFile(src), { sqlite3Path: null, tmpDir, stableMs: 20 });
    expect(fs.readFileSync(out, "utf8")).toBe("DB-ONLY");
    expect(fs.existsSync(`${out}-wal`)).toBe(false);
  });

  it("waits for mtime to stabilize before copying", async () => {
    const src = path.join(workDir, "opencode.db");
    fs.writeFileSync(src, "FRESH");
    // Leave mtime at ~now so the first stability window must actually elapse.
    const t0 = Date.now();
    const out = await snapshot(dbFile(src), { sqlite3Path: null, tmpDir, stableMs: 80 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    expect(fs.readFileSync(out, "utf8")).toBe("FRESH");
  });

  it("retries when the file keeps moving, then returns a best-effort copy", async () => {
    const src = path.join(workDir, "opencode.db");
    fs.writeFileSync(src, "v0");
    // Disturb the file a couple of times early, then let it settle — the
    // retry loop should stabilize on a later attempt.
    let n = 1;
    const timers = [
      setTimeout(() => fs.writeFileSync(src, `v${n++}`), 15),
      setTimeout(() => fs.writeFileSync(src, `v${n++}`), 45),
    ];
    try {
      const out = await snapshot(dbFile(src), {
        sqlite3Path: null,
        tmpDir,
        stableMs: 30,
        maxRetries: 5,
      });
      expect(fs.existsSync(out)).toBe(true);
      // The copy is one of the written generations.
      expect(fs.readFileSync(out, "utf8")).toMatch(/^v\d+$/);
    } finally {
      for (const t of timers) clearTimeout(t);
    }
  });
});

describe("sqlite3 CLI .backup path", () => {
  it.skipIf(!hasSqlite3())(
    "produces a single consolidated db (no -wal) that opens and queries",
    async () => {
      const src = path.join(workDir, "opencode.db");
      execFileSync("sqlite3", [
        src,
        "CREATE TABLE t(id INTEGER, v TEXT); INSERT INTO t VALUES (1,'hello');",
      ]);

      // Auto-detect (sqlite3Path undefined) should pick the real CLI.
      const out = await snapshot(dbFile(src), { tmpDir });

      expect(out.startsWith(tmpDir)).toBe(true);
      expect(fs.existsSync(out)).toBe(true);
      expect(fs.existsSync(`${out}-wal`)).toBe(false); // consolidated, no sidecar
      const row = execFileSync("sqlite3", [out, "SELECT v FROM t WHERE id=1;"]).toString().trim();
      expect(row).toBe("hello");
    },
  );

  it.skipIf(!hasSqlite3())("falls back to quiesce-copy when .backup targets a non-db file", async () => {
    const src = path.join(workDir, "opencode.db");
    fs.writeFileSync(src, "not actually sqlite");
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(src, past, past);

    // Auto-detect finds sqlite3; .backup fails on the junk file; fallback copies bytes.
    const out = await snapshot(dbFile(src), { tmpDir, stableMs: 20 });
    expect(fs.readFileSync(out, "utf8")).toBe("not actually sqlite");
  });
});
