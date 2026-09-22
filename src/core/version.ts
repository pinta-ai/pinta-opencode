/**
 * The single source of truth for this adaptor's own version.
 *
 * There is exactly one version literal in `src/`, and it lives here. That is a
 * deliberate constraint, enforced by `tests/adapter-version.test.ts`, which
 * checks this value against package.json and scans `src/` for any other
 * literal of the same shape.
 *
 * The constraint exists because `npm run bump` -- which does update every
 * embedded copy in lock-step -- is a convention, and nothing stopped a release
 * from going out without it. `chore(release): 0.8.0` (754e57d) touched
 * package.json and package-lock.json and nothing else, which is exactly what
 * plain `npm version` produces. 0.8.0 therefore shipped sending
 * `User-Agent: pinta-opencode/0.7.0` and `telemetry.sdk.version` 0.7.0.
 *
 * Both values are consumed by systems that *store* them -- the manager
 * attributes guard calls per adaptor from the User-Agent, and spans carry the
 * SDK version into the backend -- so the drift was invisible on this machine
 * and wrong everywhere the numbers were read. A comment saying "keep in sync"
 * sat directly above both literals while they were wrong. A comment is not a
 * mechanism; a failing test is.
 *
 * Not to be confused with the *host* version: `tests/version.test.ts` covers
 * resolving the opencode CLI's own version out of `process.execPath`. This
 * file is what Pinta ships.
 *
 * It is a literal rather than an import of package.json because the bundle is
 * produced by esbuild CLI invocations with no config file, and importing JSON
 * would inline the entire manifest into `dist/`.
 */
export const ADAPTER_VERSION = "0.10.0";
