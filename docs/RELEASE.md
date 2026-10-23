# Release readiness

The package version `3.0.0-beta.1` identifies the development line. `private: true` intentionally blocks accidental npm publication. No public package release is implied by a successful build.

## Verified locally during preparation

- Fresh `bun ci` succeeds in an isolated checkout; the application runtime remains Node.js.
- Sixteen offline tests pass on Node 22 and Node 24, including stdio startup outside the checkout, invalid inputs, pagination, scheduled drafts, upload bytes and token refresh persistence.
- A read-only MCP call against Google returned a course page and a continuation token using the existing local OAuth setup. This does not prove fresh browser consent or write behavior.
- Gitleaks 8.30.1 scanned the existing Git history without findings. Its downloaded archive checksum was verified; final staged content must also pass before push.

## Required before a standalone release

- [x] Preserve the upstream MIT text and original attribution in LICENSES/MIT-upstream.txt; document the commercial extension boundary in LICENSE and PROVENANCE.md.
- [ ] Review the commercial license and rights to the covered extensions before offering paid usage agreements.
- [ ] Confirm CI passed for the exact commit being released.
- [ ] Verify Desktop OAuth consent and a read-only call against Google from a fresh setup.
- [x] In a newly created dedicated test course, material, assignment and announcement drafts were created, scheduled, read back and unscheduled. A real uploaded file was verified on the material. No existing teaching courses were changed.
- [x] Upload a small file and verify its attachment by reading the material back.
- [ ] Verify that attachment with a participant account.
- [ ] Check visible Classroom order after publication independently of API order.
- [x] Remove the legacy local-auth gaxios/uuid dependency chain without forcing incompatible versions; run the full audit in CI. See Dependency review.
- [ ] Inspect the final source, Git history and distributable files with a redacted secret scanner.
- [ ] Reconcile release notes against commits; record breaking contracts, tested environments and remaining limitations.

Keep real test-course IDs and evidence outside the repository. The included tests are offline and are not proof of Google OAuth or scheduled delivery.

## Repository status

GitHub detachment is complete: this repository is standalone and its commit history is retained. From the 2026-10-24 licensing transition, maintainer-authored extensions carry a commercial notice while original upstream portions retain MIT. GitHub may display a custom or unrecognized license label; README and LICENSE document the actual scope. The original upstream PR remained open at verification. No repository deletion was required.

## Dependency review

### 2026-10-23 security refresh

The refreshed lockfile resolves the seven high/critical advisories reproduced from the previous lockfile (including a new Zod finding):

| Package | Previous | Updated | Advisory coverage |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 | 1.32.2 | [OAuth credential binding](https://github.com/advisories/GHSA-6qxp-vccf-f47h), [task session isolation](https://github.com/advisories/GHSA-22jm-h49p-29qw), [HTTP validation resource use](https://github.com/advisories/GHSA-46jr-4wx8-v453) |
| `brace-expansion` | 2.1.4 | 2.1.7 | [comma recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), [nested brace recursion](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `proxy-addr` | 2.0.7 | 2.0.8 | [proxy subnet trust](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) |
| `zod` | 3.25.76 | 4.6.7 | [oversized collection validation](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |

Compatible patch updates to `fast-uri` 3.1.9, `hono` 4.13.13 and `ip-address` 10.7.4 also remove their moderate findings. Zod 4 is within both the SDK's and zod-to-json-schema's declared ranges; no override or extra direct dependency is added. The SDK minimum in package.json is raised to 1.32.2.

### Remove the remaining uuid dependency chain

The initial security refresh left one moderate `uuid` 9.0.1 finding in `@google-cloud/local-auth` 3.0.1's old Google auth/gaxios chain. Registry metadata still offers no compatible patched update for that chain. Rather than overriding uuid or forcing new transitive majors, the project now removes the sample login helper and reuses the existing OAuth client from `googleapis` for Desktop authorization.

The small local callback binds only `127.0.0.1` on an ephemeral port and validates method, callback authority/path, random state and a single authorization code. It uses S256 PKCE, exchanges at most one code and closes on completion, browser failure, denial or a five-minute deadline. Callback errors contain fixed messages, never Google response details or token values. Token scope checks, Google verification, atomic private token storage and refresh persistence remain in the existing authorization code. Existing credentials and tokens need no migration. The already-used `open` 7.4.2 browser opener becomes a direct dependency; no dependency override or incompatible major is introduced.

The refreshed lockfile contains no uuid package, local-auth helper or old Google auth 9/gaxios 6 chain. A fresh frozen install and full `bun audit` report no findings as of 2026-10-23. CI now runs the full audit, including moderate findings, to prevent the previous gap between a passing high-only gate and the remaining uuid alert.

Twenty offline tests cover the existing MCP/token contracts plus PKCE/state checks, wrong callback authority/path/method, duplicate codes/state, denial, sanitized token/browser failures, listener cleanup, concurrent callbacks and late completion after timeout. Google token exchange and browser launch are mocked; new fresh-consent behavior still requires a separately authorized live check. [Google's Desktop OAuth documentation](https://developers.google.com/identity/protocols/oauth2/native-app) describes the loopback/PKCE flow.

The server uses local stdio and does not configure HTTP transports, proxy trust or an experimental task store. Those reachability limits do not replace patched dependencies. In particular, the SDK's HTTP validation advisory requires additional input/body limits if HTTP support is ever introduced; a version update alone is not sufficient for that deployment mode. Offline tests cover the existing tool, validation, pagination, scheduling, upload, token-refresh and stdio contracts; live Google consent and participant access remain separate checks.

CI continues to enforce tests on Node 22/24, unchanged tracked build output and a redacted secret scan, and now rejects any dependency audit finding. Passing CI is a merge gate, not proof of complete security. Audits change as advisories are published; reproduce them from the committed lockfile with `bun ci --ignore-scripts` before assessing an alert, and retain the full audit's lower-severity findings in the review.

## Distribution

Start with a GitHub release after the checks above. Before considering npm, choose an available package name and inspect `npm pack --dry-run` plus installation of the packed artifact. Include the resolved license and authentication assets; exclude all credentials and local test evidence. Remove `private: true` only as part of an explicit publication decision.
