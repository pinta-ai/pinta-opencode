import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

describe("registry authentication boundaries", () => {
  it("ignores setup-node's npmjs token binding during the private dependency install", () => {
    const install = workflow.match(/- run: npm ci\n([\s\S]*?)(?=\n      - )/)?.[1];
    expect(install).toBeDefined();
    expect(install).toContain("NPM_CONFIG_USERCONFIG: /dev/null");
    expect(install).toContain("NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    const projectConfig = readFileSync(new URL("../.npmrc", import.meta.url), "utf8");
    const bindings = projectConfig.split("\n").map(line => line.trim()).filter(line => line.includes("_authToken="));
    expect(bindings).toEqual(["//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}"]);
  });

  it("keeps GitHub credentials out of public npm publication and enables OIDC", () => {
    const publish = workflow.match(/- name: Publish\n([\s\S]*?)(?=\n      - )/)?.[1];
    expect(publish).toContain("npm publish --access public");
    expect(publish).not.toContain("NODE_AUTH_TOKEN");
    expect(publish).not.toContain("GITHUB_TOKEN");
    expect(workflow.match(/NODE_AUTH_TOKEN:/g)).toHaveLength(1);
    expect(workflow.match(/secrets\.GITHUB_TOKEN/g)).toHaveLength(1);
    expect(workflow).toContain("id-token: write");
  });
});
