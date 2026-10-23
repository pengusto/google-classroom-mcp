# Contributing

The maintainer-authored extensions use [Pengusto Commercial License 1.0](LICENSE);
original upstream portions remain [MIT](LICENSES/MIT-upstream.txt). Before
submitting code, agree contribution and licensing terms with the maintainer.
No contributor rights assignment is implied by this document. Development and
test instructions do not grant permission to run commercially licensed portions;
obtain the appropriate written agreement first.

Use Node 24 LTS (see `.nvmrc`); CI also checks Node 22.

```sh
bun ci
bun run test
git diff --check
```

Keep changes small. Tests in `tests/*.test.js` use the MCP in-memory transport and fake Google API responses; they must never need credentials or access real courses. Build output in `dist/` is tracked and must match `src/`. The offline OAuth tests bind an ephemeral loopback port on `127.0.0.1`; a sandbox denial such as `EPERM` requires an environment that permits local listeners, not real Google credentials or changes to authentication code.

When changing a tool, update its input schema, behavior tests and README together. Do not retain hidden administrative tools or add generic wrappers for hypothetical features. Keep authentication, input validation and safe failure behavior intact.

A live check needs a dedicated test course and explicit authorization. Record created object IDs locally, verify results by reading them back and never bulk-delete or modify existing course content. Do not put credentials, course identifiers, student details or local evidence into commits.

Dependency changes must include the lockfile, a fresh install and the relevant tests. Run the full `bun audit`; do not auto-fix dependency ranges as part of unrelated changes. A release checklist lives in `docs/RELEASE.md`.
