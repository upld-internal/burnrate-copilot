# Burnrate Copilot

Burnrate Copilot is the GitHub Copilot CLI host adapter for [Burnrate's shared contracts](../burnrate-spec/README.md). It is being rebuilt in Rust as a consumer of the pinned `burnrate-adapter-kit`, following [Burnrate Codex](../burnrate-codex/README.md). The earlier JavaScript plugin was removed. It is not a shared-contract consumer and is not supported.

## Status

The crate is scaffolded. It parses and validates Copilot hook input, keeping only metadata. Local records, the statusline, Langfuse metadata, packaging, and installation are not built yet. `burnrate-copilot hook <event>` currently validates its input and then exits with `not_implemented`.

## Planned scope

- **Local records:** Copilot plugin hooks (`sessionStart`, `postToolUse`, `agentStop`, `sessionEnd`) produce normalized local records through the adapter kit.
- **Statusline:** a native `statusLine` command renders the shared projection. It uses documented stdin fields, including Copilot's `ai_used.total_nano_aiu`.
- **Langfuse metadata:** Copilot exports its own traces to Langfuse through its built-in OpenTelemetry exporter. At `agentStop`, Burnrate adds a correlated span that carries the cross-harness `git_branch`, `git_repository`, and `jira_key` metadata. See the [probe evidence](docs/copilot-otel-probe.md).

## Development

Rust 1.85 or newer is required. The shared dependency is pinned to an immutable `burnrate-spec` revision in `Cargo.toml` and `Cargo.lock`.

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
```

Read [AGENTS.md](AGENTS.md) before changing code.
