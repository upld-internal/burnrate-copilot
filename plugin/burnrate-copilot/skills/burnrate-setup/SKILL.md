---
name: burnrate-setup
description: Set up or repair Burnrate for Copilot CLI on macOS or Windows - store the shared Upland Langfuse project, configure Copilot's trace exporter and the user id, and verify an attributed Copilot Turn trace.
---

# Set up Burnrate

A user request to set up or repair Burnrate authorizes storing the shared Upland
Langfuse project in the OS credential store, writing Copilot's trace exporter
settings and the user id as persistent user environment variables, and nothing
else. A status-only request authorizes inspection only. Preserve the user's
existing configuration and explicit choices.

The plugin root is two directories above this file; set `PLUGIN_ROOT` to that
absolute path. Setup is once per user and machine: afterwards every
repository's turns are attributed from their own working directory. Run it from
the current Git repository. Use:

- macOS: `/bin/sh "$PLUGIN_ROOT/hooks/run.sh" setup status`
- Windows PowerShell: `& "$env:PLUGIN_ROOT\bin\x86_64-pc-windows-msvc\burnrate-copilot.exe" setup status`

Replace `setup status` with `setup` to perform setup. Do not substitute a
checkout binary for the packaged one. Never ask for Langfuse keys, never print
them, and never put keys in chat or command arguments; setup stores the shared
project itself.

Follow the returned `state`:

1. `user_id_required`: the Git email is not an `@uplandsoftware.com` address.
   Ask the user for their Upland email or its local part, then run
   `setup --user-id <value>`. Setup stores only `upland-human-<local part>`;
   the email itself is never written. Do not guess the value.
2. `configured`: report `changes`. If `restart_required` is true, tell the user
   to open a **new terminal** and start a new `copilot` session there (Windows:
   a new terminal window, so it picks up the user environment). Existing
   terminals keep the old environment.
3. `unsupported_platform` (Linux): keep the environment-only configuration
   described in `setup-langfuse`.

Explain any `notices`; do not change those settings yourself:

- `langfuse_environment_override`: `LANGFUSE_*` variables in this environment
  take precedence over the stored project. Name them without showing values.
- `nonstandard_langfuse_server`: an existing configuration points somewhere
  other than `https://langf-admin.upland.one`; it was kept.
- `user_id_looks_like_email` or `nonstandard_user_id`: the plan requires
  `upland-human-<slug>`; the user should correct `LANGFUSE_COPILOT_USER_ID`.
- `generic_otlp_exporter_present`: generic `OTEL_EXPORTER_OTLP_ENDPOINT` or
  `_HEADERS` is set; Copilot's traces use setup's trace-specific settings, but
  other signals may follow the generic ones.

If `langfuse_network` is `unreachable`, tell the user to connect to **ZPA**: the
Upland Langfuse host is reachable only over ZPA, and without it traces are
silently not uploaded.

Setup writes `COPILOT_OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,
`OTEL_EXPORTER_OTLP_TRACES_HEADERS` and `LANGFUSE_COPILOT_USER_ID`: on Windows
in the user environment, on macOS in a marked block in `~/.zshrc` (and existing
bash startup files). It never sets `LANGFUSE_*` keys and never enables content
capture. `setup remove` deletes exactly those variables; `langfuse forget`
removes the stored project.

After the restart, verify: in the new session run a small tool-using turn,
take its trace ID from the turn's `agentStop` traceparent, and run
`langfuse verify TRACE_ID` with the same binary **from that repository before
changing branch**. It checks one `Copilot Turn` with `harness=copilot_cli`,
`git_repository`, `git_branch` and Jira metadata, and exactly one attribution
span under the native root. Report configuration readiness separately from this
remote verification; a successful command or `sent` state is not ingestion
proof. Do not create or change a branch just to obtain Jira metadata.

Legacy v0.1.0 must be deactivated with `migration disable-legacy` before
relying on this copy; restart so old hooks are not still loaded. To use a
different Langfuse project, the user runs `langfuse setup` in their own
terminal (hidden prompts); `setup` then keeps that configuration.
