# Agent guidance for burnrate-copilot

Read [README.md](README.md) and [docs/copilot-otel-probe.md](docs/copilot-otel-probe.md) before changing the provider. [`burnrate-codex`](../burnrate-codex/AGENTS.md) is the reference provider, so follow its structure and invariants unless Copilot's host behavior differs.

## Ownership

- This repository owns Copilot hook input, the statusline entrypoint, host settings ownership, plugin packaging, local roots, the Langfuse metadata span, installation, and release workflows.
- `burnrate-spec` owns normalized contracts, schemas, Git/Jira attribution, remote normalization, storage, recovery, retention, projection, rendering, export policy, and conformance. Consume them through the pinned `burnrate-adapter-kit`, and make provider-neutral changes in that repository.
- Keep the shared Git dependency pinned to an immutable revision in both `Cargo.toml` and `Cargo.lock`.

## Hook and tracing invariants

- Accept bounded Copilot hook JSON on stdin. Never persist or export prompt, tool argument, tool result, transcript content, or credentials. Keep content fields out of the deserialization types.
- Burnrate does not configure or replace Copilot's native OTel exporter. The Langfuse path adds a span to the existing trace, using the hook's `traceparent` and the OTLP endpoint and headers the user already configured. Never copy those headers to disk or diagnostics.
- Keep local collection independent of optional Langfuse delivery. A successful hook exit is not proof that a trace was ingested; verify by reading the trace back from Langfuse.
- Use the cross-harness trace metadata names from `burnrate-spec/docs/spec/trace-metadata.md`.
- Base host claims on observed behavior with a recorded host version. Undocumented quota APIs, pricing tables, and transcript scraping are out of scope.

## Verification

For code changes run `cargo fmt --all --check`, `cargo clippy --locked --all-targets -- -D warnings`, and `cargo test --locked --all-targets`, and also `cargo +1.85.0 test --locked --all-targets`.
