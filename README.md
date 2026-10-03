# Burnrate Copilot

Burnrate Copilot is the GitHub Copilot CLI host adapter for [Burnrate's shared contracts](../burnrate-spec/README.md). Its plugin records supported Copilot lifecycle and tool events locally. When Copilot's built-in OpenTelemetry export sends traces to Langfuse, Burnrate adds `git_branch`, `git_repository`, `jira_key`, and `jira_keys` to each turn's trace when those facts are available.

This is a Rust rewrite that consumes the pinned `burnrate-adapter-kit`, following [Burnrate Codex](../burnrate-codex/README.md). The earlier JavaScript plugin was removed; it was not a shared-contract consumer. The signed [v0.5.0](docs/releases/v0.5.0.md) five-target package is published to `marketplace-pilot`, with live installation and managed-settings trace proof on macOS ARM64. Native Windows host and production rollout remain pending. The candidate has ARM64 native-signing and controlled Git-fixture update/rollback proof; credential-free ARM64 managed fixture activation also passed after restart. A five-target signed pilot update and exact candidate managed activation remain open gates. The current source prepares an unreleased v0.6.0 candidate; see the [rollout evidence](docs/rollout-readiness.md).

## How it works

```text
Copilot CLI ──OTel export──────────────────────────────────> Langfuse trace (invoke_agent, chat, tools)
     │                                                                 ^
     └─ plugin hooks ─> burnrate-copilot ─> adapter kit ─> local records
                              └─ agentStop ─> burnrate.attribution span ┘
```

- **Local records:** `sessionStart`, `postToolUse`, and `sessionEnd` create normalized session and tool events with event-time Git and Jira attribution. Prompt, tool arguments, tool results, and transcripts are discarded when the hook input is read.
- **Langfuse metadata:** Copilot's exporter sends each turn as a trace, but its Git attributes are not filterable in Langfuse and it sends no Jira key. At `agentStop`, Burnrate sends one `burnrate.attribution` span into that trace, as a child of the turn's root span, with `langfuse.trace.metadata.*` attributes. It also names the trace `Copilot Turn`, matching Codex's `Codex Turn`, instead of the default `invoke_agent`. Langfuse promotes those to top-level, filterable trace metadata. The span is sent from a detached process so the turn is not delayed.

Details and evidence are in the [Copilot OTel and hook probe](docs/copilot-otel-probe.md) and the [integration specification](../burnrate-spec/docs/spec/copilot-langfuse-attribution.md).

## Langfuse setup

For the unreleased v0.6.0 candidate on macOS and Windows, run the installed binary
with `langfuse setup` in your terminal. Hidden prompts collect a test project's
HTTPS URL and keys; setup checks the project and stores credentials in macOS
Keychain or Windows Credential Manager. Restart with `langfuse launch`, which
supplies both Copilot's native exporter and Burnrate from the same pair in memory.
Device-managed telemetry must match; server policy still requires real trace
readback. The signed v0.5.0 package retains its environment-only setup path.

Setup preserves the two separate content opt-ins:
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` for Copilot's prompts,
responses, and tool content, and `BURNRATE_LANGFUSE_TURN_IO=true` for Burnrate's
trace-list prompt/final answer. Neither is enabled by setup. Burnrate stores no
conversation text. `LANGFUSE_COPILOT_USER_ID` supplies optional user identity;
only an `@uplandsoftware.com` Git email may be suggested.

Linux and existing environment users retain `LANGFUSE_BASE_URL` (or
`LANGFUSE_HOST`), `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`. Copilot hides
its `OTEL_*` variables from hooks, so the native exporter and metadata sender
need the same project credentials independently. A partial environment config
fails rather than mixing keys from the vault. Never put keys in chat, files, or
command arguments. See [secure setup and repair](docs/langfuse-setup.md).

`langfuse status` reports configuration and the last send outcome; `sent` is not
proof of ingestion. After a real turn, `langfuse verify TRACE_ID` checks API
readback against the current repository attribution, including the parent chain to the host root
and exactly one attribution span. Run it before changing branch.

Before enabling the Rust plugin for a legacy v0.1.0 user, run
`migration disable-legacy` and restart Copilot. It deactivates the recognized
JavaScript copy, neutralizes its recognized plugin hooks, and removes its exact
statusline and user hooks while preserving
historical data and unrelated settings. See [installation and migration](docs/install-and-migration.md).

## Try the development plugin

```sh
./scripts/stage-dev-plugin.sh
copilot --plugin-dir plugin/burnrate-copilot
```

The staging script builds the host-native release binary into `plugin/burnrate-copilot/bin/`. Local data lives under `~/Library/Application Support/burnrate-copilot` on macOS and `${XDG_STATE_HOME:-~/.local/state}/burnrate-copilot` on Linux, and `%LOCALAPPDATA%\burnrate-copilot` on Windows; `config/attribution.json` there can override the shared Jira-key rule.

## Releases

[v0.5.0](docs/releases/v0.5.0.md) is the first signed release. It is published to the `marketplace-pilot` branch and has been [piloted with managed settings on macOS](docs/pilot-macos-managed-settings.md). See [signed releases and marketplace branches](docs/release-and-marketplace.md) for the process.

## Development

Rust 1.85 or newer is required. The shared dependency is pinned to an immutable `burnrate-spec` revision in `Cargo.toml` and `Cargo.lock`.

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --all-targets
cargo +1.85.0 test --locked --all-targets
```

The implementation is under `src/` (`hook.rs` input, `runtime.rs` local records, `langfuse.rs` metadata span), the plugin under `plugin/burnrate-copilot/`, and observed hook payloads under `fixtures/hooks/`. Read [AGENTS.md](AGENTS.md) before changing code.

## Not built yet

- The statusline command and its user `statusLine` setting ownership.
- Publication to the production `marketplace` branch and the enterprise-managed rollout, after the macOS and Windows pilots and the migration from the old JavaScript plugin.
- A verified Windows install. Windows hooks, data paths, and the detached sender are implemented, and CI builds and smoke-tests the x64 binary, but no Copilot session on Windows has run them yet; [the Windows live checklist](docs/windows-live-checklist.md) covers that. Windows on ARM/emulation is not qualified for this release.
- Complete native acceptance on every release target, including interactive and aborted turns, automatic/manual changed-hook update, and failed rollback.
