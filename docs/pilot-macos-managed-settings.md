# macOS managed-settings pilot

Date: 2026-09-29
Machine: macOS ARM64, Ben Ripley's workstation
Copilot CLI: 1.0.88, auto-updated to 1.0.89 during the pilot
Release: [v0.5.0](releases/v0.5.0.md) on `marketplace-pilot`

This pilot tested the [enterprise-managed rollout design](release-and-marketplace.md#3-pilot-with-file-based-managed-settings) with a file-based `managed-settings.json` on one Mac. The file was removed after testing.

## Configuration

`/Library/Application Support/GitHubCopilot/managed-settings.json` was owned by `root:wheel` with mode 644. It contained:

- `extraKnownMarketplaces.upld-internal`: source `github`, repository `upld-internal/burnrate-copilot`, `ref` `marketplace-pilot`, and `autoUpdate: true`;
- `enabledPlugins`: `burnrate-copilot@upld-internal: true`;
- `telemetry`: the Langfuse OTLP endpoint, `http/protobuf`, `captureContent: true`, and Basic authorization with `x-langfuse-ingestion-version: 4`.

Before the file was installed, the machine had no managed file, no `com.github.copilot` MDM domain, and no server policy. The old JavaScript `burnrate-copilot` v0.1.0 was installed and enabled from a direct URL, and the user `statusLine` pointed at its `statusline.js`. The pilot tested both the user's real `~/.copilot` and a new `COPILOT_HOME` with no plugins.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Copilot reads the file | Pass | The log shows `device MDM policy loaded: keys=[enabledPlugins,extraKnownMarketplaces,telemetry]` and `effective policy resolved: source=mdm`. `upld-internal` appeared in `copilot plugin marketplace list` without a manual add. |
| `ref` selects `marketplace-pilot` | Pass | v0.5.0 installed; `main` has no catalog to install from. |
| Automatic installation | Pass for interactive sessions only | Three `copilot -p` runs, including one in the new home, installed nothing and logged no install attempt. The first interactive session installed `burnrate-copilot@upld-internal` v0.5.0, in both the new home and the real `~/.copilot`. |
| Managed telemetry replaces `OTEL_*` | Pass | With no `OTEL_*` or `COPILOT_OTEL_*` variables, Copilot logged `OpenTelemetry configured from managed settings` with prompt, response, and tool capture. Traces `198a692b74e333bf796e477613ba50e2` and `4f4edcb90678456773765a4ba790e6d9` arrived from sessions without the plugin. |
| Uninstall is blocked | Pass | `copilot plugin uninstall` failed: "required by your organization's managed settings and cannot be uninstalled". |
| Local disable is ignored | Pass, with misleading output | The managed install is recorded with `enabled: false` and listed as `[disabled]`. `copilot plugin disable` reports success, yet the plugin's hooks still ran in the next turn. |
| Hooks and trace from the managed install | Pass | See the trace below. |
| Automatic update | Not tested | Needs a later version published to `marketplace-pilot`. |

In the real `~/.copilot`, session `57c53652-6e62-4406-b510-ad53f770fa8f` ran a tool-using turn. It had no `OTEL_*` variables, but had `LANGFUSE_*`, `BURNRATE_LANGFUSE_TURN_IO`, and `LANGFUSE_COPILOT_USER_ID` in the environment. It wrote three local Burnrate records. Trace `c61b0b0379f3e3086380e7a18b0dbea8` had:

- the name `Copilot Turn`, the Copilot session ID, and user `bripley@uplandsoftware.com`;
- input set to the prompt and output `both`;
- the five cross-harness metadata keys;
- resource `service.name=github-copilot` and `service.version=1.0.89`;
- observations `invoke_agent`, `bash`, two `chat gpt-5-mini`, and one `burnrate.attribution`.

## Findings

1. **The old and new plugins run side by side.** In the same session, the old JavaScript plugin wrote its `monthly/2026-09.jsonl` record and the new plugin wrote its store records. The user `statusLine` still ran the old `statusline.js`. Every user with the old plugin will be in this state after a managed rollout, so the rollout needs a migration step that removes the old plugin and its `statusLine`.
2. **Managed plugins install only when an interactive session starts.** Users who run only `copilot -p` do not receive the plugin until they open an interactive session.
3. **The managed install shows `[disabled]` while it runs.** Pilot users should expect this.
4. **Copilot can drop its own spans when a `-p` run exits.** In session `6f1da732-6b97-4e64-98ce-0c66889dd22b`, Copilot logged `OTel host dispose did not finish within 1000ms; continuing without it`. Trace `03ea2e0f06e290de02c0946b558bb18c` then contained only the Burnrate span, with no session ID. The other `-p` runs flushed in time. This is host behavior and intermittent.
5. **The managed file exposes the Langfuse key to local accounts.** Copilot requires it root-owned and not world-writable, and it must be readable by the user, so on a shared machine other accounts can read the Langfuse key. MDM delivery avoids a readable file.
6. **Burnrate's span still needs user environment variables.** Managed settings cannot set environment variables for hooks, and Copilot hides its managed telemetry headers from them. The span worked only because the shell exported `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`.
7. **No server-managed policy exists for this account.** GitHub returned `404: no configured policy`. The enterprise rollout will create Upland's first Copilot server-managed settings. Confirm that target users are licensed through the enterprise account.

## After the pilot

The managed file was removed on 2026-09-29. Afterwards:

- the `upld-internal` marketplace was no longer registered;
- `burnrate-copilot@upld-internal` v0.5.0 stayed installed in the real `~/.copilot`, listed as `[disabled]`;
- in the next turn (session `1dfc7c72-7a20-4513-ac46-456e8292d8e7`), its hooks no longer ran: no Burnrate records;
- Copilot no longer configured OpenTelemetry;
- the old JavaScript plugin still ran and wrote its record.
