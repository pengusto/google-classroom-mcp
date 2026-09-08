# Release readiness

The package version `3.0.0-beta.1` identifies the development line. `private: true` intentionally blocks accidental npm publication. No public package release is implied by a successful build.

## Verified locally during preparation

- Fresh `npm ci` succeeds in an isolated checkout.
- Sixteen offline tests pass on Node 22 and Node 24, including stdio startup outside the checkout, invalid inputs, pagination, scheduled drafts, upload bytes and token refresh persistence.
- A read-only MCP call against Google returned a course page and a continuation token using the existing local OAuth setup. This does not prove fresh browser consent or write behavior.
- Gitleaks 8.30.1 scanned the existing Git history without findings. Its downloaded archive checksum was verified; final staged content must also pass before push.

## Required before a standalone release

- [x] Include the MIT text and transparent original attribution based on upstream declarations; see PROVENANCE.md.
- [ ] Confirm CI passed for the exact commit being released.
- [ ] Verify Desktop OAuth consent and a read-only call against Google from a fresh setup.
- [x] In a newly created dedicated test course, material, assignment and announcement drafts were created, scheduled, read back and unscheduled. A real uploaded file was verified on the material. No existing teaching courses were changed.
- [x] Upload a small file and verify its attachment by reading the material back.
- [ ] Verify that attachment with a participant account.
- [ ] Check visible Classroom order after publication independently of API order.
- [x] Review moderate dependency findings in `@google-cloud/local-auth`'s gaxios/uuid chain. The latest available local-auth version is 3.0.1 at preparation time; high/critical findings fail CI. Do not force incompatible transitive upgrades merely to clear a report.
- [ ] Inspect the final source, Git history and distributable files with a redacted secret scanner.
- [ ] Reconcile release notes against commits; record breaking contracts, tested environments and remaining limitations.

Keep real test-course IDs and evidence outside the repository. The included tests are offline and are not proof of Google OAuth or scheduled delivery.

## Repository status

GitHub detachment is complete: this repository is standalone, its MIT license is recognized and its commit history is retained. The original upstream PR remained open at verification. No repository deletion was required.

## Dependency review

The two moderate npm audit entries (`uuid` and dependent `gaxios`) represent [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). The advisory affects v3/v5/v6 with caller-provided output buffers. The inspected gaxios 6.7.1 callers in local-auth's dependency chain use `uuid.v4()` without an output buffer for multipart boundaries. No affected call was found in those callers or this project's source.

This is a scoped code-path assessment, not a claim that the dependency is patched. Keep the audit warnings visible and reassess when local-auth or its dependency tree changes. Do not force an incompatible transitive major version merely to hide the warning.

## Distribution

Start with a GitHub release after the checks above. Before considering npm, choose an available package name and inspect `npm pack --dry-run` plus installation of the packed artifact. Include the resolved license and authentication assets; exclude all credentials and local test evidence. Remove `private: true` only as part of an explicit publication decision.
