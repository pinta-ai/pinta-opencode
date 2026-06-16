import { describe, it, expect } from "vitest";
import { redact, truncate, MAX_BYTES } from "../src/core/redact.js";

describe("redact", () => {
  it("masks an AWS access key", () => {
    expect(redact("id AKIAIOSFODNN7EXAMPLE here")).toBe("id [REDACTED:aws_access_key] here");
  });

  it("masks a GitHub token", () => {
    const out = redact("token=ghp_" + "a".repeat(36));
    expect(out).toContain("[REDACTED:github_token]");
  });

  it("keeps the URL shape but masks db password", () => {
    const out = redact("postgres://user:s3cr3tpass@host/db");
    expect(out).toBe("postgres://user:[REDACTED:db_url_password]@host/db");
  });

  it("only masks -p<pass> in bash context", () => {
    expect(redact("mysql -psecretpw", { context: "bash" })).toContain("[REDACTED:cli_password_short]");
    expect(redact("mysql -psecretpw")).not.toContain("REDACTED");
  });

  it("leaves clean text untouched", () => {
    expect(redact("just a normal command echo hi")).toBe("just a normal command echo hi");
  });
});

describe("truncate", () => {
  it("returns short input unchanged", () => {
    expect(truncate("short")).toBe("short");
  });

  it("truncates and annotates oversize input", () => {
    const big = "x".repeat(MAX_BYTES + 50);
    const out = truncate(big);
    expect(out).toContain(`…[TRUNCATED:${MAX_BYTES + 50}]`);
    expect(out.length).toBeLessThan(big.length);
  });
});
