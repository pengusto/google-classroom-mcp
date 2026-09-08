# Contributing

Use Node 24 LTS (see `.nvmrc`); CI also checks Node 22.

```sh
npm ci
npm test
git diff --check
```

Keep changes small. Tests in `tests/*.test.js` use the MCP in-memory transport and fake Google API responses; they must never need credentials or access real courses. Build output in `dist/` is tracked and must match `src/`.

When changing a tool, update its input schema, behavior tests and README together. Do not retain hidden administrative tools or add generic wrappers for hypothetical features. Keep authentication, input validation and safe failure behavior intact.

A live check needs a dedicated test course and explicit authorization. Record created object IDs locally, verify results by reading them back and never bulk-delete or modify existing course content. Do not put credentials, course identifiers, student details or local evidence into commits.

Dependency changes must include the lockfile, a fresh install and the relevant tests. Avoid `npm audit fix --force`. A release checklist lives in `docs/RELEASE.md`.
