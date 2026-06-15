/**
 * Graceful env-file loader.
 *
 * pinta-opencode can read config from `~/.config/opencode/pinta-opencode.env`
 * (or `$OPENCODE_CONFIG_DIR/pinta-opencode.env`) — `KEY=VALUE` per line. This is
 * the lowest-priority source; plugin options and explicit process.env win.
 *
 * Resolution precedence (highest → lowest): plugin options → process.env →
 * this file (unset keys only). Missing file is a silent no-op.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function opencodeConfigDir(): string {
  return process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode");
}

export function envFilePath(): string {
  return path.join(opencodeConfigDir(), "pinta-opencode.env");
}

export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/** Load the env file (if present) and merge only-unset keys into process.env. */
export function loadEnvFile(filePath: string = envFilePath()): void {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return; // missing/unreadable → no-op
  }
  for (const [key, value] of Object.entries(parseEnvFile(content))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
