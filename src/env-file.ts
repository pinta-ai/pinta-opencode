/**
 * Graceful env-file loader (opencode binding over @pinta-ai/core).
 *
 * pinta-opencode can read config from `~/.config/opencode/pinta-opencode.env`
 * (or `$OPENCODE_CONFIG_DIR/pinta-opencode.env`) — `KEY=VALUE` per line. This is
 * the lowest-priority source; plugin options and explicit process.env win.
 *
 * Resolution precedence (highest → lowest): plugin options → process.env →
 * this file (unset keys only). Missing file is a silent no-op.
 *
 * The parser + merge semantics (only fill unset keys; silent no-op on missing
 * file) live in the shared package. opencode's path resolution is kept local
 * because it honors an absolute `$OPENCODE_CONFIG_DIR` override, which the
 * shared `envFilePath(dir, filename)` (home-relative) does not model.
 */
import os from "node:os";
import path from "node:path";
import { loadEnvFile as coreLoadEnvFile, parseEnvFile } from "@pinta-ai/core";

export { parseEnvFile };

function opencodeConfigDir(): string {
  return process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode");
}

export function envFilePath(): string {
  return path.join(opencodeConfigDir(), "pinta-opencode.env");
}

/** Load the env file (if present) and merge only-unset keys into process.env. */
export function loadEnvFile(filePath: string = envFilePath()): void {
  coreLoadEnvFile(filePath);
}
