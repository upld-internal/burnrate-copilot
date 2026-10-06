---
name: setup-langfuse
description: Configure secure Copilot CLI Langfuse credentials, repair or rotate them, and verify an attributed Copilot Turn trace after restart.
---

# Set up Burnrate Copilot with Langfuse

For the shared Upland Langfuse project, use the `burnrate-setup` skill instead:
it needs no keys from the user. This skill covers a different, private Langfuse
project (hidden prompts) and Linux's environment-only configuration.

Use the installed native binary. Never ask for a secret in chat, read a user's
shell profile looking for keys, print credentials, or put keys in commands,
settings, diagnostics, or process arguments. Invoke setup directly in the user's
terminal so hidden prompts stay outside the conversation.

On macOS/Linux, `hooks/run.sh` supports `langfuse-status` and
`langfuse-suggest-user-id`. For the other commands select
`bin/aarch64-apple-darwin/burnrate-copilot` or
`bin/x86_64-apple-darwin/burnrate-copilot` on macOS, or the matching GNU/Linux
binary. On Windows invoke
`bin/x86_64-pc-windows-msvc/burnrate-copilot.exe` directly with PowerShell's `&`
operator and a quoted absolute path. All remaining examples use `BINARY` as
that path; it contains no secrets.

1. Run `BINARY langfuse status`. Report only configuration state, host, user ID,
   and bounded send outcome. `credential_unavailable` means a marker exists but
   the vault is missing, locked, or inaccessible. A complete environment
   configuration takes precedence; a partial one fails rather than mixing keys
   with the vault. Remove obsolete environment variables before vault-only use.
2. For macOS or Windows, direct the user to run `BINARY langfuse setup` in their
   terminal. It prompts without echo for the HTTPS base URL and both keys,
   validates the project through `/api/public/projects`, and saves the bundle in
   macOS Keychain or Windows Credential Manager. The only Burnrate config file
   contains a version and base URL. `langfuse setup --from-environment` imports an
   already configured terminal without revealing values. Repeat setup for repair
   or credential rotation. Invalid keys or a failed project check leave the old
   entry unchanged; a failed activation restores the old entry.
3. Linux retains its existing environment configuration. Do not claim vault
   support there or save credentials into a profile. Have the user populate both
   host and Burnrate environments using their approved secret manager.
4. Run `langfuse suggest-user-id`. Suggest its Git email only when the returned
   `suggestion` is non-null (`@uplandsoftware.com`). Otherwise ask the user to type
   the user ID. Save `LANGFUSE_COPILOT_USER_ID` only with their consent, replacing
   an existing value in their profile or Windows user environment. This value is
   optional; do not invent identity from a GitHub account or vault entry.
5. Content capture remains **off unless explicitly opted in**. Explain that
   `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` allows Copilot to send
   prompts, responses, and tool content to Langfuse. Separately,
   `BURNRATE_LANGFUSE_TURN_IO=true` lets the detached sender read the session's
   transcript for trace-list prompt/final answer fields. It stores none of that
   text. Preserve an existing opt-in; do not enable either flag as part of setup.
6. Restart with `BINARY langfuse launch` (Copilot arguments may follow). The
   launcher supplies both exporters from one credential pair using transient
   environment variables. It refuses a mismatched or unreadable device managed
   telemetry file. Server policy or other host overrides can still supersede
   environment variables; project verification remains pending until readback.
   Managed plugin installation needs an interactive session; `copilot -p` alone
   did not install v0.5.0 on observed Copilot 1.0.88/1.0.89.
7. Run a real tool-using turn on a branch with one Jira candidate and a safe
   origin remote. Retrieve the trace ID from that turn's host `agentStop`
   traceparent, then run `BINARY langfuse verify TRACE_ID` **from that repository
   before changing branch**. The verifier checks the current expected metadata,
   `Copilot Turn`, the native root, and exactly one parented attribution span. It
   prints only a boolean report, never trace content. A second turn after a branch
   change must verify against the new branch. Check an aborted turn separately.
   A `sent` state or HTTP 200 is not ingestion proof.

If credentials, host policy access, or trace API access are missing, report the
specific gate as pending. A development binary or CI smoke test does not prove
Windows installation. Use the signed-package Windows live checklist for release
acceptance. Legacy v0.1.0 must be deactivated using `migration disable-legacy`
before enabling the Rust copy; restart so old hooks are not still loaded.
