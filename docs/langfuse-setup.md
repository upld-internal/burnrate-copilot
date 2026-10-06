# Secure Langfuse setup and repair (v0.6.0 candidate)

These commands are not in signed v0.5.0. Use the staged native binary for development,
or the next verified signed candidate when available. The packaged setup skill
selects the absolute native path for macOS or Windows. GNU/Linux keeps its existing
environment path; no Linux vault support is claimed.

Run `burnrate-copilot langfuse setup` **directly in your terminal**. All three
prompts are hidden. No keys go into chat, command arguments, Burnrate records,
state, or a shell profile. Setup validates HTTPS without embedded credentials,
query, or fragment, then requires one project from `/api/public/projects` before
saving a bundle in macOS Keychain or Windows Credential Manager. The service is
`com.upland.burnrate-copilot.langfuse`; the account derives from the provider's
config root so isolated test profiles do not replace real credentials.

The non-secret `config/langfuse-vault.json` holds schema version 1 and the base
URL only. Credentials are never serialized there. Only the detached sender and
explicit user commands access the vault; hooks check this marker without opening
Keychain or Credential Manager. Vault failures are bounded send states and cannot
undo local records. A locked vault or changed unsigned executable can prevent delivery and must be
reauthorized through an explicit interactive launch/setup in the user's terminal.
Detached senders, status, and readback disable Keychain UI rather than waiting for
a password dialog. Local testing found that rebuilding an unsigned binary changes
its Keychain authorization. A stable native macOS signing identity and a proved
credential-preserving update, or another approved private mechanism, is a release
gate; archive Cosign signatures alone do not resolve that OS authorization.

To import an existing approved terminal environment, use
`langfuse setup --from-environment`. To repair or rotate, repeat setup with the new
pair. Invalid credentials or project verification failure leave the old entry
unchanged. The new entry is read back before activating its marker; marker failure
restores the previous credential. `langfuse forget` deletes only this profile's
entry and marker. Revoking a remote key is a separate administrator action.

Restart with `langfuse launch` followed by ordinary Copilot arguments. This explicit
launcher gives the host and sender identical credentials in their process
environments; it neither relays nor replaces native spans. It refuses mismatched
or unreadable device-managed telemetry. A server policy, macOS MDM preferences,
or host-specific override can still win; a successful launcher is not proof of
same-project ingestion. Read a trace containing both native and attribution spans.

Environment configurations retain precedence for compatibility. If any
`LANGFUSE_BASE_URL`, `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, or `LANGFUSE_SECRET_KEY`
is set, the whole environment configuration must be valid. Unset stale variables
before vault-only use. Setup does not alter your profile or Windows user environment.
`BURNRATE_COPILOT_HOME` can select an absolute isolated Burnrate data/config root;
it must not be used to change the operating system login home for Keychain tests.

Optional `LANGFUSE_COPILOT_USER_ID` comes only from that variable. The skill may
suggest Git email only in the `uplandsoftware.com` domain. Neither content opt-in
is enabled by setup: Copilot's content flag and `BURNRATE_LANGFUSE_TURN_IO` remain
independent explicit choices. The sender reads only the session's own completed
turn after its `agentStop` marker and never stores the text.

After a real interactive turn, take the trace ID from the host `agentStop`
traceparent. Run `langfuse verify TRACE_ID` from the same repository **before a
branch change**. It reads traces and observations using the selected credentials,
checks `Copilot Turn`, current expected snake_case metadata and omission rules,
exactly one attribution span, and its parent chain reaching the native `invoke_agent` root. Copilot may supply
a generation span as the hook parent; Burnrate preserves that parent. It emits only checked
identity and pass/fail, never conversation data; failure exits nonzero. API access
failure leaves the gate pending. Polling for delayed ingestion is an operator
step; do not equate `sent`/HTTP 200 with verification.

The local vault contains private credentials, but the process environment can be
read by programs running as the same user. Do not share a terminal/session with
untrusted processes. Avoid root-owned mode-644 managed telemetry files containing
keys on shared machines; use a secret-free managed plugin catalog and the per-user
launcher, or an approved enterprise telemetry delivery mechanism followed by
same-project readback. Changing enterprise policy requires final rollout approval.
