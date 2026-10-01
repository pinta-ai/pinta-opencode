import { createRequire as __pintaCreateRequire } from 'module'; const require = __pintaCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@pinta-ai/core/dist/mysql-password.js
var require_mysql_password = __commonJS({
  "node_modules/@pinta-ai/core/dist/mysql-password.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.mysqlPasswordRanges = mysqlPasswordRanges;
    var EXECUTABLES = /* @__PURE__ */ new Set([
      "mysql",
      "mysqldump",
      "mysqladmin",
      "mysqlcheck",
      "mysqlimport",
      "mysqlshow",
      "mariadb",
      "mariadb-dump",
      "mariadb-admin",
      "mariadb-check",
      "mariadb-import",
      "mariadb-show"
    ]);
    var SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "dash", "zsh", "ksh"]);
    var VALUE_OPTIONS = /* @__PURE__ */ new Set([
      "-u",
      "--user",
      "-h",
      "--host",
      "-P",
      "--port",
      "-D",
      "--database",
      "-S",
      "--socket",
      "-e",
      "--execute",
      "--protocol",
      "--default-character-set",
      "--defaults-file",
      "--defaults-extra-file",
      "--login-path",
      "--init-command",
      "--ssl-ca",
      "--ssl-capath",
      "--ssl-cert",
      "--ssl-key",
      "--ssl-cipher"
    ]);
    var MAX_NESTING = 16;
    function slice(text, start, end = text.value.length) {
      return { value: text.value.slice(start, end), ranges: text.ranges.slice(start, end) };
    }
    function append(target, text, start, end) {
      target.value += text.value.slice(start, end);
      for (let index = start; index < end; index++)
        target.ranges.push(text.ranges[index]);
    }
    function executable(word) {
      if (!word?.literal)
        return void 0;
      return word.value.slice(word.value.lastIndexOf("/") + 1).replace(/\.exe$/, "");
    }
    function executionIndex(words) {
      let index = 0;
      for (let wrappers = 0; wrappers <= MAX_NESTING; wrappers++) {
        while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]?.value ?? ""))
          index++;
        const name = executable(words[index]);
        if (!name)
          return void 0;
        if (["!", "if", "then", "elif", "else", "while", "until", "do"].includes(name)) {
          index++;
          continue;
        }
        const optionValues = {
          env: ["-u", "--unset", "-C", "--chdir"],
          sudo: [
            "-u",
            "--user",
            "-g",
            "--group",
            "-p",
            "--prompt",
            "-D",
            "--chdir",
            "-R",
            "--chroot",
            "-C",
            "--close-from",
            "-T",
            "--command-timeout"
          ],
          exec: ["-a"],
          nice: ["-n", "--adjustment"],
          timeout: ["-s", "--signal", "-k", "--kill-after"]
        };
        const flags = {
          env: ["-i", "--ignore-environment", "-0", "--null"],
          sudo: ["-n", "-E", "-H", "-S", "-b", "-k"],
          command: ["-p"],
          exec: ["-c", "-l"],
          nohup: [],
          nice: [],
          time: ["-p"],
          timeout: ["--foreground", "--preserve-status"]
        };
        if (!(name in flags))
          return index;
        index++;
        while (words[index]?.value.startsWith("-")) {
          const option = words[index++].value;
          if (option === "--")
            break;
          if (flags[name].includes(option))
            continue;
          if ((optionValues[name] ?? []).includes(option)) {
            if (!words[index++])
              return void 0;
            continue;
          }
          if ((optionValues[name] ?? []).some((key2) => key2.startsWith("--") ? option.startsWith(key2 + "=") : option.startsWith(key2) && option.length > 2))
            continue;
          if (name === "nice" && /^-\d+$/.test(option))
            continue;
          return void 0;
        }
        if (name === "timeout") {
          if (!/^\d+(?:\.\d+)?[smhd]?$/.test(words[index++]?.value ?? ""))
            return void 0;
        }
      }
      return void 0;
    }
    function substitutionEnd(text, start) {
      let nesting = 1;
      let quote = "";
      for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (char === "\\" && quote !== "'") {
          index++;
          continue;
        }
        if (quote) {
          if (char === quote)
            quote = "";
          continue;
        }
        if (char === "'" || char === '"')
          quote = char;
        else if (char === "(")
          nesting++;
        else if (char === ")" && --nesting === 0)
          return index;
      }
      return text.length;
    }
    function readWord(text, start, out, depth) {
      const word = { value: "", ranges: [], start, end: start, literal: true };
      let quote = "";
      let index = start;
      while (index < text.value.length) {
        const char = text.value[index];
        if (!quote && /[\s;|&()<>{}]/.test(char))
          break;
        if (char === quote) {
          quote = "";
          index++;
          continue;
        }
        if (!quote && (char === "'" || char === '"')) {
          quote = char;
          index++;
          continue;
        }
        if (char === "\\" && quote !== "'") {
          const next = text.value[index + 1];
          if (next === "\n") {
            index += 2;
            continue;
          }
          if (next && (!quote || /[$`"\\]/.test(next))) {
            append(word, text, index + 1, index + 2);
            index += 2;
            continue;
          }
        }
        if (quote !== "'" && text.value.startsWith("$(", index)) {
          const end = substitutionEnd(text.value, index + 2);
          if (text.value[index + 2] !== "(" && depth < MAX_NESTING) {
            scanShell(slice(text, index + 2, end), out, depth + 1);
          }
          append(word, text, index, Math.min(end + 1, text.value.length));
          word.literal = false;
          index = Math.min(end + 1, text.value.length);
          continue;
        }
        if (char === "`" && quote !== "'") {
          let end = index + 1;
          while (end < text.value.length && text.value[end] !== "`") {
            end += text.value[end] === "\\" ? 2 : 1;
          }
          if (depth < MAX_NESTING)
            scanShell(slice(text, index + 1, end), out, depth + 1);
          append(word, text, index, Math.min(end + 1, text.value.length));
          word.literal = false;
          index = Math.min(end + 1, text.value.length);
          continue;
        }
        if (char === "$" && quote !== "'")
          word.literal = false;
        append(word, text, index, index + 1);
        index++;
      }
      word.end = index;
      return word;
    }
    function scanCommand(text, words, out, depth) {
      const index = executionIndex(words);
      if (index === void 0)
        return;
      const name = executable(words[index]);
      if (SHELLS.has(name) && depth < MAX_NESTING) {
        for (let option = index + 1; option < words.length; option++) {
          const value = words[option].value;
          if (value === "--command" || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(value)) {
            const script = words[option + 1];
            if (script)
              scanShell(script, out, depth + 1);
            return;
          }
          if (!value.startsWith("-") || value === "--")
            return;
          if (value === "-o" || value === "-O")
            option++;
        }
        return;
      }
      if (!EXECUTABLES.has(name))
        return;
      for (let option = index + 1; option < words.length; option++) {
        const word = words[option];
        if (word.value === "--")
          return;
        if (VALUE_OPTIONS.has(word.value)) {
          option++;
          continue;
        }
        if (word.value.startsWith("-p") && word.value.length > 2) {
          out.push({ start: text.ranges[word.start].start, end: text.ranges[word.end - 1].end });
        }
      }
    }
    function scanShell(text, out, depth = 0) {
      let words = [];
      let redirect;
      const documents = [];
      let index = 0;
      const flush = () => {
        scanCommand(text, words, out, depth);
        words = [];
        redirect = void 0;
      };
      while (index < text.value.length) {
        const char = text.value[index];
        if (char === "\n") {
          flush();
          index++;
          for (const document of documents.splice(0)) {
            while (index < text.value.length) {
              const end = text.value.indexOf("\n", index);
              const stop = end < 0 ? text.value.length : end;
              const line = text.value.slice(index, stop);
              index = end < 0 ? stop : stop + 1;
              if ((document.stripTabs ? line.replace(/^\t+/, "") : line) === document.delimiter)
                break;
            }
          }
        } else if (/\s/.test(char)) {
          index++;
        } else if (char === "#") {
          const end = text.value.indexOf("\n", index);
          index = end < 0 ? text.value.length : end;
        } else if (text.value.startsWith("((", index)) {
          flush();
          index = Math.min(substitutionEnd(text.value, index + 1) + 1, text.value.length);
        } else if (/[;|&(){}]/.test(char)) {
          flush();
          index++;
        } else if (char === "<" || char === ">") {
          if (words.at(-1)?.end === index && /^\d+$/.test(words.at(-1).value))
            words.pop();
          const match = /^(?:<<<|<<-?|>>|<&|>&|[<>])/.exec(text.value.slice(index));
          redirect = match?.[0] ?? char;
          index += redirect.length;
        } else {
          const word = readWord(text, index, out, depth);
          index = word.end;
          if (redirect === "<<" || redirect === "<<-") {
            documents.push({ delimiter: word.value, stripTabs: redirect === "<<-" });
          }
          if (!redirect)
            words.push(word);
          redirect = void 0;
        }
      }
      flush();
    }
    function jsonString(text, start, end) {
      const result = { value: "", ranges: [] };
      for (let index = start + 1; index < end - 1; index++) {
        if (text.value[index] !== "\\") {
          append(result, text, index, index + 1);
          continue;
        }
        const stop = index + (text.value[index + 1] === "u" ? 6 : 2);
        const decoded = JSON.parse(`"${text.value.slice(index, stop)}"`);
        result.value += decoded;
        for (let unit = 0; unit < decoded.length; unit++) {
          result.ranges.push({ start: text.ranges[index].start, end: text.ranges[stop - 1].end });
        }
        index = stop - 1;
      }
      return result;
    }
    function mysqlPasswordRanges(input) {
      const text = {
        value: input,
        ranges: Array.from({ length: input.length }, (_, index) => ({ start: index, end: index + 1 }))
      };
      const out = [];
      if (/^\s*[{[]/.test(input)) {
        let parsed;
        try {
          parsed = JSON.parse(input);
        } catch {
          scanShell(text, out);
          return out;
        }
        if (parsed !== null && typeof parsed === "object") {
          const strings = /"(?:[^"\\]|\\.)*"/g;
          let match;
          while (match = strings.exec(input)) {
            const key2 = JSON.parse(match[0]);
            if (key2 !== "command" && key2 !== "cmd" && key2 !== "CommandLine")
              continue;
            const separator = /^\s*:\s*/.exec(input.slice(strings.lastIndex));
            if (!separator)
              continue;
            const start = strings.lastIndex + separator[0].length;
            if (input[start] !== '"')
              continue;
            strings.lastIndex = start;
            const value = strings.exec(input);
            if (value?.index === start) {
              scanShell(jsonString(text, start, start + value[0].length), out);
            }
          }
        }
        return out;
      }
      scanShell(text, out);
      return out;
    }
  }
});

// node_modules/@pinta-ai/core/dist/redact.js
var require_redact = __commonJS({
  "node_modules/@pinta-ai/core/dist/redact.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PATTERNS = exports.MAX_BYTES = void 0;
    exports.truncateTo = truncateTo;
    exports.truncate = truncate;
    exports.collectMatches = collectMatches;
    exports.resolveOverlaps = resolveOverlaps;
    exports.applyMatches = applyMatches;
    exports.createDetectedValueMasker = createDetectedValueMasker;
    exports.redact = redact;
    var mysql_password_js_1 = require_mysql_password();
    exports.MAX_BYTES = 102400;
    function truncateTo(input, maxBytes) {
      const buf = Buffer.from(input, "utf-8");
      if (buf.length <= maxBytes)
        return input;
      const head = buf.subarray(0, Math.max(0, maxBytes)).toString("utf-8");
      return `${head}\u2026[TRUNCATED:${buf.length}]`;
    }
    function truncate(input) {
      return truncateTo(input, exports.MAX_BYTES);
    }
    exports.PATTERNS = [
      { type: "aws_access_key", regex: /AKIA[0-9A-Z]{16}/g },
      {
        type: "aws_secret_key",
        // Context word `aws_secret`/`AWS_SECRET` (with optional separator) followed
        // by an assignment-ish character then a 40-char base64-ish blob.
        regex: /(?:aws[_-]?secret(?:[_-]?(?:access)?[_-]?key)?)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
        captureGroup: 1
      },
      {
        type: "gcp_service_account",
        // Whole JSON blob starting with the service-account discriminator.
        regex: /\{[\s\S]{0,200}?"type"\s*:\s*"service_account"[\s\S]*?\}/g
      },
      { type: "github_token", regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
      { type: "gitlab_token", regex: /glpat-[A-Za-z0-9_-]{20}/g },
      { type: "slack_token", regex: /xox[abrsp]-[0-9A-Za-z-]{10,}/g },
      { type: "openai_key", regex: /sk-(?:proj-)?[A-Za-z0-9_-]{40,}/g },
      { type: "anthropic_key", regex: /sk-ant-[A-Za-z0-9_-]{50,}/g },
      { type: "stripe_key", regex: /(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
      {
        type: "jwt",
        regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
      },
      {
        type: "private_key_block",
        regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
      },
      { type: "bearer_token", regex: /bearer\s+([A-Za-z0-9._~+/=-]{12,})/gi, captureGroup: 1 },
      { type: "basic_auth", regex: /basic\s+([A-Za-z0-9+/=]{12,})/gi, captureGroup: 1 },
      {
        type: "db_url_password",
        regex: /\b(?:postgres|postgresql|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:([^@\s]+)@/gi,
        captureGroup: 1
      },
      {
        type: "cli_password_flag",
        regex: /(?:--password|--pass|--pwd)[=\s]([^\s'"]+)/g,
        captureGroup: 1
      },
      {
        type: "cli_password_short",
        // Option shape only. collectMatches also requires a literal mysql-family executable.
        regex: /\s-p([^\s'"]+)/g,
        captureGroup: 1,
        requireContext: "bash"
      },
      {
        type: "env_var_secret",
        // Known false positive: trailing `[A-Z0-9_]*` is greedy, so names like
        // `OPENAI_API_KEY_DESCRIPTION=Used` still match. Acceptable for Bronze.
        regex: /^(?:export\s+)?([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_KEY)[A-Z0-9_]*)\s*=\s*["']?([^\s"'\n]+)/gm,
        captureGroup: 2
      }
    ];
    function collectMatches(input, opts) {
      const out = [];
      for (const pattern of exports.PATTERNS) {
        if (pattern.requireContext && pattern.requireContext !== opts.context)
          continue;
        if (pattern.type === "cli_password_short") {
          for (const { start, end } of (0, mysql_password_js_1.mysqlPasswordRanges)(input)) {
            out.push({
              start,
              end,
              replaceStart: start,
              replaceEnd: end,
              type: pattern.type,
              replacement: `-p[REDACTED:${pattern.type}]`
            });
          }
          continue;
        }
        const re = new RegExp(pattern.regex.source, pattern.regex.flags);
        let m;
        while ((m = re.exec(input)) !== null) {
          const cg = pattern.captureGroup ?? 0;
          const captured = m[cg];
          if (captured === void 0) {
            if (m.index === re.lastIndex)
              re.lastIndex++;
            continue;
          }
          if (/^\[REDACTED(?::[^\]]+)?\]$/i.test(captured))
            continue;
          const start = m.index;
          const end = m.index + m[0].length;
          const replaceStart = start + m[0].indexOf(captured);
          const replaceEnd = replaceStart + captured.length;
          out.push({ start, end, replaceStart, replaceEnd, type: pattern.type });
          if (m.index === re.lastIndex)
            re.lastIndex++;
        }
      }
      return out;
    }
    function resolveOverlaps(matches) {
      const sorted = [...matches].sort((a, b) => a.replaceStart - b.replaceStart || b.replaceEnd - a.replaceEnd);
      const kept = [];
      for (const m of sorted) {
        const previous = kept[kept.length - 1];
        if (previous && m.replaceStart < previous.replaceEnd) {
          previous.replaceEnd = Math.max(previous.replaceEnd, m.replaceEnd);
          previous.start = Math.min(previous.start, m.start);
          previous.end = Math.max(previous.end, m.end);
        } else {
          kept.push({ ...m });
        }
      }
      return kept;
    }
    function applyMatches(input, matches) {
      const sorted = [...matches].sort((a, b) => b.replaceStart - a.replaceStart);
      let out = input;
      for (const m of sorted) {
        out = out.slice(0, m.replaceStart) + (m.replacement ?? `[REDACTED:${m.type}]`) + out.slice(m.replaceEnd);
      }
      return out;
    }
    function createDetectedValueMasker(values) {
      const unique = /* @__PURE__ */ new Map();
      for (const entry of values) {
        if (entry.value.length > 0 && !unique.has(entry.value))
          unique.set(entry.value, entry);
      }
      const replacements = [...unique.values()];
      const escaped = replacements.flatMap((entry) => {
        const value = JSON.stringify(entry.value).slice(1, -1);
        return value === entry.value ? [entry] : [entry, { ...entry, value }];
      });
      const replace = (input, entries) => {
        const ranges = [];
        const markers = [...input.matchAll(/\[(?:PINTA_)?REDACTED(?::[^\]]+)?\]/gi)];
        for (const entry of entries) {
          for (let at = input.indexOf(entry.value); at >= 0; at = input.indexOf(entry.value, at + 1)) {
            if (markers.some((marker) => at >= marker.index && at + entry.value.length <= marker.index + marker[0].length))
              continue;
            ranges.push({
              start: at,
              end: at + entry.value.length,
              replaceStart: at,
              replaceEnd: at + entry.value.length,
              type: entry.type
            });
          }
        }
        return applyMatches(input, resolveOverlaps(ranges));
      };
      const mask = (input) => {
        if (replacements.length === 0)
          return input;
        if (unique.has(input))
          return replace(input, replacements);
        const first = input.trimStart()[0];
        if (first === "{" || first === "[" || first === '"') {
          let json = false;
          try {
            JSON.parse(input);
            json = true;
          } catch (error) {
            if (!(error instanceof SyntaxError))
              throw error;
          }
          if (json) {
            return input.replace(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/gs, (token) => {
              const quoted = token.startsWith('"');
              const decoded = quoted ? JSON.parse(token) : token;
              const masked = quoted ? mask(decoded) : replace(decoded, replacements);
              return masked === decoded ? token : JSON.stringify(masked);
            });
          }
        }
        return replace(input, escaped);
      };
      return mask;
    }
    function redact(input, opts = {}) {
      if (input.length === 0)
        return input;
      const all = collectMatches(input, opts);
      if (all.length === 0)
        return input;
      const kept = resolveOverlaps(all);
      return applyMatches(input, kept);
    }
  }
});

// node_modules/@pinta-ai/core/dist/otlp.js
var require_otlp = __commonJS({
  "node_modules/@pinta-ai/core/dist/otlp.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MAX_SPAN_BYTES = void 0;
    exports.ulidToTraceId = ulidToTraceId2;
    exports.newSpanId = newSpanId;
    exports.snakeCase = snakeCase;
    exports.toOtlpValue = toOtlpValue;
    exports.attrsFromRecord = attrsFromRecord2;
    exports.guardAttrs = guardAttrs;
    exports.clientAttrs = clientAttrs;
    exports.enforceSpanBudget = enforceSpanBudget;
    exports.buildPayload = buildPayload2;
    exports.attachGuard = attachGuard3;
    exports.mergeBatch = mergeBatch2;
    var crypto_1 = __importDefault(__require("crypto"));
    var redact_js_1 = require_redact();
    var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    function ulidToTraceId2(ulid) {
      if (ulid.length !== 26) {
        throw new Error(`ulidToTraceId: expected 26 chars, got ${ulid.length}`);
      }
      let n = 0n;
      for (const ch of ulid) {
        const idx = CROCKFORD.indexOf(ch);
        if (idx < 0)
          throw new Error(`ulidToTraceId: invalid Crockford char "${ch}"`);
        n = n << 5n | BigInt(idx);
      }
      const mask = (1n << 128n) - 1n;
      n &= mask;
      return n.toString(16).padStart(32, "0");
    }
    function newSpanId() {
      return crypto_1.default.randomBytes(8).toString("hex");
    }
    function snakeCase(name) {
      return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase();
    }
    var EMPTY_SET = /* @__PURE__ */ new Set();
    var stringSources = /* @__PURE__ */ new WeakMap();
    var outputSources = /* @__PURE__ */ new WeakMap();
    var payloadMaskers = /* @__PURE__ */ new WeakMap();
    function sourceText(value) {
      if (typeof value === "string")
        return value;
      try {
        return JSON.stringify(value);
      } catch (error) {
        if (!(error instanceof TypeError))
          throw error;
        return String(value);
      }
    }
    function stringValue(key2, raw, policy) {
      const context = (policy.bashContextKeys ?? EMPTY_SET).has(key2) ? "bash" : void 0;
      const matches = (policy.skipRedactKeys ?? EMPTY_SET).has(key2) ? [] : (0, redact_js_1.collectMatches)(raw, { context });
      const value = { stringValue: (0, redact_js_1.truncate)((0, redact_js_1.applyMatches)(raw, (0, redact_js_1.resolveOverlaps)(matches))) };
      stringSources.set(value, {
        original: raw,
        detections: matches.map((match) => ({ value: raw.slice(match.replaceStart, match.replaceEnd), type: match.type }))
      });
      return value;
    }
    function toOtlpValue(key2, v, policy = {}) {
      if (v === null || v === void 0)
        return null;
      let value;
      switch (typeof v) {
        case "string":
          value = stringValue(key2, v, policy);
          break;
        case "boolean":
          value = { boolValue: v };
          break;
        case "number":
          value = Number.isInteger(v) ? { intValue: v } : { doubleValue: v };
          break;
        case "object": {
          value = stringValue(key2, sourceText(v) ?? String(v), policy);
          break;
        }
        default:
          value = stringValue(key2, String(v), policy);
      }
      const outputText = sourceText(policy.outputForKey?.(key2, v));
      if (outputText !== void 0)
        outputSources.set(value, outputText);
      return value;
    }
    function attrsFromRecord2(record2, prefix, policy = {}) {
      const out = [];
      for (const [k, v] of Object.entries(record2)) {
        const key2 = `${prefix}.${k}`;
        const value = toOtlpValue(key2, v, policy);
        if (value === null)
          continue;
        out.push({ key: key2, value });
      }
      return out;
    }
    function guardAttrs(guard) {
      const out = [
        { key: "pinta.guard.decision", value: { stringValue: guard.decision.toLowerCase() } },
        { key: "pinta.guard.duration_ms", value: { intValue: guard.durationMs } }
      ];
      if (guard.reason) {
        out.push({ key: "pinta.guard.matched_rule", value: { stringValue: guard.reason } });
      }
      if (guard.failOpenReason) {
        out.push({ key: "pinta.guard.fail_open_reason", value: { stringValue: guard.failOpenReason } });
      }
      return out;
    }
    function clientAttrs(timing) {
      return [
        {
          key: "pinta.client.rtt_ms",
          value: Number.isInteger(timing.rttMs) ? { intValue: timing.rttMs } : { doubleValue: timing.rttMs }
        },
        { key: "pinta.client.op", value: { stringValue: timing.op } }
      ];
    }
    exports.MAX_SPAN_BYTES = 800 * 1024;
    function byteLen(value) {
      const json = JSON.stringify(value);
      return json === void 0 ? 0 : Buffer.byteLength(json, "utf-8");
    }
    var MIN_ATTR_KEEP_BYTES = 1024;
    function enforceSpanBudget(span, maxBytes = exports.MAX_SPAN_BYTES) {
      let size = byteLen(span);
      for (let pass = 0; pass < 100 && size > maxBytes; pass++) {
        let largestValue = null;
        let largest = 0;
        for (const attr of span.attributes) {
          if (!("stringValue" in attr.value))
            continue;
          const bytes = Buffer.byteLength(attr.value.stringValue, "utf-8");
          if (bytes > largest) {
            largest = bytes;
            largestValue = attr.value;
          }
        }
        if (largestValue === null || largest <= MIN_ATTR_KEEP_BYTES)
          break;
        const overshoot = size - maxBytes;
        const target = Math.max(MIN_ATTR_KEEP_BYTES, largest - overshoot - 64);
        largestValue.stringValue = (0, redact_js_1.truncateTo)(largestValue.stringValue, target);
        size = byteLen(span);
      }
      return span;
    }
    function buildPayload2(args) {
      const ts = args.now ?? Date.now();
      const tsNano = (BigInt(ts) * 1000000n).toString();
      const sources = [...args.resource, ...args.attributes].flatMap((attr) => {
        const source = stringSources.get(attr.value);
        return source ? [source] : [];
      });
      const detected = sources.flatMap((source) => source.detections);
      const outputs = [...args.resource, ...args.attributes].flatMap((attr) => {
        const output = outputSources.get(attr.value);
        return output === void 0 ? [] : [output];
      });
      const outputValues = new Set(detected.filter((entry) => {
        const maskValue = (0, redact_js_1.createDetectedValueMasker)([entry]);
        return outputs.some((text) => maskValue(text) !== text);
      }).map((entry) => entry.value));
      const mask = (0, redact_js_1.createDetectedValueMasker)(detected);
      const attrs = args.attributes.map((attr) => maskAttribute(attr, mask));
      const span = {
        traceId: ulidToTraceId2(args.traceId),
        spanId: newSpanId(),
        name: mask(args.spanName),
        kind: args.spanKind ?? 1,
        startTimeUnixNano: tsNano,
        endTimeUnixNano: tsNano,
        attributes: attrs
      };
      const payload = {
        resourceSpans: [
          {
            resource: { attributes: args.resource.map((attr) => maskAttribute(attr, mask)) },
            scopeSpans: [{
              scope: { name: mask(args.scope.name), version: mask(args.scope.version) },
              spans: [span]
            }]
          }
        ]
      };
      if (detected.length > 0) {
        payloadMaskers.set(payload, mask);
        attrs.push({
          key: "pinta.facts",
          value: { stringValue: JSON.stringify({
            items: [
              { origin: "attributes", values: detected.filter((entry) => !outputValues.has(entry.value)) },
              { origin: "toolOutput", values: detected.filter((entry) => outputValues.has(entry.value)) }
            ].filter((group) => group.values.length > 0).map(({ origin, values }) => ({
              category: "DATA_EXFILTRATION",
              source: "CORE_REDACT",
              path: "$",
              secrets: {
                kinds: ["credential"],
                count: new Set(values.map((entry) => entry.value)).size,
                origins: [origin],
                scannedFields: ["attributes"],
                scanner: "core-tier1",
                truncated: false,
                corroboration: ["pattern"]
              }
            }))
          }) }
        });
      }
      enforceSpanBudget(span);
      return attachGuard3(payload, args.guard, args.clientTiming);
    }
    function maskAttribute(attr, mask) {
      const result = { key: mask(attr.key), value: { ...attr.value } };
      const value = result.value;
      if ("stringValue" in value) {
        const source = stringSources.get(attr.value);
        const masked = mask(source?.original ?? value.stringValue);
        value.stringValue = source ? (0, redact_js_1.truncate)(masked) : masked;
      } else if ("intValue" in value || "doubleValue" in value) {
        const text = String("intValue" in value ? value.intValue : value.doubleValue);
        const masked = mask(text);
        if (masked !== text)
          result.value = { stringValue: masked };
      }
      return result;
    }
    function attachGuard3(payload, guard, clientTiming) {
      const span = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
      if (!span)
        return payload;
      if (guard) {
        const attributes = guardAttrs(guard);
        const mask = payloadMaskers.get(payload);
        span.attributes.push(...mask ? attributes.map((attr) => maskAttribute(attr, mask)) : attributes);
      }
      const timing = clientTiming ?? (guard?.clientRttMs !== void 0 ? { op: "guard", rttMs: guard.clientRttMs } : null);
      if (timing)
        span.attributes.push(...clientAttrs(timing));
      return payload;
    }
    function mergeBatch2(payloads) {
      const out = [];
      for (const p of payloads)
        out.push(...p.resourceSpans);
      return { resourceSpans: out };
    }
  }
});

// node_modules/@pinta-ai/core/dist/guard.js
var require_guard = __commonJS({
  "node_modules/@pinta-ai/core/dist/guard.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.GUARD_STATUS_REFUSED = exports.GUARD_BUDGET_HEADER = void 0;
    exports.evaluateGuard = evaluateGuard2;
    var DEFAULT_TIMEOUT_MS2 = 1e4;
    var DEFAULT_UA = "pinta-core";
    exports.GUARD_BUDGET_HEADER = "x-pinta-guard-budget-ms";
    function failOpen2(clientRttMs, failOpenReason) {
      return {
        decision: "ALLOW",
        reason: null,
        userMessage: null,
        durationMs: clientRttMs,
        clientRttMs,
        failOpenReason
      };
    }
    var VALID_DECISIONS = /* @__PURE__ */ new Set(["ALLOW", "DENY", "REVIEW"]);
    function isFailOpenReason(value) {
      return value === "timeout" || value === "refused" || value === "error";
    }
    exports.GUARD_STATUS_REFUSED = 410;
    async function evaluateGuard2(payload, endpoint, opts = {}) {
      if (!endpoint)
        return null;
      if (opts.disabled)
        return null;
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS2;
      const start = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": opts.userAgent ?? DEFAULT_UA,
            "x-pinta-relay-token": opts.token ?? "",
            // Spread rather than defaulted: an empty string is not "unknown" to the
            // manager, it is a claim that fails validation, and sending one would
            // make every adapter that never sets this look like it tried.
            ...opts.agentType ? { "x-pinta-agent-type": opts.agentType } : {},
            // Same rule: the manager discards a non-positive or non-numeric budget
            // and falls back to its table, so such a value is not sent at all.
            ...Number.isFinite(timeoutMs) && timeoutMs > 0 ? { [exports.GUARD_BUDGET_HEADER]: String(timeoutMs) } : {}
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        if (res.status === exports.GUARD_STATUS_REFUSED) {
          return failOpen2(Date.now() - start, "refused");
        }
        if (res.status !== 200) {
          return failOpen2(Date.now() - start, "error");
        }
        const body = await res.json();
        const durationMsOk = body?.durationMs === void 0 || typeof body.durationMs === "number" && Number.isFinite(body.durationMs);
        if (!body || !VALID_DECISIONS.has(body.decision) || !durationMsOk) {
          return failOpen2(Date.now() - start, "error");
        }
        const failOpenReason = body.decision === "ALLOW" ? body.failOpenReason : void 0;
        if (failOpenReason != null && !isFailOpenReason(failOpenReason))
          return failOpen2(Date.now() - start, "error");
        const clientRttMs = Date.now() - start;
        return {
          decision: body.decision,
          reason: body.reason ?? null,
          userMessage: body.userMessage ?? null,
          durationMs: body.durationMs ?? clientRttMs,
          clientRttMs,
          ...isFailOpenReason(failOpenReason) ? { failOpenReason } : {}
        };
      } catch (err) {
        const name = err.name;
        const reason = name === "AbortError" || name === "TimeoutError" ? "timeout" : "error";
        return failOpen2(Date.now() - start, reason);
      } finally {
        clearTimeout(timer);
      }
    }
  }
});

// node_modules/@pinta-ai/core/dist/atomic-write.js
var require_atomic_write = __commonJS({
  "node_modules/@pinta-ai/core/dist/atomic-write.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.atomicWriteFileSync = atomicWriteFileSync;
    var fs_1 = __importDefault(__require("fs"));
    function atomicWriteFileSync(finalPath, data) {
      const tmpPath = `${finalPath}.${process.pid}.tmp`;
      fs_1.default.writeFileSync(tmpPath, data);
      fs_1.default.renameSync(tmpPath, finalPath);
    }
  }
});

// node_modules/@pinta-ai/core/dist/retry-queue.js
var require_retry_queue = __commonJS({
  "node_modules/@pinta-ai/core/dist/retry-queue.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MemoryRetryQueue = exports.DiskRetryQueue = void 0;
    var fs_1 = __importDefault(__require("fs"));
    var path_1 = __importDefault(__require("path"));
    var atomic_write_js_1 = require_atomic_write();
    var MAX_ENTRIES = 1e3;
    var LOCK_TIMEOUT_MS = 50;
    var LOCK_POLL_MS = 5;
    var DiskRetryQueue = class {
      filePath;
      lockPath;
      logPrefix;
      constructor(pluginData, logPrefix) {
        this.filePath = path_1.default.join(pluginData, "failed-spans.jsonl");
        this.lockPath = this.filePath + ".lock";
        this.logPrefix = logPrefix;
      }
      /** Append a single payload. Best-effort: any IO error is swallowed (logged to stderr). */
      enqueue(payload) {
        try {
          fs_1.default.mkdirSync(path_1.default.dirname(this.filePath), { recursive: true });
          const line = JSON.stringify({ savedAt: (/* @__PURE__ */ new Date()).toISOString(), payload }) + "\n";
          fs_1.default.appendFileSync(this.filePath, line);
          this.trim();
        } catch (err) {
          process.stderr.write(`[${this.logPrefix}] retry-queue enqueue failed: ${err}
`);
        }
      }
      /**
       * Read all entries oldest-first. Returns [] if the file does not exist or is unreadable.
       * Does NOT delete the file — callers handle persistence via `rewrite`.
       */
      readAll() {
        try {
          const raw = fs_1.default.readFileSync(this.filePath, "utf-8");
          const out = [];
          for (const line of raw.split("\n")) {
            if (!line.trim())
              continue;
            try {
              const parsed = JSON.parse(line);
              if (Array.isArray(parsed?.payload?.resourceSpans)) {
                out.push(parsed);
              }
            } catch {
            }
          }
          return out;
        } catch {
          return [];
        }
      }
      /** Replace the queue with the given entries (or delete the file when empty). */
      rewrite(entries) {
        try {
          if (entries.length === 0) {
            if (fs_1.default.existsSync(this.filePath))
              fs_1.default.unlinkSync(this.filePath);
            return;
          }
          fs_1.default.mkdirSync(path_1.default.dirname(this.filePath), { recursive: true });
          (0, atomic_write_js_1.atomicWriteFileSync)(this.filePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
        } catch (err) {
          process.stderr.write(`[${this.logPrefix}] retry-queue rewrite failed: ${err}
`);
        }
      }
      /**
       * Try to acquire the lock for ~LOCK_TIMEOUT_MS. Returns true on success.
       * Caller MUST call `release()` if true is returned.
       */
      tryAcquireLock() {
        const start = Date.now();
        try {
          fs_1.default.mkdirSync(path_1.default.dirname(this.lockPath), { recursive: true });
        } catch (err) {
          process.stderr.write(`[${this.logPrefix}] retry-queue lock mkdir failed: ${err}
`);
          return false;
        }
        while (Date.now() - start < LOCK_TIMEOUT_MS) {
          try {
            const fd = fs_1.default.openSync(this.lockPath, "wx");
            fs_1.default.writeSync(fd, String(process.pid));
            fs_1.default.closeSync(fd);
            return true;
          } catch (err) {
            if (err?.code !== "EEXIST") {
              process.stderr.write(`[${this.logPrefix}] retry-queue lock open failed: ${err}
`);
              return false;
            }
            try {
              const st = fs_1.default.statSync(this.lockPath);
              if (Date.now() - st.mtimeMs > 3e4) {
                fs_1.default.unlinkSync(this.lockPath);
                continue;
              }
            } catch {
            }
            const wait = LOCK_POLL_MS;
            const end = Date.now() + wait;
            while (Date.now() < end) {
            }
          }
        }
        return false;
      }
      release() {
        try {
          fs_1.default.unlinkSync(this.lockPath);
        } catch {
        }
      }
      trim() {
        const entries = this.readAll();
        if (entries.length <= MAX_ENTRIES)
          return;
        const drop = entries.length - MAX_ENTRIES;
        process.stderr.write(`[${this.logPrefix}] retry-queue full, dropping ${drop} oldest entries
`);
        this.rewrite(entries.slice(drop));
      }
    };
    exports.DiskRetryQueue = DiskRetryQueue;
    var MemoryRetryQueue2 = class {
      entries = [];
      enqueue(payload) {
        this.entries.push(payload);
        if (this.entries.length > MAX_ENTRIES) {
          this.entries.splice(0, this.entries.length - MAX_ENTRIES);
        }
      }
      /** Remove and return all buffered payloads. */
      drain() {
        const out = this.entries;
        this.entries = [];
        return out;
      }
      get size() {
        return this.entries.length;
      }
    };
    exports.MemoryRetryQueue = MemoryRetryQueue2;
  }
});

// node_modules/@pinta-ai/core/dist/transport.js
var require_transport = __commonJS({
  "node_modules/@pinta-ai/core/dist/transport.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MemoryTransport = exports.DiskTransport = exports.MAX_POST_BYTES = void 0;
    exports.parseHeadersEnv = parseHeadersEnv2;
    exports.envOptionsResolver = envOptionsResolver;
    exports.postOtlp = postOtlp;
    var retry_queue_js_1 = require_retry_queue();
    var otlp_js_1 = require_otlp();
    var TIMEOUT_MS = 5e3;
    exports.MAX_POST_BYTES = 900 * 1024;
    function payloadBytes(payload) {
      const json = JSON.stringify(payload);
      return json === void 0 ? 0 : Buffer.byteLength(json, "utf-8");
    }
    function chunkByBytes(items, sizeOf, maxBytes) {
      const chunks = [];
      const oversize = [];
      let current = [];
      let currentBytes = 0;
      for (const item of items) {
        const bytes = sizeOf(item);
        if (bytes > maxBytes) {
          oversize.push(item);
          continue;
        }
        if (current.length > 0 && currentBytes + bytes > maxBytes) {
          chunks.push(current);
          current = [];
          currentBytes = 0;
        }
        current.push(item);
        currentBytes += bytes;
      }
      if (current.length > 0)
        chunks.push(current);
      return { chunks, oversize };
    }
    function parseHeadersEnv2(raw) {
      if (!raw)
        return {};
      if (typeof raw === "object")
        return { ...raw };
      const out = {};
      for (const pair of raw.split(",")) {
        const [k, ...rest] = pair.split("=");
        if (k && rest.length > 0)
          out[k.trim()] = rest.join("=").trim();
      }
      return out;
    }
    function envOptionsResolver() {
      const tracesEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
      const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      let endpoint;
      if (tracesEndpoint) {
        endpoint = tracesEndpoint.replace(/\/+$/, "");
      } else if (baseEndpoint) {
        endpoint = baseEndpoint.replace(/\/+$/, "") + "/v1/traces";
      }
      if (!endpoint)
        return null;
      return {
        endpoint,
        headers: parseHeadersEnv2(process.env.OTEL_EXPORTER_OTLP_HEADERS)
      };
    }
    async function postOtlp(payload, opts, logPrefix) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(opts.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...opts.headers },
          body: JSON.stringify(payload),
          signal: ctrl.signal
        });
        if (!res.ok) {
          let body = "";
          try {
            body = (await res.text()).slice(0, 200);
          } catch {
          }
          const hint = res.status === 401 || res.status === 403 ? " \u2014 check OTEL_EXPORTER_OTLP_HEADERS (relay token)" : res.status === 404 ? " \u2014 check OTEL_EXPORTER_OTLP_TRACES_ENDPOINT path" : res.status >= 500 ? " \u2014 collector may be down" : "";
          process.stderr.write(`[${logPrefix}] OTLP POST ${res.status} ${opts.endpoint}${hint}${body ? ` body=${body}` : ""}
`);
          return false;
        }
        return true;
      } catch (err) {
        process.stderr.write(`[${logPrefix}] OTLP POST failed: ${err.message ?? String(err)}
`);
        return false;
      } finally {
        clearTimeout(timer);
      }
    }
    var DiskTransport = class {
      queue;
      logPrefix;
      resolveOptions;
      constructor(opts) {
        this.queue = new retry_queue_js_1.DiskRetryQueue(opts.pluginData, opts.logPrefix);
        this.logPrefix = opts.logPrefix;
        this.resolveOptions = opts.resolveOptions ?? envOptionsResolver;
      }
      async send(payload) {
        const opts = this.resolveOptions();
        if (!opts)
          return;
        if (this.dropIfOversized(payload))
          return;
        const ok = await postOtlp(payload, opts, this.logPrefix);
        if (!ok)
          this.queue.enqueue(payload);
      }
      /**
       * Drain the backlog in POST-budget-sized chunks. On a mid-flush failure the
       * unsent tail stays queued for the next flush — earlier chunks that already
       * landed are not re-sent (at-most-once per flush attempt, unchanged from the
       * pre-chunking behavior where the whole batch either landed or stayed).
       */
      async flush() {
        const opts = this.resolveOptions();
        if (!opts)
          return;
        if (!this.queue.tryAcquireLock())
          return;
        try {
          const entries = this.queue.readAll();
          if (entries.length === 0)
            return;
          const { chunks, oversize } = chunkByBytes(entries, (e) => payloadBytes(e.payload), exports.MAX_POST_BYTES);
          if (oversize.length > 0) {
            process.stderr.write(`[${this.logPrefix}] dropping ${oversize.length} oversized retry ${oversize.length === 1 ? "entry" : "entries"} (each > ${exports.MAX_POST_BYTES} bytes \u2014 the backend caps the request body, so they can never be delivered)
`);
          }
          const ordered = [].concat(...chunks);
          let sent = 0;
          for (const chunk of chunks) {
            const ok = await postOtlp((0, otlp_js_1.mergeBatch)(chunk.map((e) => e.payload)), opts, this.logPrefix);
            if (!ok)
              break;
            sent += chunk.length;
          }
          this.queue.rewrite(ordered.slice(sent));
        } catch (err) {
          process.stderr.write(`[${this.logPrefix}] flush failed: ${err?.message ?? String(err)}
`);
        } finally {
          this.queue.release();
        }
      }
      /** True (and logged) when the payload alone exceeds the POST budget. */
      dropIfOversized(payload) {
        const bytes = payloadBytes(payload);
        if (bytes <= exports.MAX_POST_BYTES)
          return false;
        process.stderr.write(`[${this.logPrefix}] dropping oversized span payload (${bytes} > ${exports.MAX_POST_BYTES} bytes) \u2014 undeliverable, not queued
`);
        return true;
      }
    };
    exports.DiskTransport = DiskTransport;
    var MemoryTransport2 = class {
      queue = new retry_queue_js_1.MemoryRetryQueue();
      logPrefix;
      resolveOptions;
      constructor(opts) {
        this.logPrefix = opts.logPrefix;
        this.resolveOptions = opts.resolveOptions;
      }
      async send(payload) {
        const opts = this.resolveOptions();
        if (!opts)
          return;
        if (payloadBytes(payload) > exports.MAX_POST_BYTES) {
          process.stderr.write(`[${this.logPrefix}] dropping oversized span payload (> ${exports.MAX_POST_BYTES} bytes) \u2014 undeliverable, not buffered
`);
          return;
        }
        const ok = await postOtlp(payload, opts, this.logPrefix);
        if (!ok)
          this.queue.enqueue(payload);
      }
      /** Chunked drain — see DiskTransport.flush; the unsent tail is re-buffered. */
      async flush() {
        const opts = this.resolveOptions();
        if (!opts)
          return;
        const buffered = this.queue.drain();
        if (buffered.length === 0)
          return;
        const { chunks, oversize } = chunkByBytes(buffered, payloadBytes, exports.MAX_POST_BYTES);
        if (oversize.length > 0) {
          process.stderr.write(`[${this.logPrefix}] dropping ${oversize.length} oversized buffered ${oversize.length === 1 ? "payload" : "payloads"} (each > ${exports.MAX_POST_BYTES} bytes \u2014 undeliverable)
`);
        }
        const ordered = [].concat(...chunks);
        let sent = 0;
        for (const chunk of chunks) {
          const ok = await postOtlp((0, otlp_js_1.mergeBatch)(chunk), opts, this.logPrefix);
          if (!ok)
            break;
          sent += chunk.length;
        }
        for (const p of ordered.slice(sent))
          this.queue.enqueue(p);
      }
    };
    exports.MemoryTransport = MemoryTransport2;
  }
});

// node_modules/@pinta-ai/core/dist/trace.js
var require_trace = __commonJS({
  "node_modules/@pinta-ai/core/dist/trace.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.TraceManager = void 0;
    exports.generateUlid = generateUlid;
    var fs_1 = __importDefault(__require("fs"));
    var path_1 = __importDefault(__require("path"));
    var crypto_1 = __importDefault(__require("crypto"));
    var atomic_write_js_1 = require_atomic_write();
    var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    function generateUlid() {
      const now = Date.now();
      let ts = "";
      let t = now;
      for (let i = 0; i < 10; i++) {
        ts = CROCKFORD[t & 31] + ts;
        t = Math.floor(t / 32);
      }
      const rand = crypto_1.default.randomBytes(10);
      let r = "";
      for (let i = 0; i < 10; i++) {
        r += CROCKFORD[rand[i] & 31];
      }
      while (r.length < 16)
        r += CROCKFORD[0];
      return ts + r;
    }
    var TraceManager = class {
      tracePath;
      constructor(tracePath) {
        this.tracePath = tracePath;
      }
      /** Generate and persist a fresh trace id (e.g. on UserPromptSubmit). */
      newTrace() {
        const traceId = generateUlid();
        this.save(traceId);
        return traceId;
      }
      /** Return the current trace id, generating one if no trace file exists. */
      currentTrace() {
        try {
          const data = fs_1.default.readFileSync(this.tracePath, "utf-8");
          const { traceId } = JSON.parse(data);
          if (traceId)
            return traceId;
        } catch {
        }
        return this.newTrace();
      }
      save(traceId) {
        try {
          fs_1.default.mkdirSync(path_1.default.dirname(this.tracePath), { recursive: true });
          (0, atomic_write_js_1.atomicWriteFileSync)(this.tracePath, JSON.stringify({ traceId }));
        } catch (err) {
          process.stderr.write(`[pinta-core] trace persistence failed: ${err}
`);
        }
      }
    };
    exports.TraceManager = TraceManager;
  }
});

// node_modules/@pinta-ai/core/dist/session-trace.js
var require_session_trace = __commonJS({
  "node_modules/@pinta-ai/core/dist/session-trace.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MemorySessionTraceManager = exports.DiskSessionTraceManager = void 0;
    var fs_1 = __importDefault(__require("fs"));
    var path_1 = __importDefault(__require("path"));
    var trace_js_1 = require_trace();
    var atomic_write_js_1 = require_atomic_write();
    var DEFAULT_MAX_SESSIONS = 200;
    var DiskSessionTraceManager = class {
      tracePath;
      maxSessions;
      constructor(tracePath, opts = {}) {
        this.tracePath = tracePath;
        this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
      }
      read() {
        try {
          const data = JSON.parse(fs_1.default.readFileSync(this.tracePath, "utf-8"));
          if (data && typeof data === "object" && !("traceId" in data)) {
            return data;
          }
        } catch {
        }
        return {};
      }
      write(map) {
        try {
          fs_1.default.mkdirSync(path_1.default.dirname(this.tracePath), { recursive: true });
          const entries = Object.entries(map);
          const capped = entries.length > this.maxSessions ? Object.fromEntries(entries.slice(-this.maxSessions)) : map;
          (0, atomic_write_js_1.atomicWriteFileSync)(this.tracePath, JSON.stringify(capped));
        } catch {
        }
      }
      newTrace(sessionId) {
        const key2 = sessionId || "default";
        const traceId = (0, trace_js_1.generateUlid)();
        const map = this.read();
        map[key2] = traceId;
        this.write(map);
        return traceId;
      }
      currentTrace(sessionId) {
        const key2 = sessionId || "default";
        const existing = this.read()[key2];
        if (existing)
          return existing;
        return this.newTrace(key2);
      }
    };
    exports.DiskSessionTraceManager = DiskSessionTraceManager;
    var MemorySessionTraceManager2 = class {
      map = /* @__PURE__ */ new Map();
      maxSessions;
      constructor(opts = {}) {
        this.maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
      }
      newTrace(sessionId) {
        const key2 = sessionId || "default";
        const traceId = (0, trace_js_1.generateUlid)();
        this.map.set(key2, traceId);
        if (this.map.size > this.maxSessions) {
          const oldest = this.map.keys().next().value;
          if (oldest !== void 0)
            this.map.delete(oldest);
        }
        return traceId;
      }
      currentTrace(sessionId) {
        const key2 = sessionId || "default";
        return this.map.get(key2) ?? this.newTrace(key2);
      }
    };
    exports.MemorySessionTraceManager = MemorySessionTraceManager2;
  }
});

// node_modules/@pinta-ai/core/dist/env-file.js
var require_env_file = __commonJS({
  "node_modules/@pinta-ai/core/dist/env-file.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.envFilePath = envFilePath2;
    exports.parseEnvFile = parseEnvFile2;
    exports.loadEnvFile = loadEnvFile2;
    var node_fs_1 = __importDefault(__require("node:fs"));
    var node_os_1 = __importDefault(__require("node:os"));
    var node_path_1 = __importDefault(__require("node:path"));
    function envFilePath2(dir, filename, overrideEnvVar) {
      const override = overrideEnvVar ? process.env[overrideEnvVar] : void 0;
      const base = override && override.length > 0 ? override : node_path_1.default.join(node_os_1.default.homedir(), dir);
      return node_path_1.default.join(base, filename);
    }
    function parseEnvFile2(content) {
      const out = {};
      for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
          continue;
        const idx = line.indexOf("=");
        if (idx < 0)
          continue;
        const key2 = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        if (key2)
          out[key2] = value;
      }
      return out;
    }
    function loadEnvFile2(filePath) {
      let content;
      try {
        content = node_fs_1.default.readFileSync(filePath, "utf-8");
      } catch {
        return;
      }
      const parsed = parseEnvFile2(content);
      for (const [key2, value] of Object.entries(parsed)) {
        if (process.env[key2] === void 0) {
          process.env[key2] = value;
        }
      }
    }
  }
});

// node_modules/@pinta-ai/core/dist/index.js
var require_dist = __commonJS({
  "node_modules/@pinta-ai/core/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.loadEnvFile = exports.parseEnvFile = exports.envFilePath = exports.MemorySessionTraceManager = exports.DiskSessionTraceManager = exports.generateUlid = exports.TraceManager = exports.MAX_POST_BYTES = exports.parseHeadersEnv = exports.envOptionsResolver = exports.postOtlp = exports.MemoryTransport = exports.DiskTransport = exports.MemoryRetryQueue = exports.DiskRetryQueue = exports.GUARD_BUDGET_HEADER = exports.GUARD_STATUS_REFUSED = exports.evaluateGuard = exports.MAX_SPAN_BYTES = exports.enforceSpanBudget = exports.mergeBatch = exports.attachGuard = exports.buildPayload = exports.clientAttrs = exports.guardAttrs = exports.attrsFromRecord = exports.toOtlpValue = exports.snakeCase = exports.newSpanId = exports.ulidToTraceId = exports.MAX_BYTES = exports.PATTERNS = exports.applyMatches = exports.resolveOverlaps = exports.collectMatches = exports.truncateTo = exports.truncate = exports.redact = void 0;
    var redact_js_1 = require_redact();
    Object.defineProperty(exports, "redact", { enumerable: true, get: function() {
      return redact_js_1.redact;
    } });
    Object.defineProperty(exports, "truncate", { enumerable: true, get: function() {
      return redact_js_1.truncate;
    } });
    Object.defineProperty(exports, "truncateTo", { enumerable: true, get: function() {
      return redact_js_1.truncateTo;
    } });
    Object.defineProperty(exports, "collectMatches", { enumerable: true, get: function() {
      return redact_js_1.collectMatches;
    } });
    Object.defineProperty(exports, "resolveOverlaps", { enumerable: true, get: function() {
      return redact_js_1.resolveOverlaps;
    } });
    Object.defineProperty(exports, "applyMatches", { enumerable: true, get: function() {
      return redact_js_1.applyMatches;
    } });
    Object.defineProperty(exports, "PATTERNS", { enumerable: true, get: function() {
      return redact_js_1.PATTERNS;
    } });
    Object.defineProperty(exports, "MAX_BYTES", { enumerable: true, get: function() {
      return redact_js_1.MAX_BYTES;
    } });
    var otlp_js_1 = require_otlp();
    Object.defineProperty(exports, "ulidToTraceId", { enumerable: true, get: function() {
      return otlp_js_1.ulidToTraceId;
    } });
    Object.defineProperty(exports, "newSpanId", { enumerable: true, get: function() {
      return otlp_js_1.newSpanId;
    } });
    Object.defineProperty(exports, "snakeCase", { enumerable: true, get: function() {
      return otlp_js_1.snakeCase;
    } });
    Object.defineProperty(exports, "toOtlpValue", { enumerable: true, get: function() {
      return otlp_js_1.toOtlpValue;
    } });
    Object.defineProperty(exports, "attrsFromRecord", { enumerable: true, get: function() {
      return otlp_js_1.attrsFromRecord;
    } });
    Object.defineProperty(exports, "guardAttrs", { enumerable: true, get: function() {
      return otlp_js_1.guardAttrs;
    } });
    Object.defineProperty(exports, "clientAttrs", { enumerable: true, get: function() {
      return otlp_js_1.clientAttrs;
    } });
    Object.defineProperty(exports, "buildPayload", { enumerable: true, get: function() {
      return otlp_js_1.buildPayload;
    } });
    Object.defineProperty(exports, "attachGuard", { enumerable: true, get: function() {
      return otlp_js_1.attachGuard;
    } });
    Object.defineProperty(exports, "mergeBatch", { enumerable: true, get: function() {
      return otlp_js_1.mergeBatch;
    } });
    Object.defineProperty(exports, "enforceSpanBudget", { enumerable: true, get: function() {
      return otlp_js_1.enforceSpanBudget;
    } });
    Object.defineProperty(exports, "MAX_SPAN_BYTES", { enumerable: true, get: function() {
      return otlp_js_1.MAX_SPAN_BYTES;
    } });
    var guard_js_1 = require_guard();
    Object.defineProperty(exports, "evaluateGuard", { enumerable: true, get: function() {
      return guard_js_1.evaluateGuard;
    } });
    Object.defineProperty(exports, "GUARD_STATUS_REFUSED", { enumerable: true, get: function() {
      return guard_js_1.GUARD_STATUS_REFUSED;
    } });
    Object.defineProperty(exports, "GUARD_BUDGET_HEADER", { enumerable: true, get: function() {
      return guard_js_1.GUARD_BUDGET_HEADER;
    } });
    var retry_queue_js_1 = require_retry_queue();
    Object.defineProperty(exports, "DiskRetryQueue", { enumerable: true, get: function() {
      return retry_queue_js_1.DiskRetryQueue;
    } });
    Object.defineProperty(exports, "MemoryRetryQueue", { enumerable: true, get: function() {
      return retry_queue_js_1.MemoryRetryQueue;
    } });
    var transport_js_1 = require_transport();
    Object.defineProperty(exports, "DiskTransport", { enumerable: true, get: function() {
      return transport_js_1.DiskTransport;
    } });
    Object.defineProperty(exports, "MemoryTransport", { enumerable: true, get: function() {
      return transport_js_1.MemoryTransport;
    } });
    Object.defineProperty(exports, "postOtlp", { enumerable: true, get: function() {
      return transport_js_1.postOtlp;
    } });
    Object.defineProperty(exports, "envOptionsResolver", { enumerable: true, get: function() {
      return transport_js_1.envOptionsResolver;
    } });
    Object.defineProperty(exports, "parseHeadersEnv", { enumerable: true, get: function() {
      return transport_js_1.parseHeadersEnv;
    } });
    Object.defineProperty(exports, "MAX_POST_BYTES", { enumerable: true, get: function() {
      return transport_js_1.MAX_POST_BYTES;
    } });
    var trace_js_1 = require_trace();
    Object.defineProperty(exports, "TraceManager", { enumerable: true, get: function() {
      return trace_js_1.TraceManager;
    } });
    Object.defineProperty(exports, "generateUlid", { enumerable: true, get: function() {
      return trace_js_1.generateUlid;
    } });
    var session_trace_js_1 = require_session_trace();
    Object.defineProperty(exports, "DiskSessionTraceManager", { enumerable: true, get: function() {
      return session_trace_js_1.DiskSessionTraceManager;
    } });
    Object.defineProperty(exports, "MemorySessionTraceManager", { enumerable: true, get: function() {
      return session_trace_js_1.MemorySessionTraceManager;
    } });
    var env_file_js_1 = require_env_file();
    Object.defineProperty(exports, "envFilePath", { enumerable: true, get: function() {
      return env_file_js_1.envFilePath;
    } });
    Object.defineProperty(exports, "parseEnvFile", { enumerable: true, get: function() {
      return env_file_js_1.parseEnvFile;
    } });
    Object.defineProperty(exports, "loadEnvFile", { enumerable: true, get: function() {
      return env_file_js_1.loadEnvFile;
    } });
  }
});

// src/config.ts
var import_core2 = __toESM(require_dist(), 1);
import fs from "node:fs";
import path from "node:path";

// src/env-file.ts
var import_core = __toESM(require_dist(), 1);
function envFilePath() {
  return (0, import_core.envFilePath)(".config/opencode", "pinta-opencode.env", "OPENCODE_CONFIG_DIR");
}
function loadEnvFile(filePath = envFilePath()) {
  (0, import_core.loadEnvFile)(filePath);
}

// src/config.ts
function firstSet(...vals) {
  return vals.find((v) => v) || void 0;
}
function resolveEndpoint(options) {
  const full = firstSet(
    options.endpoint,
    process.env.PINTA_OPENCODE_ENDPOINT,
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  );
  if (full) return full.replace(/\/+$/, "");
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base) return base.replace(/\/+$/, "") + "/v1/traces";
  return void 0;
}
var OPENCODE_PACKAGE_NAME = "opencode-ai";
function versionFromExecPath() {
  let dir = path.dirname(process.execPath);
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.name === OPENCODE_PACKAGE_NAME && typeof pkg.version === "string" && pkg.version) {
        return pkg.version;
      }
    } catch {
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return void 0;
}
function resolveServiceVersion() {
  const explicit = process.env.OPENCODE_VERSION?.trim();
  if (explicit) return explicit;
  return versionFromExecPath();
}
function resolveConfig(options = {}) {
  loadEnvFile();
  const relayToken = firstSet(options.token, process.env.PINTA_OPENCODE_TOKEN);
  const headers = (0, import_core2.parseHeadersEnv)(
    options.headers ?? process.env.PINTA_OPENCODE_HEADERS ?? process.env.OTEL_EXPORTER_OTLP_HEADERS
  );
  if (relayToken && !Object.keys(headers).some((k) => k.toLowerCase() === "x-pinta-relay-token")) {
    headers["x-pinta-relay-token"] = relayToken;
  }
  const guardTimeoutMs = options.guardTimeoutMs ?? (Number(process.env.PINTA_OPENCODE_GUARD_TIMEOUT_MS) || 100);
  return {
    endpoint: resolveEndpoint(options),
    headers,
    guardEndpoint: firstSet(options.guard, process.env.PINTA_OPENCODE_GUARD),
    relayToken,
    guardTimeoutMs,
    guardDisabled: process.env.PINTA_OPENCODE_GUARD_DISABLED === "1",
    serviceVersion: resolveServiceVersion()
  };
}

// src/core/transport.ts
var import_core3 = __toESM(require_dist(), 1);
var Transport = class extends import_core3.MemoryTransport {
  constructor(config) {
    super({
      logPrefix: "pinta-opencode",
      resolveOptions: () => config.endpoint ? { endpoint: config.endpoint, headers: config.headers } : null
    });
    this.config = config;
  }
  deferred = new import_core3.MemoryRetryQueue();
  /** A decided DENY must return to the host without collector IO. */
  defer(payload) {
    if (!this.config.endpoint) return;
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (bytes > import_core3.MAX_POST_BYTES) {
      process.stderr.write(`[pinta-opencode] deferred payload exceeds POST budget (${bytes} bytes); dropped
`);
      return;
    }
    this.deferred.enqueue(payload);
  }
  async flush() {
    await super.flush();
    for (const payload of this.deferred.drain()) await super.send(payload);
  }
};

// src/core/trace.ts
var import_core4 = __toESM(require_dist(), 1);

// src/plugin.ts
var import_core8 = __toESM(require_dist(), 1);

// src/core/guard.ts
var import_core5 = __toESM(require_dist(), 1);

// src/core/version.ts
var ADAPTER_VERSION = "0.11.3-skax.0";

// src/core/guard.ts
var DEFAULT_TIMEOUT_MS = 100;
var GUARD_UA = `pinta-opencode/${ADAPTER_VERSION}`;
function evaluateGuard(payload, endpoint, opts = {}) {
  return (0, import_core5.evaluateGuard)(payload, endpoint, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    token: opts.token,
    disabled: opts.disabled,
    userAgent: GUARD_UA
  });
}

// src/telemetry.ts
var import_core7 = __toESM(require_dist(), 1);

// src/core/otlp.ts
import os from "os";
var import_core6 = __toESM(require_dist(), 1);
var cachedProcessOwner;
function processOwner() {
  if (cachedProcessOwner === void 0) {
    try {
      cachedProcessOwner = os.userInfo().username;
    } catch {
      cachedProcessOwner = process.env.USER ?? process.env.LOGNAME ?? (typeof process.getuid === "function" ? String(process.getuid()) : "unknown");
    }
  }
  return cachedProcessOwner;
}
var SDK_VERSION = ADAPTER_VERSION;
var SKIP_REDACT_KEYS = /* @__PURE__ */ new Set([
  "opencode.hook",
  "opencode.event_type",
  "opencode.tool_name",
  "opencode.session_id",
  "opencode.sessionID",
  "opencode.tool_use_id",
  "opencode.cwd",
  "opencode.agent",
  "opencode.model",
  "opencode.exit",
  "opencode.truncated",
  "opencode.title"
]);
var BASH_CONTEXT_KEYS = /* @__PURE__ */ new Set([
  "opencode.tool_input",
  "opencode.tool_response"
]);
var ATTR_POLICY = {
  skipRedactKeys: SKIP_REDACT_KEYS,
  bashContextKeys: BASH_CONTEXT_KEYS,
  outputForKey: (key2, value) => {
    if (key2 === "opencode.error" || key2 === "opencode.error_message") return value;
    if (!["opencode.tool_response", "opencode.tool_result", "opencode.output"].includes(key2)) return void 0;
    return value && typeof value === "object" && "output" in value && value.output !== void 0 ? value.output : value;
  }
};
function flattenFields(fields) {
  const out = [{ key: "ingest.type", value: { stringValue: "opencode" } }];
  out.push(...(0, import_core6.attrsFromRecord)(fields, "opencode", ATTR_POLICY));
  return out;
}
function resourceAttrs(serviceVersion) {
  return [
    { key: "service.name", value: { stringValue: "opencode" } },
    // Omitted when unresolved — the absence is the honest signal, not "unknown".
    // A placeholder is indistinguishable from a real value downstream (PTA-347).
    ...serviceVersion ? [{ key: "service.version", value: { stringValue: serviceVersion } }] : [],
    { key: "telemetry.sdk.name", value: { stringValue: "pinta-opencode" } },
    { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
    { key: "telemetry.sdk.version", value: { stringValue: SDK_VERSION } },
    { key: "process.pid", value: { intValue: process.pid } },
    { key: "process.owner", value: { stringValue: processOwner() } },
    { key: "host.name", value: { stringValue: os.hostname() } },
    { key: "host.arch", value: { stringValue: os.arch() } }
  ];
}
function buildOtlpPayload(args) {
  return (0, import_core6.buildPayload)({
    traceId: args.traceId,
    spanName: args.name,
    attributes: flattenFields(args.fields),
    resource: resourceAttrs(args.serviceVersion),
    scope: { name: "pinta-opencode", version: SDK_VERSION },
    now: args.now
  });
}

// src/model.ts
var MODEL_CACHE_LIMITS = {
  messages: 1024,
  requests: 512,
  calls: 2048,
  endedSessions: 128,
  ttlMs: 15 * 60 * 1e3
};
var PLACEHOLDERS = /* @__PURE__ */ new Set([
  "unknown",
  "undefined",
  "null",
  "n/a",
  "none",
  "-",
  "auto",
  "default"
]);
function identifier(value) {
  if (typeof value !== "string") return void 0;
  const text = value.trim();
  return text && text.length <= 1024 ? text : void 0;
}
function modelId(value) {
  const id = identifier(value);
  if (!id || id.startsWith("{") || id.startsWith("[") || PLACEHOLDERS.has(id.toLowerCase())) return void 0;
  return id;
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function fromModel(value, source, provider) {
  const obj = record(value);
  const model = obj ? modelId(obj.modelID) ?? modelId(obj.id) : modelId(value);
  if (!model) return void 0;
  return {
    model,
    source: obj ? `${source}.${modelId(obj.modelID) ? "modelID" : "id"}` : source,
    provider: modelId(obj?.providerID ?? provider)
  };
}
function key(...parts) {
  return JSON.stringify(parts);
}
function agreed(...values) {
  const ids = values.map(identifier).filter((id) => id !== void 0);
  return ids.every((id) => id === ids[0]) ? ids[0] : void 0;
}
function eventSessionID(type, props) {
  const info = record(props.info);
  const part = record(props.part);
  return typeof type === "string" && type.startsWith("session.") ? agreed(props.sessionID, info?.id) : agreed(props.sessionID, info?.sessionID, part?.sessionID);
}
var BoundedCache = class {
  constructor(limit, now) {
    this.limit = limit;
    this.now = now;
  }
  entries = /* @__PURE__ */ new Map();
  get(id) {
    const entry = this.entries.get(id);
    if (entry && entry.expires > this.now()) return entry.value;
    this.entries.delete(id);
    return void 0;
  }
  set(id, value) {
    this.entries.delete(id);
    this.entries.set(id, { value, expires: this.now() + MODEL_CACHE_LIMITS.ttlMs });
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
  }
  removeWhere(predicate) {
    for (const [id, entry] of this.entries) {
      if (predicate(entry.value)) this.entries.delete(id);
    }
  }
  clearSession(sessionID) {
    this.removeWhere((entry) => entry.sessionID === sessionID);
  }
};
var ModelTracker = class {
  constructor(now = Date.now) {
    this.now = now;
    this.messages = new BoundedCache(MODEL_CACHE_LIMITS.messages, now);
    this.requests = new BoundedCache(MODEL_CACHE_LIMITS.requests, now);
    this.calls = new BoundedCache(MODEL_CACHE_LIMITS.calls, now);
  }
  messages;
  requests;
  calls;
  ended = /* @__PURE__ */ new Map();
  chatMessage(input, output) {
    const sessionID = agreed(input.sessionID, output?.message?.sessionID);
    if (!sessionID) return;
    this.ended.delete(sessionID);
    const messageID = agreed(input.messageID, output?.message?.id);
    if (!messageID) return;
    const agent = identifier(output?.message?.agent ?? input.agent);
    const supplied = output?.message?.model !== void 0;
    this.requests.set(key(sessionID, messageID, agent ?? ""), {
      sessionID,
      messageID,
      evidence: fromModel(
        supplied ? output.message?.model : input.model,
        supplied ? "requested:chat.message.message.model" : "requested:chat.message.model"
      )
    });
  }
  chatParams(input) {
    const sessionID = agreed(input.sessionID, input.message?.sessionID);
    const messageID = identifier(input.message?.id);
    const agent = identifier(input.agent);
    if (!sessionID || !messageID || !agent || this.ended.has(sessionID)) return;
    this.requests.set(key(sessionID, messageID, agent), {
      sessionID,
      messageID,
      evidence: fromModel(input.model, "requested:chat.params.model")
    });
  }
  fresh(timestamp) {
    return timestamp === void 0 || typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= this.now() - MODEL_CACHE_LIMITS.ttlMs;
  }
  clearSession(sessionID) {
    this.messages.clearSession(sessionID);
    this.requests.clearSession(sessionID);
    this.calls.clearSession(sessionID);
  }
  event(type, props) {
    const sessionID = eventSessionID(type, props);
    const info = record(props.info);
    const part = record(props.part);
    const ended = ["session.idle", "session.deleted", "session.error"].includes(type ?? "") || type === "session.status" && record(props.status)?.type === "idle";
    if (sessionID && ended) {
      this.clearSession(sessionID);
      this.ended.delete(sessionID);
      this.ended.set(sessionID, true);
      if (this.ended.size > MODEL_CACHE_LIMITS.endedSessions) this.ended.delete(this.ended.keys().next().value);
    } else if (sessionID && type === "session.created") {
      this.clearSession(sessionID);
      this.ended.delete(sessionID);
    }
    if (type === "message.updated" && info) {
      if (!agreed(props.sessionID, info.sessionID) && (props.sessionID || info.sessionID)) return void 0;
      const messageID = identifier(info.id);
      const agent = identifier(info.agent);
      const role = info.role;
      let evidence = role === "assistant" ? fromModel(modelId(info.modelID), "reported:message.updated.info.modelID", info.providerID) ?? fromModel(info.model, "reported:message.updated.info.model") : role === "user" ? fromModel(info.model, "requested:message.updated.info.model") : void 0;
      if (!evidence && role === "user" && !("model" in info) && sessionID && messageID) {
        evidence = this.requests.get(key(sessionID, messageID, agent ?? ""))?.evidence;
      }
      if (role === "user" && "model" in info && !evidence && sessionID && messageID) {
        this.requests.set(key(sessionID, messageID, agent ?? ""), { sessionID, messageID });
      }
      if (evidence) evidence = { ...evidence, agent, messageID };
      if (sessionID && messageID && !this.ended.has(sessionID) && this.fresh(record(info.time)?.created)) {
        const old = this.messages.get(key(sessionID, messageID));
        const ambiguous = old?.ambiguous || Boolean(role === "assistant" && old?.evidence && evidence && (old.evidence.model !== evidence.model || old.evidence.provider !== evidence.provider || old.evidence.agent !== evidence.agent));
        this.messages.set(key(sessionID, messageID), {
          sessionID,
          messageID,
          evidence: ambiguous ? void 0 : evidence,
          ambiguous
        });
      }
      return evidence;
    }
    if (sessionID && type === "message.removed") {
      const messageID = identifier(props.messageID);
      this.messages.removeWhere((entry) => entry.sessionID === sessionID && entry.messageID === messageID);
      this.requests.removeWhere((entry) => entry.sessionID === sessionID && entry.messageID === messageID);
      this.calls.removeWhere((entry) => entry.sessionID === sessionID && entry.messageID === messageID);
    }
    if (sessionID && type === "message.part.removed") {
      const partID = identifier(props.partID);
      if (partID) this.calls.removeWhere((entry) => entry.sessionID === sessionID && entry.partID === partID);
    }
    if (type === "message.part.delta") {
      const messageID = identifier(props.messageID);
      return sessionID && messageID && !this.ended.has(sessionID) ? this.messages.get(key(sessionID, messageID))?.evidence : void 0;
    }
    if (type === "message.part.updated" && part) {
      if (!sessionID || this.ended.has(sessionID) || !this.fresh(props.time)) return void 0;
      const messageID = identifier(part.messageID);
      if (!messageID) return void 0;
      const callID = identifier(part.callID);
      if (part.type === "tool" && callID) {
        const callKey = key(sessionID, callID);
        const old = this.calls.get(callKey);
        if (!old?.closed) {
          const tool = identifier(part.tool);
          this.calls.set(callKey, {
            sessionID,
            messageID,
            partID: identifier(part.id),
            tool,
            pinned: old?.pinned,
            ambiguous: old?.ambiguous || Boolean(old && (old.messageID !== messageID || old.tool !== tool))
          });
        }
      }
      return this.messages.get(key(sessionID, messageID))?.evidence;
    }
    if (typeof type === "string" && type.startsWith("session.")) {
      return fromModel(info?.model, `selected:${type}.info.model`) ?? fromModel(props.model, `selected:${type}.model`);
    }
    return fromModel(props.model, "reported:event.model") ?? fromModel(modelId(props.modelID), "reported:event.modelID", props.providerID);
  }
  tool(input, after) {
    const direct = fromModel(modelId(input.modelID), "reported:tool.modelID", input.providerID) ?? fromModel(input.model, "reported:tool.model", input.providerID);
    const sessionID = identifier(input.sessionID);
    const callID = identifier(input.callID);
    if (!sessionID || !callID) return direct;
    const callKey = key(sessionID, callID);
    const call = this.calls.get(callKey);
    let evidence = direct;
    if (!("model" in input) && !("modelID" in input) && call && !call.closed && !call.ambiguous && !this.ended.has(sessionID) && (!call.tool || call.tool === input.tool)) {
      const message = this.messages.get(key(sessionID, call.messageID));
      if (!message?.ambiguous) evidence = call.pinned ?? message?.evidence;
      if (input.agent && evidence?.agent && input.agent !== evidence.agent || input.messageID && input.messageID !== call.messageID) evidence = void 0;
    }
    if (call && !call.closed) {
      this.calls.set(callKey, {
        ...call,
        pinned: after ? void 0 : evidence,
        closed: after
      });
    }
    return evidence;
  }
  beforeTool(input) {
    return this.tool(input, false);
  }
  afterTool(input) {
    return this.tool(input, true);
  }
};
function modelFields(fields, evidence) {
  const { model: rawModel, model_source: rawSource, ...out } = fields;
  if ("model" in fields && rawModel !== evidence?.model) out.model_raw = rawModel;
  if ("model_source" in fields) out.model_source_raw = rawSource;
  if (evidence) {
    out.model = evidence.model;
    out.model_source = evidence.source;
    if (evidence.provider) {
      if ("provider" in out && out.provider !== evidence.provider) out.provider_raw = out.provider;
      out.provider = evidence.provider;
    }
    if (out.agent === void 0) out.agent = evidence.agent;
    if (out.message_id === void 0) out.message_id = evidence.messageID;
  }
  return out;
}

// src/telemetry.ts
var Telemetry = class {
  constructor(transport, trace, config) {
    this.transport = transport;
    this.trace = trace;
    this.config = config;
  }
  models = new ModelTracker();
  build(name, sessionId, fields) {
    const traceId = this.trace.currentTrace(sessionId);
    return buildOtlpPayload({ name, traceId, fields, serviceVersion: this.config.serviceVersion });
  }
  /** Send a payload built by one of the `*Payload` methods (best-effort by the transport's contract). */
  async send(payload) {
    await this.transport.send(payload);
  }
  async emit(name, sessionId, fields) {
    await this.send(this.build(name, sessionId, fields));
  }
  chatMessage(input, output) {
    this.models.chatMessage(input, output);
  }
  chatParams(input) {
    this.models.chatParams(input);
  }
  /** Lifecycle span from the `event` hook. Flushes the retry buffer on turn-END. */
  async lifecycle(ev) {
    const props = record(ev.properties) ?? {};
    const sessionId = eventSessionID(ev.type, props);
    const model = this.models.event(ev.type, props);
    if (ev.type === "session.idle") await this.transport.flush();
    await this.emit(`opencode.event.${ev.type ?? "unknown"}`, sessionId, modelFields({
      hook: "event",
      event_type: ev.type,
      session_id: sessionId,
      cwd: process.cwd(),
      ...props
    }, model));
  }
  /**
   * Tool span from `tool.execute.before`, before the guard has been asked. The
   * plugin asks the guard about this payload, attaches the verdict with
   * `attachGuard`, and sends the same object — so the span the manager judged
   * is the span the backend stores.
   */
  toolBeforePayload(input, args) {
    return this.build(
      "opencode.tool.before",
      input.sessionID,
      modelFields(
        { ...toolIdentity("tool.execute.before", input), tool_input: args },
        this.models.beforeTool(input)
      )
    );
  }
  /** Tool span from `tool.execute.before`, carrying an already-known guard decision. */
  async toolBefore(input, args, guard) {
    await this.send((0, import_core7.attachGuard)(this.toolBeforePayload(input, args), guard));
  }
  /** Raw MCP results arrive before OpenCode converts their content to output. */
  toolAfterPayload(input, output) {
    const meta = output.metadata ?? {};
    return this.build("opencode.tool.after", input.sessionID, modelFields({
      ...toolIdentity("tool.execute.after", input),
      tool_input: input.args,
      title: output.title,
      tool_response: output.content !== void 0 ? output : output.output,
      attachments: output.attachments,
      exit: meta.exit,
      truncated: meta.truncated
    }, this.models.afterTool(input)));
  }
  /** Tool result span from `tool.execute.after`, incl. exit code / truncation. */
  async toolAfter(input, output) {
    await this.send(this.toolAfterPayload(input, output));
  }
};
function toolIdentity(hook, input) {
  return {
    hook,
    tool_name: input.tool,
    session_id: input.sessionID,
    tool_use_id: input.callID,
    cwd: process.cwd(),
    ...input.model !== void 0 ? { model: input.model } : {},
    ...input.modelID !== void 0 ? { modelID: input.modelID } : {},
    ...input.providerID !== void 0 ? { providerID: input.providerID } : {},
    ...input.agent !== void 0 ? { agent: input.agent } : {},
    ...input.messageID !== void 0 ? { message_id: input.messageID } : {}
  };
}

// src/plugin.ts
function warn(scope, err) {
  process.stderr.write(`[pinta-opencode] ${scope}: ${err?.message ?? String(err)}
`);
}
var OUTPUT_DENIED_MESSAGE = "Pinta withheld this tool output because it violated an active policy.";
function failOpen(scope, fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      warn(scope, err);
    }
  };
}
var PintaOpencode = async (_input, options) => {
  const config = resolveConfig(options ?? {});
  const transport = new Transport({ endpoint: config.endpoint, headers: config.headers });
  const trace = new import_core4.MemorySessionTraceManager();
  const telemetry = new Telemetry(transport, trace, config);
  async function guardAndTrace(hook, build) {
    let guard = null;
    try {
      const payload = build();
      guard = await evaluateGuard(
        payload,
        config.guardEndpoint,
        { timeoutMs: config.guardTimeoutMs, token: config.relayToken, disabled: config.guardDisabled }
      );
      (0, import_core8.attachGuard)(payload, guard);
      if (hook === "tool.execute.after" && guard) {
        payload.resourceSpans[0].scopeSpans[0].spans[0].attributes.push({
          key: "pinta.guard.target",
          value: { stringValue: "tool_output" }
        });
      }
      if (guard?.decision === "DENY") transport.defer(payload);
      else await telemetry.send(payload);
    } catch (err) {
      warn(hook, err);
    }
    return guard;
  }
  return {
    // turn-START → rotate a new trace for this session.
    "chat.message": failOpen("chat.message", async (input, output) => {
      trace.newTrace(input?.sessionID);
      telemetry.chatMessage(input, output);
    }),
    "chat.params": failOpen("chat.params", async (input, _output) => {
      telemetry.chatParams(input);
    }),
    // lifecycle telemetry; flushes the retry buffer on session.idle (turn-END).
    event: failOpen("event", async (input) => {
      if (input?.event) await telemetry.lifecycle(input.event);
    }),
    // ★ governance gate: guard query → DENY throws (blocks just this tool).
    // Telemetry/guard-infra errors are fail-open; only a DENY decision escapes.
    "tool.execute.before": async (input, output) => {
      const guard = await guardAndTrace("tool.execute.before", () => telemetry.toolBeforePayload(input, output?.args));
      if (guard?.decision === "DENY") {
        throw new Error(guard.userMessage ?? guard.reason ?? "guard_deny");
      }
    },
    "tool.execute.after": async (input, output) => {
      const guard = await guardAndTrace("tool.execute.after", () => telemetry.toolAfterPayload(input, output));
      if (guard?.decision === "DENY") throw new Error(OUTPUT_DENIED_MESSAGE);
    }
  };
};
var plugin_default = PintaOpencode;

// src/lifecycle/scanner.ts
import { opendir, stat as stat2 } from "node:fs/promises";
import { homedir } from "node:os";
import path3 from "node:path";

// src/lifecycle/snapshot.ts
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path2 from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var DEFAULT_STABLE_MS = 2e3;
var DEFAULT_MAX_RETRIES = 3;
var sqlite3Probe;
function detectSqlite3() {
  if (sqlite3Probe === void 0) {
    sqlite3Probe = execFileAsync("sqlite3", ["-version"]).then(() => "sqlite3").catch(() => null).then((result) => {
      if (result === null) sqlite3Probe = void 0;
      return result;
    });
  }
  return sqlite3Probe;
}
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
async function makeSnapshotDir(base) {
  return mkdtemp(path2.join(base, "pinta-opencode-snap-"));
}
async function backupViaCli(sqlite3Path, dbPath, outPath) {
  const backupCmd = `.backup '${outPath.replace(/'/g, "''")}'`;
  await execFileAsync(sqlite3Path, ["-cmd", ".timeout 5000", dbPath, backupCmd]);
}
async function quiesceCopy(file, outDir, stableMs, maxRetries, deadlineMs) {
  const dbPath = file.absPath;
  const outDbPath = path2.join(outDir, path2.basename(dbPath));
  const deadline = Date.now() + deadlineMs;
  let lastErr;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
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
      await copyFile(dbPath, outDbPath);
      await copyIfPresent(`${dbPath}-wal`, `${outDbPath}-wal`);
      await copyIfPresent(`${dbPath}-shm`, `${outDbPath}-shm`);
      if (!stable) return outDbPath;
      const after = await stat(dbPath);
      if (after.mtimeMs === before.mtimeMs && after.size === before.size) {
        return outDbPath;
      }
    } catch (err) {
      lastErr = err;
    }
    if (Date.now() >= deadline) break;
  }
  try {
    await stat(outDbPath);
    return outDbPath;
  } catch {
    throw lastErr ?? new Error(`snapshot quiesce-copy failed for ${dbPath}`);
  }
}
async function copyIfPresent(src, dst) {
  try {
    await copyFile(src, dst);
  } catch {
  }
}
async function snapshot(file, opts = {}) {
  const base = opts.tmpDir ?? tmpdir();
  const stableMs = opts.stableMs ?? DEFAULT_STABLE_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const deadlineMs = opts.deadlineMs ?? Math.max(stableMs * maxRetries * 3, 15e3);
  const sqlite3Path = opts.sqlite3Path === void 0 ? await detectSqlite3() : opts.sqlite3Path;
  const outDir = await makeSnapshotDir(base);
  try {
    if (sqlite3Path) {
      const outPath = path2.join(outDir, `${path2.basename(file.absPath)}.snapshot`);
      try {
        await backupViaCli(sqlite3Path, file.absPath, outPath);
        return outPath;
      } catch {
      }
    }
    return await quiesceCopy(file, outDir, stableMs, maxRetries, deadlineMs);
  } catch (err) {
    await rm(outDir, { recursive: true, force: true }).catch(() => {
    });
    throw err;
  }
}

// src/lifecycle/scanner.ts
var WRAPPER_ID = "pinta-opencode";
function dataRoot() {
  const explicit = process.env.OPENCODE_DATA;
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) {
    return path3.join(xdg, "opencode");
  }
  return path3.join(homedir(), ".local", "share", "opencode");
}
function toPosixRelPath(root, absPath) {
  return path3.relative(root, absPath).split(path3.sep).join("/");
}
function isExcluded(relPath) {
  if (relPath === "auth.json") return true;
  const top = relPath.split("/")[0];
  if (top === "log" || top === "repos") return true;
  if (relPath.endsWith(".db-wal") || relPath.endsWith(".db-shm")) return true;
  return false;
}
function isExcludedDir(relPath) {
  return relPath === "log" || relPath === "repos";
}
function semanticsFor(relPath) {
  return relPath.endsWith(".db") ? "database" : "rewritten-doc";
}
function sessionIdFor(relPath) {
  const base = path3.posix.basename(relPath);
  if (!base.startsWith("ses_")) return void 0;
  const ext = path3.posix.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}
function classify(relPath) {
  if (relPath.endsWith(".db")) {
    return "session-log";
  }
  if (relPath.endsWith(".json")) {
    return "meta";
  }
  return "other";
}
async function roots() {
  return [dataRoot()];
}
async function* walkFiles(root, dir) {
  let entries;
  try {
    entries = await opendir(dir);
  } catch {
    return;
  }
  try {
    for await (const entry of entries) {
      const absPath = path3.join(dir, entry.name);
      const relPath = toPosixRelPath(root, absPath);
      if (entry.isDirectory()) {
        if (isExcludedDir(relPath)) continue;
        yield* walkFiles(root, absPath);
      } else if (entry.isFile()) {
        if (isExcluded(relPath)) continue;
        yield { absPath, relPath };
      }
    }
  } catch {
    return;
  }
}
async function* scan(opts) {
  const [root] = await roots();
  const sinceMs = opts.since?.getTime();
  for await (const { absPath, relPath } of walkFiles(root, root)) {
    let st;
    try {
      st = await stat2(absPath);
    } catch {
      continue;
    }
    if (sinceMs !== void 0 && st.mtime.getTime() <= sinceMs) {
      continue;
    }
    yield {
      relPath,
      absPath,
      size: st.size,
      mtime: st.mtime,
      sessionId: sessionIdFor(relPath),
      semantics: semanticsFor(relPath)
    };
  }
}
var lifecycle = {
  id: WRAPPER_ID,
  roots,
  scan,
  classify,
  // `database` files (opencode.db) must be snapshot()'d before read — the live
  // file has `-wal`/`-shm` and would torn-read (plan §4.2, §6).
  snapshot
};
export {
  PintaOpencode,
  classify,
  plugin_default as default,
  lifecycle,
  roots
};
