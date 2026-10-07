# Burnrate setup for Copilot CLI

`/burnrate-setup` in Copilot CLI (listed as `/burnrate-copilot:burnrate-setup`)
configures Burnrate once per user and machine,
on macOS and Windows. It matches Codex's `$burnrate-setup`: the shared Upland
Langfuse project, the user id `upland-human-<slug>`, and a ZPA reachability
check, without asking for keys.

Before you start, connect to **ZPA**; `https://langf-admin.upland.one` is
reachable only over ZPA, and without it traces are silently not uploaded.

| Situation | Setup |
| --- | --- |
| No stored Langfuse configuration | Stores the shared Upland project ([`config/upland-langfuse.json`](../config/upland-langfuse.json)) in macOS Keychain or Windows Credential Manager |
| Working configuration already stored, or complete `LANGFUSE_*` environment | Keeps it; reports a non-Upland server or the environment override as a notice |
| No user id | Derives `upland-human-<local part>` from an `@uplandsoftware.com` Git email; otherwise returns `user_id_required` and the skill asks for the Upland email or its local part. The email itself is never stored |
| Copilot's trace exporter not configured | Writes `COPILOT_OTEL_ENABLED`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS` and `LANGFUSE_COPILOT_USER_ID` to the persistent user environment |
| Already set up | Confirms and changes nothing |

Where the variables go: Windows user environment; on macOS a marked block in
`~/.zshrc` (or `$ZDOTDIR/.zshrc`) and in existing `~/.bash_profile` or
`~/.bashrc`. Open a new terminal and start a new `copilot` session afterwards.
On Windows, close every Windows Terminal window first: its new tabs and windows
inherit the environment Windows Terminal started with. `setup status` reports
`current_terminal: ready` only when the running terminal has the saved values;
otherwise `restart_required` is true.
The `langfuse launch` wrapper is no longer needed.

Copilot reads its exporter settings only from the environment or an
administrator's managed settings, which is why setup persists variables rather
than writing a config file. It uses the **trace-specific** OTLP variables:
Copilot 1.0.92 exports traces with them and sends no metrics there, and other
tools' metrics and logs exporters are not redirected. Other OpenTelemetry tools
that export traces from the same user environment would follow them too. Setup
never sets `LANGFUSE_*` keys (the hooks read the OS credential store, and
Codex's Langfuse handler would read those variables) and never enables content
capture.

Commands, using the packaged binary:

- `burnrate-copilot setup status` - inspect only
- `burnrate-copilot setup` / `setup --user-id <email or local part>` - configure
- `burnrate-copilot setup remove` - delete exactly the four variables
- `burnrate-copilot langfuse forget` - delete the stored project

A different Langfuse project is still configured with `langfuse setup` (hidden
prompts); `setup` then keeps it.

## Evidence, 2026-10-06

macOS ARM64, Copilot CLI 1.0.92, provider candidate on
`copilot/burnrate-setup`, isolated `COPILOT_HOME`, `BURNRATE_COPILOT_HOME` and
`ZDOTDIR`, no `LANGFUSE_*` variables in the process. First `setup` stored the
shared project, wrote the four variables, derived `upland-human-bripley` and
reported the host reachable; re-runs changed nothing. A real tool turn with only
the written variables produced trace `fb0176a153b7901f12dfa462131be1e0`:
`langfuse verify` passed (one `Copilot Turn`, native root, one attribution span),
and API readback showed `userId=upland-human-bripley`, `harness=copilot_cli`,
`git_repository=upld-internal/burnrate-copilot`,
`git_branch=feature/ABC-123-setup`, `jira_key=ABC-123`. The isolated vault entry
was then removed. Windows setup is part of the Windows live checklist.

## Windows evidence, 2026-10-06

VEPRO1, Windows 11 Education 25H2 (build 26200), native x64, Copilot CLI
1.0.92, isolated `COPILOT_HOME`, development build `79aae07` (binary SHA-256
`44d6a293...`, shared `4733460`) installed from a local `burnrate-local`
marketplace. VEPRO1 has no ZPA; Langfuse was reached through a reverse SSH
tunnel from a ZPA-connected Mac with a hosts-file entry, preserving TLS to the
real host name.

- `/burnrate-setup` asked for the user id (no Git email on the machine), stored
  the shared project in Credential Manager, wrote the four user variables and
  reported the host reachable.
- Windows PowerShell 5.1 session `4b72f503`: one tool turn; all four Burnrate
  hooks succeeded. Trace `4dd341b5ab7d13d06ca76affcb8ed03a` read back as one
  `Copilot Turn` with `userId=upland-human-bripley`, `harness=copilot_cli`,
  `git_repository=upld-internal/burnrate-copilot`,
  `git_branch=feature/ABC-123-windows-live`, `jira_key=ABC-123`, no camelCase
  keys, service `github-copilot`, and exactly one attribution span under the
  native `invoke_agent` root.
- PowerShell 7 session `e1815f2d`: four completed turns and one Esc abort; all
  eight Burnrate hooks succeeded, the aborted turn delivered no `agentStop`,
  local records were written and no diagnostics were raised. Its windows were
  tabs of a Windows Terminal started before setup, so Copilot ran without the
  exporter variables: no `traceparent`, no host trace and no attribution
  span. `setup status` now detects this (`current_terminal`).
- Host-measured hook durations, including Copilot's PowerShell dispatch, were
  about 350 ms per hook in steady state and about 1.0-1.4 s for session start,
  session end and the first hooks of a session. This is well above the
  executable's own cost and is recorded for follow-up.
- Re-run after closing and restarting Windows Terminal (session `4b29828f`):
  three tool turns, all eight Burnrate hooks succeeded and every `agentStop`
  carried a `traceparent`. Traces `7908e0d35019ca9758e5b2a209dff340`,
  `c8ca616f431332ce5276a58455f9fd99` and `1996baef3e23d10a6494a75387fd273b`
  each read back as one `Copilot Turn` with `userId=upland-human-bripley`,
  `harness=copilot_cli`, the repository, `git_branch=feature/ABC-123-windows-live`,
  `jira_key=ABC-123`, snake_case keys, and exactly one attribution span under
  the native root. This confirms the fresh-terminal requirement.
- Not covered on Windows: a turn after a branch change (all traced turns ran
  on one branch; event-time branch change is proven on macOS with the same
  shared attribution code), and whether a console window flashes during hooks.

## macOS pilot evidence, 2026-10-06

Signed release v0.6.0 (tag verified by GitHub, Developer ID-signed in CI),
installed on macOS ARM64 from `marketplace-pilot` (`9718ff1`) with
`copilot plugin marketplace add upld-internal/burnrate-copilot#marketplace-pilot`
into a profile cleaned of earlier Burnrate plugins, Keychain entries, shell
variables and local data. Copilot CLI listed the skills as
`/burnrate-copilot:burnrate-setup` and `/burnrate-copilot:setup-langfuse`.

- The skill's setup command failed (`PLUGIN_ROOT: parameter null or not set`);
  fixed in 0.6.1. Running the packaged binary's `setup` directly stored the
  shared project in Keychain, wrote the `~/.zshrc` block and derived
  `upland-human-bripley`.
- Interactive session `38937727` in a fresh terminal: all Burnrate hooks
  succeeded in 24-286 ms (host-measured). Trace
  `e7b9fab79612b5da684c30234860f65b` read back on
  `feature/ABC-123-mac-pilot` / `ABC-123`; after a branch change in another
  terminal, trace `4b7279dda35efb3e72335743f691f37e` read back on
  `feature/ABC-456-mac-second` / `ABC-456`. Both were `Copilot Turn` with
  `userId=upland-human-bripley`, `harness=copilot_cli`,
  `git_repository=upld-internal/burnrate-copilot`, snake_case keys, no content,
  and exactly one attribution span under the native root. The Esc-aborted turn
  delivered no `agentStop` and produced no attribution.
