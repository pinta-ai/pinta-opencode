/**
 * M5c — pinta-opencode `TranscriptSource` for opencode's data directory.
 *
 * Real-world shape observed on disk (plan §4.3, measured 2026-07-12):
 *   <dataRoot>/opencode.db                       SQLite — `database`, needs snapshot()
 *   <dataRoot>/opencode.db-wal, -shm             live WAL sidecars — EXCLUDED
 *   <dataRoot>/storage/session_diff/ses_*.json   per-session diff — `rewritten-doc`
 *   <dataRoot>/storage/migration                 tiny marker — `rewritten-doc` / 'other'
 *   <dataRoot>/auth.json                         SECRETS — EXCLUDED (never emitted)
 *   <dataRoot>/log/**, <dataRoot>/repos/**       EXCLUDED
 *
 * Data-root resolution honors the same overrides opencode itself respects,
 * most-specific first:
 *   1. $OPENCODE_DATA            (explicit opencode data override)
 *   2. $XDG_DATA_HOME/opencode   (XDG base-dir spec)
 *   3. ~/.local/share/opencode   (default)
 *
 * Per plan §4.2 the lifecycle module sticks to `node:*` APIs only (no Bun-
 * specific globals) so it runs unmodified whether the sidecar host is Node or
 * Bun.
 */
import { opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { snapshot } from "./snapshot.js";
import type {
  TranscriptClass,
  TranscriptFile,
  TranscriptSemantics,
  TranscriptSource,
} from "./types.js";

const WRAPPER_ID = "pinta-opencode";

/**
 * `$OPENCODE_DATA ?? $XDG_DATA_HOME/opencode ?? ~/.local/share/opencode`.
 * Mirrors opencode's own data-dir resolution (XDG base-dir with an explicit
 * override), so the scanner points at whatever root the user's opencode uses.
 */
function dataRoot(): string {
  const explicit = process.env.OPENCODE_DATA;
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) {
    return path.join(xdg, "opencode");
  }
  return path.join(homedir(), ".local", "share", "opencode");
}

/** Relative path from `root` to `absPath`, POSIX-style (`/` separators) on every platform. */
function toPosixRelPath(root: string, absPath: string): string {
  return path.relative(root, absPath).split(path.sep).join("/");
}

/**
 * Exclusion rules owned by the lifecycle (plan §4.3): the scanner never even
 * emits these, so secrets/noise cannot reach the uploader.
 * - `auth.json`            — SECRETS, must never be yielded.
 * - `log/**`, `repos/**`   — noise / working checkouts.
 * - `*.db-wal`, `*.db-shm` — live SQLite sidecars; the db is snapshot()'d
 *   instead, and scan reports only the `.db` itself.
 */
function isExcluded(relPath: string): boolean {
  if (relPath === "auth.json") return true;
  const top = relPath.split("/")[0];
  if (top === "log" || top === "repos") return true;
  if (relPath.endsWith(".db-wal") || relPath.endsWith(".db-shm")) return true;
  return false;
}

/** Directories we never descend into (prunes the large `log/` tree early). */
function isExcludedDir(relPath: string): boolean {
  return relPath === "log" || relPath === "repos";
}

function semanticsFor(relPath: string): TranscriptSemantics {
  // The top-level SQLite db is the only `database` file; everything opencode
  // writes under storage/ is rewritten wholesale on save.
  return relPath.endsWith(".db") ? "database" : "rewritten-doc";
}

/**
 * `sessionId` for storage docs whose filename is the session id, e.g.
 * `storage/session_diff/ses_12a108….json` → `ses_12a108…`. Other files carry
 * no session id.
 */
function sessionIdFor(relPath: string): string | undefined {
  const base = path.posix.basename(relPath);
  if (!base.startsWith("ses_")) return undefined;
  const ext = path.posix.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/** `classify()` — coarse content type from `relPath` alone (plan §4.2). */
export function classify(relPath: string): TranscriptClass {
  if (relPath.endsWith(".db")) {
    return "session-log";
  }
  if (relPath.endsWith(".json")) {
    return "meta";
  }
  return "other";
}

export async function roots(): Promise<string[]> {
  return [dataRoot()];
}

/**
 * Recursive, streaming walk of `dir` yielding every *file* (never
 * directories), depth-first, skipping excluded subtrees. Uses `opendir`'s own
 * async iteration so we never materialize a whole directory (or the tree) in
 * memory at once.
 */
async function* walkFiles(
  root: string,
  dir: string,
): AsyncGenerator<{ absPath: string; relPath: string }> {
  let entries;
  try {
    entries = await opendir(dir);
  } catch {
    // Root doesn't exist yet (opencode never run) or vanished mid-walk.
    return;
  }

  try {
    for await (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      const relPath = toPosixRelPath(root, absPath);
      if (entry.isDirectory()) {
        if (isExcludedDir(relPath)) continue;
        yield* walkFiles(root, absPath);
      } else if (entry.isFile()) {
        if (isExcluded(relPath)) continue;
        yield { absPath, relPath };
      }
      // Symlinks / special entries are skipped — opencode does not produce
      // them here, and following them risks escaping the root or cycles.
    }
  } catch {
    // Directory removed while iterating — treat as end of this subtree.
    return;
  }
}

async function* scan(opts: { since?: Date }): AsyncIterable<TranscriptFile> {
  const [root] = await roots();
  const sinceMs = opts.since?.getTime();

  for await (const { absPath, relPath } of walkFiles(root, root)) {
    let st;
    try {
      st = await stat(absPath);
    } catch {
      // Removed between listing and stat (TOCTOU) — skip (plan §4.1 "삭제됨: 스킵").
      continue;
    }

    if (sinceMs !== undefined && st.mtime.getTime() <= sinceMs) {
      continue;
    }

    yield {
      relPath,
      absPath,
      size: st.size,
      mtime: st.mtime,
      sessionId: sessionIdFor(relPath),
      semantics: semanticsFor(relPath),
    };
  }
}

export const lifecycle: TranscriptSource = {
  id: WRAPPER_ID,
  roots,
  scan,
  classify,
  // `database` files (opencode.db) must be snapshot()'d before read — the live
  // file has `-wal`/`-shm` and would torn-read (plan §4.2, §6).
  snapshot,
};
