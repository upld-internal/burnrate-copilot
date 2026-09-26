# Agent guidance for burnrate-copilot

Read [README.md](README.md) and [docs/copilot-otel-probe.md](docs/copilot-otel-probe.md) before changing the provider. The integration contract is [`burnrate-spec`'s Copilot Langfuse specification](../burnrate-spec/docs/spec/copilot-langfuse-attribution.md). [`burnrate-codex`](../burnrate-codex/AGENTS.md) is the reference provider; follow its structure unless Copilot's host behavior differs.

## Ownership

- This repository owns Copilot hook input, host and platform checks, the packaged plugin, local roots, the Langfuse metadata span, the statusline entrypoint and its host settings, installation, upgrade, rollback, and release workflows.
- `burnrate-spec` owns normalized contracts, schemas, attribution rules, Git remote normalization, record construction, storage, recovery, retention, projection, rendering, export policy, conformance, and support-report types. Consume these through the pinned `burnrate-adapter-kit`; make provider-neutral changes in that repository.
- Keep the shared Git dependency pinned to an immutable revision in both `Cargo.toml` and `Cargo.lock`. A local path override is suitable for an explicit development test, not a release or consumer proof.

## Hook and tracing invariants

- Accept bounded Copilot hook JSON on stdin. Keep prompt, tool argument, tool result, and transcript fields out of the deserialization types in `src/hook.rs`, so they are never persisted, exported, or logged. Do not persist tool names.
- Keep event identity idempotent. Copilot tool hooks carry no tool-use ID; the tool event identity is derived from session, hook timestamp, tool name, and trace context.
- Commit local records before, and independently of, the Langfuse span. The span is sent by a detached `langfuse send` child so the turn is not delayed; a send failure is recorded in local state and never fails the hook.
- Burnrate never configures, proxies, or re-exports Copilot's native OTel spans. It adds one `burnrate.attribution` span per turn, as a child of the `agentStop` `traceparent`, with only the metadata names in [`trace-metadata.md`](../burnrate-spec/docs/spec/trace-metadata.md) and `harness=copilot_cli`. It sets no session ID; Langfuse derives that from the host's spans.
- Copilot removes `OTEL_*` and `COPILOT_OTEL_*` variables from hook environments. The span destination comes from `LANGFUSE_BASE_URL` (or `LANGFUSE_HOST`), `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`, which must name the same project as the host exporter. Accept only HTTPS without embedded credentials. Never write credentials or headers to disk, diagnostics, or process arguments.
- Do not interpret a successful hook exit or a `sent` state as proof of ingestion. Read the trace back from Langfuse and check `git_branch`, `git_repository`, and `jira_key`.
- Base host claims on observed behavior with a recorded Copilot CLI version. Undocumented quota APIs, pricing tables, and transcript scraping are out of scope.

## Verification

- For code changes run `cargo fmt --all --check`, `cargo clippy --locked --all-targets -- -D warnings`, `cargo test --locked --all-targets`, and `cargo +1.85.0 test --locked --all-targets`.
- For hook or Langfuse changes, stage the plugin with `scripts/stage-dev-plugin.sh`, run a real turn with `copilot --plugin-dir plugin/burnrate-copilot`, inspect the local store, and verify the trace in a Langfuse test project. Check for a missing or duplicate `burnrate.attribution` span and for camelCase `gitBranch` or `jiraKey` keys.
- For shared contract changes, test the exact pinned shared revision and update both repositories' evidence as appropriate.
- Do not describe a build as released until a signed multi-target workflow, asset verification, and installation proof exist. Record the exact source revision and evidence in `docs/`.
