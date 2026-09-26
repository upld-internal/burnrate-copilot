---
name: setup-langfuse
description: Set up or check Burnrate's Langfuse integration for GitHub Copilot CLI, including the LANGFUSE_COPILOT_USER_ID trace user, and verify an attributed Copilot Turn trace.
---

# Set up Burnrate Copilot with Langfuse

Use this skill when the user asks to connect Copilot CLI traces to Langfuse, to set their Langfuse user ID, or to diagnose missing Git, Jira, or user information on `Copilot Turn` traces. Never print, echo, or ask the user to paste a Langfuse secret key into the chat.

The plugin root is two directories above this SKILL.md. Run the packaged binary from the repository the user works in. `<action>` is `langfuse-status` or `langfuse-suggest-user-id`.

macOS and Linux:

```sh
PLUGIN_ROOT='<absolute plugin root>' /bin/sh '<absolute plugin root>/hooks/run.sh' <action>
```

Windows (PowerShell), where `langfuse-status` becomes `langfuse status` and `langfuse-suggest-user-id` becomes `langfuse suggest-user-id`:

```powershell
& '<absolute plugin root>\bin\x86_64-pc-windows-msvc\burnrate-copilot.exe' langfuse status
```

## 1. Check the current state

Run `langfuse-status`. Its JSON reports `configuration` (`configured`, `not_configured`, or `invalid_configuration`), the Langfuse `host`, `user_id` when `LANGFUSE_COPILOT_USER_ID` is set, and the outcome of the last turn. `sent` means Langfuse accepted the request, not that the trace was verified.

The runner sees the environment that launched this Copilot session. Variables added to a shell profile, or set as Windows user environment variables, take effect only after the user restarts Copilot from a new terminal.

## 2. Set the Langfuse user ID

Copilot sends no user identity, so Burnrate sets the Langfuse trace user from `LANGFUSE_COPILOT_USER_ID`, the counterpart of Codex's `LANGFUSE_CODEX_USER_ID`. Skip this step when status already reports the correct `user_id`.

1. Run the same runner with `langfuse-suggest-user-id`. It returns `suggestion`: the repository's `git config user.email` only when that address is in the `uplandsoftware.com` domain, otherwise `null`.
2. If `suggestion` is an email, ask the user whether to use it as their Langfuse user ID. If they decline, ask them to type the email to use.
3. If `suggestion` is `null`, do not offer the Git email or any other guess. Ask the user to type the email to use as their Langfuse user ID.
4. With the confirmed value, offer to save it, and do so only with their consent. If they decline, show the command or line for them to use.
   - macOS and Linux: add this line to the shell profile (`~/.zshrc` for zsh, `~/.bashrc` for bash), replacing an existing `LANGFUSE_COPILOT_USER_ID` line rather than adding a second one.

     ```sh
     export LANGFUSE_COPILOT_USER_ID="<confirmed email>"
     ```

   - Windows: set a user environment variable, which replaces any earlier value and applies to newly started terminals.

     ```powershell
     [Environment]::SetEnvironmentVariable('LANGFUSE_COPILOT_USER_ID', '<confirmed email>', 'User')
     ```

## 3. Check the other variables

These must be exported in the environment that starts Copilot, and both sets must name the **same Langfuse project**:

- Copilot's exporter: `COPILOT_OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT=https://<host>/api/public/otel`, `OTEL_EXPORTER_OTLP_HEADERS` with Basic authorization and `x-langfuse-ingestion-version=4`, and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`.
- Burnrate's span: `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `BURNRATE_LANGFUSE_TURN_IO=true` for the prompt and final answer in the trace list.

When status reports `not_configured` or `invalid_configuration`, tell the user which Burnrate variables are missing and let them add the keys to their profile themselves. Only report whether a variable is set; never print its value unless it is `LANGFUSE_COPILOT_USER_ID` or `LANGFUSE_BASE_URL`.

## 4. Verify

After the user restarts Copilot, run status again and confirm `user_id`. Then have them send a turn from a Git branch and open the newest `Copilot Turn` trace in Langfuse. Check the user shown on the trace, the metadata `git_branch`, `git_repository`, `jira_key`, and `harness=copilot_cli`, and, when `BURNRATE_LANGFUSE_TURN_IO=true`, the trace input and output. If the trace cannot be checked in Langfuse, report that verification is incomplete.
