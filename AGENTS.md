# Working on Classroom MCP

Read README.md for tool contracts and CONTRIBUTING.md for commands and test boundaries.
Use Bun 1.4.2 for package management and scripts. Keep Node 24 as the runtime (Node 22 is also checked). Run `bun run test` and `git diff --check`; keep tracked `dist/` output in sync.
Use existing SDK validation and Google clients. Keep tool schemas, behavior and documentation aligned.
Never run live tests without an explicitly designated test course. Never commit credentials, student data, course exports or machine-specific paths.
Follow docs/RELEASE.md before publishing; license provenance is recorded in docs/PROVENANCE.md.
