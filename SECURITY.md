# Security

Run this server locally with your own Google OAuth Desktop client. Anyone with access to your MCP client and tokens can act with the granted Google permissions. Exposing stdio through a public network service is not supported.

Credentials, refresh tokens, student information and course exports must not enter Git or bug reports. Token files use owner-only permissions. Keep backups equally private. Google scope enforcement and course permissions remain authoritative; MCP tool annotations are descriptive, not authorization controls.

For a suspected vulnerability, use GitHub's private reporting option if available. Do not post exploit details or secrets in a public issue. If private reporting is unavailable, open a minimal issue requesting a private contact without sensitive details. No response-time guarantee is offered.

If a token leaks, revoke it through Google, reauthorize and remove the exposed copy. Deleting a commit alone does not revoke access.
