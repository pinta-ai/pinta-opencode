/**
 * `snapshot()` — obtain a *consistent* copy of a live SQLite database file so
 * the sidecar can hash/upload it without a torn read (plan §4.2 `database`
 * semantics, §6 "SQLite 라이브 파일 torn read").
 *
 * This is the shared strategy every troy wrapper that owns a `database`-
 * semantics file implements locally (opencode.db here; copilot session.db and
 * antigravity conversations.db elsewhere). It is kept dependency-free — **no
 * native npm modules** (`better-sqlite3` etc.) — because adaptors ship as a
 * single `bun build --target=bun` `.mjs` and must only use `node:*` APIs
 * (plan §2 "adaptor 배포 형태", §4.2).
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 * • Input:  a {@link TranscriptFile} with `semantics === 'database'`.
 * • Output: an **absolute path** to a freshly-written temp file that is a
 *           point-in-time-consistent snapshot of `file.absPath`.
 * • Ownership: the **caller owns** the returned path and must delete it (and
 *           may `rm -rf` its parent temp dir) after uploading. This function
 *           never deletes what it returns.
 * • Purity: reads only; never mutates the source db / `-wal` / `-shm`.
 *
 * ── Strategy (in order) ───────────────────────────────────────────────────
 * 1. **`sqlite3` CLI `.backup`** (preferred): spawn the system `sqlite3`
 *    binary and run `.backup <tmp>`. The online-backup API walks the db under
 *    a read lock and folds in the live `-wal`, yielding a single self-
 *    contained db with no sidecar files. Availability is probed **once** and
 *    memoized.
 * 2. **Quiesce-copy fallback** (no `sqlite3` on PATH): wait until the db's
 *    `mtime` has been stable for ≥ `stableMs` (default 2s), copy db + `-wal` +
 *    `-shm` together, then re-`stat` the source and verify `size`/`mtime` are
 *    unchanged across the copy. Retry up to `maxRetries` (default 3) if the
 *    file moved under us; the last attempt is returned best-effort. The copied
 *    `-wal`/`-shm` sit beside the db in the temp dir so the snapshot stays
 *    coherent if later reopened by SQLite.
 */
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { TranscriptFile } from "./types.js";

const execFileAsync = promisify(execFile);

export interface SnapshotOptions {
  /** Base dir for the temp snapshot dir. Injectable for tests. Default: os tmpdir. */
  tmpDir?: string;
  /**
   * `sqlite3` binary resolution:
   * - `undefined` → auto-detect once (memoized) via `sqlite3 -version`.
   * - `null`      → force the quiesce-copy fallback (skip the CLI entirely).
   * - `string`    → use this path as the `sqlite3` binary.
   * Injectable so tests can exercise the fallback deterministically.
   */
  sqlite3Path?: string | null;
  /** ms the source mtime must hold steady before a fallback copy. Default 2000. */
  stableMs?: number;
  /** max fallback copy attempts when the file keeps moving. Default 3. */
  maxRetries?: number;
  /**
   * Overall wall-clock cap (ms) for the quiesce-copy fallback. The mtime-
   * stability wait can otherwise spin forever when the source is written on a
   * cadence shorter than `stableMs` (opencode flushes `opencode.db` ~every 2s),
   * hanging `snapshot()` and stalling the sidecar scan pipeline. On exceed we
   * take a best-effort copy of the current bytes instead of waiting further.
   * Default: `max(stableMs * maxRetries * 3, 15000)`.
   */
  deadlineMs?: number;
}

const DEFAULT_STABLE_MS = 2000;
const DEFAULT_MAX_RETRIES = 3;

/** Memoized `sqlite3` availability probe (module-scoped; reset via {@link resetSqlite3Probe}). */
let sqlite3Probe: Promise<string | null> | undefined;

/** Detect a usable `sqlite3` on PATH, once. Returns the binary name or null. */
export function detectSqlite3(): Promise<string | null> {
  if (sqlite3Probe === undefined) {
    sqlite3Probe = execFileAsync("sqlite3", ["-version"])
      .then(() => "sqlite3" as const)
      .catch(() => null)
      .then((result) => {
        // Cache a positive result permanently (the binary won't vanish), but
        // don't permanently memoize a *negative* one: a missing or transiently
        // failing `sqlite3` (PATH not yet populated, EAGAIN under load) may
        // succeed on a later scan. Drop the cache so the next call re-probes.
        // Concurrent callers still share the single in-flight probe above.
        if (result === null) sqlite3Probe = undefined;
        return result;
      });
  }
  return sqlite3Probe;
}

/** Test hook: clear the memoized `sqlite3` probe so the next call re-detects. */
export function resetSqlite3Probe(): void {
  sqlite3Probe = undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Create a fresh, unique temp dir under `base` for one snapshot. */
async function makeSnapshotDir(base: string): Promise<string> {
  return mkdtemp(path.join(base, "pinta-opencode-snap-"));
}

/**
 * `sqlite3 <db> ".backup <out>"` — consistent online backup into a single db.
 * The `.timeout` pragma lets `.backup` wait out a busy writer instead of
 * failing immediately.
 */
async function backupViaCli(sqlite3Path: string, dbPath: string, outPath: string): Promise<void> {
  // `-cmd ".timeout 5000"` runs before the db is read so `.backup` waits out a
  // busy writer instead of failing on a lock; the trailing arg then runs the
  // online-backup snapshot and exits. (Dot-commands must each be their own
  // argv element — a single `\n`-joined arg is silently ignored by the CLI.)
  // Quote the out path to tolerate spaces; `''` escapes an embedded quote.
  const backupCmd = `.backup '${outPath.replace(/'/g, "''")}'`;
  await execFileAsync(sqlite3Path, ["-cmd", ".timeout 5000", dbPath, backupCmd]);
}

/**
 * Quiesce-copy: wait for mtime stability, copy db(+wal+shm), verify the source
 * didn't move across the copy, retry on movement. Returns the copied db path.
 */
async function quiesceCopy(
  file: TranscriptFile,
  outDir: string,
  stableMs: number,
  maxRetries: number,
  deadlineMs: number,
): Promise<string> {
  const dbPath = file.absPath;
  const outDbPath = path.join(outDir, path.basename(dbPath));
  // Absolute wall-clock cap so the stability wait can never spin forever when
  // the source is written faster than `stableMs` (opencode's ~2s flush cadence).
  const deadline = Date.now() + deadlineMs;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 1) Wait for the source mtime to hold steady for `stableMs`, but never
      //    past the overall deadline.
      let before = await stat(dbPath);
      let stable = false;
      while (Date.now() < deadline) {
        await sleep(stableMs);
        const now = await stat(dbPath);
        if (now.mtimeMs === before.mtimeMs && now.size === before.size) {
          stable = true;
          break;
        }
        before = now;
      }

      // 2) Copy db + sidecars (best-effort for -wal/-shm; they may be absent).
      await copyFile(dbPath, outDbPath);
      await copyIfPresent(`${dbPath}-wal`, `${outDbPath}-wal`);
      await copyIfPresent(`${dbPath}-shm`, `${outDbPath}-shm`);

      // If the deadline elapsed before the source ever quiesced, return this
      // best-effort copy now (the contract permits a slightly-torn copy over an
      // unbounded hang) rather than looping to retry a wait that can't win.
      if (!stable) return outDbPath;

      // 3) Re-stat the source: if it moved during the copy, retry.
      const after = await stat(dbPath);
      if (after.mtimeMs === before.mtimeMs && after.size === before.size) {
        return outDbPath;
      }
      // Moved under us — loop and try again.
    } catch (err) {
      lastErr = err;
    }
    // Stop retrying once the overall deadline has passed.
    if (Date.now() >= deadline) break;
  }

  // Exhausted retries. If we managed to write *something*, return it
  // best-effort (plan: "≤3 retries" then proceed); otherwise surface the error.
  try {
    await stat(outDbPath);
    return outDbPath;
  } catch {
    throw lastErr ?? new Error(`snapshot quiesce-copy failed for ${dbPath}`);
  }
}

async function copyIfPresent(src: string, dst: string): Promise<void> {
  try {
    await copyFile(src, dst);
  } catch {
    // -wal / -shm absent (checkpointed, or a fresh db) — nothing to copy.
  }
}

/**
 * Produce a consistent snapshot of a `database`-semantics file and return the
 * absolute path to the copy. See the module JSDoc for the full contract.
 */
export async function snapshot(file: TranscriptFile, opts: SnapshotOptions = {}): Promise<string> {
  const base = opts.tmpDir ?? tmpdir();
  const stableMs = opts.stableMs ?? DEFAULT_STABLE_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const deadlineMs = opts.deadlineMs ?? Math.max(stableMs * maxRetries * 3, 15_000);

  const sqlite3Path =
    opts.sqlite3Path === undefined ? await detectSqlite3() : opts.sqlite3Path;

  const outDir = await makeSnapshotDir(base);

  try {
    if (sqlite3Path) {
      const outPath = path.join(outDir, `${path.basename(file.absPath)}.snapshot`);
      try {
        await backupViaCli(sqlite3Path, file.absPath, outPath);
        return outPath;
      } catch {
        // CLI backup failed (locked out, odd build) — fall through to the
        // quiesce-copy fallback rather than dropping the file entirely.
      }
    }

    return await quiesceCopy(file, outDir, stableMs, maxRetries, deadlineMs);
  } catch (err) {
    // On failure the caller never receives the path and so can't clean it up —
    // remove the temp dir we own here. (On success the caller owns `outDir`.)
    await rm(outDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}
