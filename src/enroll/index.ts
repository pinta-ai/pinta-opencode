import path from "node:path";
import type { EnrollApplyResult, EnrollContext, EnrollSource } from "./types.js";
import {
  applyOpencodePlugin,
  removeOpencodePlugin,
  type OpencodePluginInstall,
} from "./opencode-plugin.js";

/**
 * The enroll lifecycle export the pinta-manager sidecar drives. pinta-opencode
 * owns its own registration into opencode (`opencode.json` plugin-array upsert
 * + `pinta-opencode.env`); the sidecar owns only the generic dispatch, record,
 * and audit plumbing.
 */
export const enroll: EnrollSource = {
  id: "pinta-opencode",
  hooks: {
    installType: "opencode-plugin",

    apply(ctx: EnrollContext, install: Record<string, unknown>): Promise<EnrollApplyResult> {
      return applyOpencodePlugin(ctx, install as OpencodePluginInstall);
    },

    remove(ctx: EnrollContext, install: Record<string, unknown>): Promise<EnrollApplyResult> {
      return removeOpencodePlugin(ctx, install as OpencodePluginInstall);
    },

    watchPaths(homeDir: string): string[] {
      return [
        path.join(homeDir, ".config", "opencode", "opencode.json"),
        path.join(homeDir, ".config", "opencode", "pinta-opencode.env"),
      ];
    },
  },
};

export type {
  EnrollSource,
  EnrollContext,
  EnrollApplyResult,
  HookEnrollProvider,
  McpConfigSource,
  McpConfigScope,
  McpDetectContext,
  McpServerEntry,
} from "./types.js";
export type { OpencodePluginInstall } from "./opencode-plugin.js";
