# Shared Upland Langfuse configuration

`upland-langfuse.json` is the Langfuse project configuration every Upland
Copilot and Codex user already receives in the internal setup guide; it is the
same file as burnrate-codex's `config/upland-langfuse.json`. It is compiled into
the binary, and `burnrate-copilot setup` stores it in the OS credential store
(macOS Keychain, Windows Credential Manager) when the user has no working
Langfuse configuration.

**This key is shared, not a per-user secret.** Every user has the same key, so
bundling it does not grant anything those users do not already have. Treat it
as internal: the repository and its packages are private, and the key must not
be published outside Upland. It can write traces to the project and read every
trace back through the Langfuse API, and the user id is self-declared. Rotating
the key requires a new Burnrate release.

The host `https://langf-admin.upland.one` is reachable only over ZPA. The user
id is always `upland-human-<slug>`, where the slug is the local part of the
user's Upland email; the email itself is never stored.

Copilot's own exporter needs the key in `OTEL_EXPORTER_OTLP_TRACES_HEADERS`,
which setup writes to the user's persistent environment (Windows user
environment, or a marked block in `~/.zshrc` on macOS). Setup uses the
trace-specific OTLP variables so other tools' metrics and logs exporters are
not redirected, and it never sets `LANGFUSE_*` keys, which Codex's Langfuse
handler would read.
