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
 * Path resolution, parser, and merge semantics all live in the shared package.
 * `envFilePath(dir, filename, overrideEnvVar)` honors an absolute
 * `$OPENCODE_CONFIG_DIR` override as the base dir, falling back to
 * `~/.config/opencode` — byte-identical to opencode's previous local logic.
 */
import { parseEnvFile } from "@pinta-ai/core";
export { parseEnvFile };
export declare function envFilePath(): string;
/** Load the env file (if present) and merge only-unset keys into process.env. */
export declare function loadEnvFile(filePath?: string): void;
