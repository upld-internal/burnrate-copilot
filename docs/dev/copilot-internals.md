# Copilot CLI — Implementation Notes

> **Why this file exists:** The `STATUS_LINE`, hooks, and plugin features are all
> labelled "experimental" and "not stable" by GitHub Copilot CLI. They may change
> or be removed without notice. This document captures how everything worked as of
> **Copilot CLI v1.0.46 (May 2026)** — with source-code references where possible —
> so we can detect and adapt to breaking changes.

---

## Table of Contents

1. [Experimental Mode](#1-experimental-mode)
2. [Feature Flags](#2-feature-flags)
3. [StatusLine / Footer Feature](#3-statusline--footer-feature)
4. [Plugin Architecture](#4-plugin-architecture)
5. [Hook System](#5-hook-system)
6. [Hook Stdin Schemas](#6-hook-stdin-schemas)
7. [Settings.json Reference](#7-settingsjson-reference)
8. [File Locations](#8-file-locations)
9. [Debugging](#9-debugging)
10. [Known Gotchas](#10-known-gotchas)

---

## 1. Experimental Mode

### Enabling

```bash
copilot --experimental        # start session with experimental features enabled
```

Inside a session:
```
/experimental on              # enable within current session
/experimental off             # disable
/experimental show            # list all experimental features and their status
```

### What `--experimental` does

The flag sets `isExperimental: true` in the session options. This flows into the
feature flag resolution pipeline (see §2). Feature flags with the `"experimental"`
availability level become `true` when `isExperimental` is true.

As of v1.0.46, the following features are gated at `"experimental"` level:
- `STATUS_LINE` — custom statusline via user-defined script
- `ASK_USER_ELICITATION` — structured form-based ask-user tool
- `MULTI_TURN_AGENTS` — agents that persist across multiple turns
- `EXTENSIONS` — programmatic tools/hooks via `@github/copilot-sdk`
- `BACKGROUND_SESSIONS` — concurrent background sessions
- `RUBBER_DUCK_AGENT` — rubber-duck feedback agent (Claude/GPT only)
- `PROMPT_FRAME` — UI frame around input prompt
- `MCP_TASKS` — MCP tasks (spec 2025-11-25)

The full list is shown by `/experimental show` and is subject to change.

### Settings-based enablement

```json
{ "experimental": true }
```

Adding `"experimental": true` to `~/.copilot/settings.json` is equivalent to
always starting with `--experimental`. The flag is picked up during session
creation and sets `isExperimental: true` the same way.

---

## 2. Feature Flags

### Resolution pipeline (source-verified, v1.0.46)

Feature flags are resolved in four stages, applied in order:

```
1. ZBt(isStaff, isExperimental, isTeam)   — base resolution from role/mode
2. XBt(flags)                              — environment variable overrides
3. eLt(config, flags)                      — config file overrides (if any)
4. flagOverrides object                    — direct overrides (programmatic)
```

#### Stage 1: `ZBt` — role-based defaults

The internal map `u1e` assigns each flag a "level":

| Level | Enabled when |
|-------|-------------|
| `"on"` | Always |
| `"off"` | Never |
| `"experimental"` | `isExperimental` is true |
| `"staff"` | `isStaff` is true |
| `"team"` | `isTeam` is true |
| `"staff-or-experimental"` | `isStaff` OR `isExperimental` is true |

`STATUS_LINE` has level `"experimental"` → enabled when using `--experimental`.

#### Stage 2: `XBt` — environment variable overrides

Two mechanisms work here, checked every startup:

```bash
# Comma-separated list (enables flags by name, case-insensitive)
COPILOT_CLI_ENABLED_FEATURE_FLAGS=STATUS_LINE,MULTI_TURN_AGENTS copilot

# Individual flag env vars
STATUS_LINE=true copilot     # enable
STATUS_LINE=false copilot    # force disable even if experimental
```

The `KBt` function normalises flag names case-insensitively, so
`status_line`, `STATUS_LINE`, and `Status_Line` all resolve to `STATUS_LINE`.

#### Stage 3: `eLt` — config overrides

The `config` object (derived from settings.json) can enable flags via two keys:

```json
{ "enabledFeatureFlags": { "STATUS_LINE": true } }
```

or:

```json
{ "feature_flags": { "enabled": ["STATUS_LINE"] } }
```

⚠️ **Important:** The key is `enabledFeatureFlags`, NOT `featureFlags`. As of
v1.0.46, `settings.json` uses `featureFlags` for a different code path (the
`oi()` utility function) that is NOT the feature flag service. Adding
`featureFlags: { STATUS_LINE: true }` to settings.json does NOT reliably enable
the flag through the service — use `--experimental` or an env var instead.

#### Stage 4: `flagOverrides`

A map `{ FLAG_NAME: boolean }` passed programmatically to the session creator.
Not user-configurable via settings.json.

### Checking flags in-session

```
/experimental show
```

Shows all experimental features and whether they are currently active. Does not
show non-experimental flags.

---

## 3. StatusLine / Footer Feature

### How it works (source-verified, v1.0.46)

The custom statusline is rendered by the React component `R5o` in `app.js`.

**Gate condition:**
```js
isEnabled = featureFlags.STATUS_LINE && config.footer?.showCustom !== false
```

Both conditions must be true:
1. `STATUS_LINE` feature flag is active (requires `--experimental` or env var)
2. `footer.showCustom` in settings.json is not `false` (default: `true` when absent)

**Render loop:**
- `R5o` is a React hook that fires on every relevant state change (model change,
  token count update, context window update, etc.)
- Output is debounced: fires at most once per 200ms, waits at most 500ms
- The rendered text appears as the `custom` widget slot in the built-in footer bar

**Command execution (`RBa` function):**

```js
async function RBa({ statusObject, config, setStatusLine }) {
  const commandPath = expandHome(expandEnvVars(config.statusLine?.command));
  if (fs.existsSync(commandPath)) {
    const output = await PBa(commandPath, statusObject);
    setStatusLine(output.trim());
  } else {
    setStatusLine("");   // ← silently empty if file not found
  }
}
```

**Key facts about command execution:**
1. The `command` field is a **file path**, not a shell command string.
   `existsSync(command)` is called first — if it fails, output is silently empty.
2. The process is spawned with `shell: false` on macOS/Linux. No shell expansion.
3. The file **must be executable** (`chmod +x`). The OS uses the shebang to invoke
   the interpreter (`#!/usr/bin/env node`, `#!/bin/bash`, etc.).
4. Do NOT use `node /path/to/script.js` — it fails `existsSync` (no such file).
5. Timeout is **10 seconds** — the process is killed with SIGTERM on timeout.
6. The status object is written to **stdin** as JSON.
7. Stdout is read and set as the statusline text (trimmed).
8. Multi-line output is supported; each line is padded if `statusLine.padding` is set.
9. Stderr is captured but discarded on success; logged to debug on non-zero exit.

**Settings.json configuration:**
```json
{
  "statusLine": {
    "type": "command",
    "command": "/path/to/your/statusline-script",
    "padding": 0
  },
  "footer": {
    "showCustom": true
  },
  "experimental": true
}
```

### StatusLine stdin schema

The complete JSON object passed to stdin on every call (confirmed with real session
data from v1.0.46):

```json
{
  "cwd": "/Users/username/project",
  "session_id": "a90725b0-ff9d-4017-ae04-3d523a63dc1a",
  "session_name": "Session Name (if named)",
  "transcript_path": "/Users/username/.copilot/session-state/<session_id>",
  "model": {
    "id": "claude-sonnet-4.6",
    "display_name": "claude-sonnet-4.6 (high)"
  },
  "workspace": {
    "current_dir": "/Users/username/project"
  },
  "username": "github-username",
  "remote": {
    "connected": false
  },
  "version": "1.0.46",
  "cost": {
    "total_api_duration_ms": 4717,
    "total_lines_added": 0,
    "total_lines_removed": 0,
    "total_duration_ms": 142578,
    "total_premium_requests": 1
  },
  "context_window": {
    "total_input_tokens": 70280,
    "total_output_tokens": 97,
    "total_cache_read_tokens": 35089,
    "total_cache_write_tokens": 35187,
    "total_reasoning_tokens": 0,
    "total_tokens": 70377,
    "context_window_size": 200000,
    "used_percentage": 18,
    "remaining_percentage": 82,
    "remaining_tokens": 164797,
    "last_call_input_tokens": 35188,
    "last_call_output_tokens": 15,
    "current_context_tokens": 35352,
    "displayed_context_limit": 200000,
    "current_context_used_percentage": 18,
    "current_usage": {
      "input_tokens": 70280,
      "output_tokens": 97,
      "cache_creation_input_tokens": 35187,
      "cache_read_input_tokens": 35089
    }
  }
}
```

**Field notes:**
- `session_id` — snake_case. Hook scripts receive the same ID as `sessionId`
  (camelCase) in their stdin — handle both.
- `model.display_name` — format: `"claude-sonnet-4.6 (high)"`. The effort level
  is in parentheses at the end: `(low|medium|high|default)`. Multipliers appear
  as `(Nx)` before the effort: `"claude-sonnet-4.6 (3x) (high)"`.
- `cost.total_duration_ms` — wall-clock session time in milliseconds (not API time).
- `cost.total_api_duration_ms` — cumulative time spent waiting for model responses.
- `cost.total_premium_requests` — number of times the user consumed a premium API
  request (Copilot quota). Useful as a proxy for cost until pricing is available.
- `context_window.used_percentage` — percentage of max context window used by the
  last API call (last_call_input + last_call_output vs context_window_size).
- `context_window.current_context_used_percentage` — same value as `used_percentage`
  in practice; may differ in edge cases.
- `context_window.current_context_tokens` — token count of the current context.
- `context_window.displayed_context_limit` — the limit shown to users; equals
  `context_window_size` in most cases.
- `remote.connected` — `true` when running as a cloud/remote session with a task.

**When connected remotely, `remote` has additional fields:**
```json
{
  "connected": true,
  "indicator": "☁",
  "task_id": "...",
  "task_name": "...",
  "task_url": "...",
  "task_type": "...",
  "repository": "...",
  "pull_request_number": 42,
  "context": { ... }
}
```

### Built-in footer widgets

The built-in statusline has these configurable widgets (controlled via
`/statusline` or `footer.*` in settings.json):

| Widget key | settings.json key | Description |
|-----------|------------------|-------------|
| directory | `showDirectory` | Current working directory |
| branch | `showBranch` | Current git branch |
| effort | `showModelEffort` | Model + reasoning effort level |
| context-used | `showContextWindow` | Context window usage % |
| quota | `showQuota` | Remaining daily request quota |
| agent | `showAgent` | Active custom agent name |
| changes | `showCodeChanges` | Lines added/removed this session |
| username | `showUsername` | GitHub username |
| custom | `showCustom` | Output of `statusLine.command` |

The `custom` widget appears **last**, after all other widgets, on a **separate
line** below the standard footer bar. It does not replace the built-in widgets.

### Capturing real stdin for debugging

Temporarily enable debug capture in the script and check the output:

```js
// In statusline.js, temporarily force DEBUG:
const DEBUG = true;
// Output goes to: ~/.copilot/plugin-data/burnrate-copilot/stdin-debug.jsonl
```

Or use a wrapper script that logs stdin before passing it on.

---

## 4. Plugin Architecture

### Directory structure

```
plugin-name/
├── plugin.json          # plugin manifest
├── hooks.json           # hook declarations (referenced from plugin.json)
├── commands/            # slash command implementations
│   └── setup.js         # /plugin-name:setup command
├── scripts/             # hook scripts and utilities
│   ├── session-start.sh
│   ├── session-start.js
│   └── ...
└── ...
```

### plugin.json

```json
{
  "name": "burnrate-copilot",
  "description": "...",
  "version": "0.1.0",
  "author": { "name": "username" },
  "license": "MIT",
  "keywords": ["hud", "statusline"],
  "category": "productivity",
  "commands": "commands/",
  "hooks": "hooks.json"
}
```

Key fields:
- `commands` — path to directory containing slash command files
- `hooks` — path to hooks declaration file (relative to plugin root)

### Installing a local plugin

```bash
# Create the installed-plugins directory
mkdir -p ~/.copilot/installed-plugins/local

# Symlink the plugin directory
ln -sf /path/to/your/plugin ~/.copilot/installed-plugins/local/plugin-name

# Register in ~/.copilot/settings.json
{
  "enabledPlugins": { "plugin-name@local": true },
  "installed_plugins": [{
    "name": "plugin-name",
    "marketplace": "local",
    "installed_at": "2026-05-12T21:40:07.000Z",
    "enabled": true,
    "cache_path": "/Users/username/.copilot/installed-plugins/local/plugin-name"
  }]
}
```

⚠️ Both `enabledPlugins` (camelCase) AND `installed_plugins` (snake_case) must
be present. The plugin loader reads `installedPlugins` from `~/.copilot/config.json`
(auto-managed) in addition to `installed_plugins` from settings.json.

### `PLUGIN_ROOT` variable

When Copilot loads hook commands from `hooks.json`, it expands `${PLUGIN_ROOT}`
to the plugin's `cache_path`. For a local plugin via symlink, this resolves to
the symlink path (not the real path). However, bash scripts that use `readlink`
or `realpath` will correctly resolve through the symlink to the actual source.

This works correctly in practice:
```json
{ "bash": "${PLUGIN_ROOT}/scripts/session-start.sh" }
```

---

## 5. Hook System

### Hook loading order (source-verified, v1.0.46)

```
1. loadAllHooks() — called during createSession()
   ├── Y4e()  — scans ~/.copilot/hooks/*.json (user-level hooks)
   ├── hir()  — loads plugin hooks from each installedPlugin's hooks.json
   └── vdt()  — merges all hook sources

2. loadDeferredRepoHooks() — called later, async
   └── Scans .github/hooks/*.json (repo-level hooks)
```

**Key facts about hook loading:**
- `~/.copilot/hooks/*.json` — user-level, always loaded
- Plugin `hooks.json` (via `PLUGIN_ROOT`) — loaded with session, via `hir()`
- `.github/hooks/*.json` — repo-level, loaded deferred (slightly after session start)
- `hooks` key inline in settings.json — also processed
- ALL hook lifecycle log messages are at **DEBUG level only**. Without
  `logLevel: "debug"` in settings.json, there is zero visible evidence that
  hooks are running even when they work perfectly.

### hooks.json format

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "${PLUGIN_ROOT}/scripts/session-start.sh",
        "timeoutSec": 5
      }
    ],
    "userPromptSubmitted": [{ "bash": "${PLUGIN_ROOT}/scripts/user-prompt.sh", "timeoutSec": 5 }],
    "preToolUse":          [{ "bash": "${PLUGIN_ROOT}/scripts/pre-tool-use.sh", "timeoutSec": 5 }],
    "postToolUse":         [{ "bash": "${PLUGIN_ROOT}/scripts/post-tool-use.sh", "timeoutSec": 5 }],
    "sessionEnd":          [{ "bash": "${PLUGIN_ROOT}/scripts/session-end.sh",  "timeoutSec": 5 }]
  }
}
```

**Hook fields:**
- `type` — always `"command"` for shell/script hooks
- `bash` — path to the executable (can use `${PLUGIN_ROOT}`)
- `timeoutSec` — kill timeout; should be short (hooks block the session)
- `"type": "command"` may be optional (implied); "command" is the only known type

### Available hook events (v1.0.46)

| Event | When it fires |
|-------|---------------|
| `sessionStart` | Once at session creation |
| `userPromptSubmitted` | Each time the user sends a message |
| `preToolUse` | Before each tool call |
| `postToolUse` | After each tool call |
| `sessionEnd` | When the session exits (not called on crash) |

### Hook execution details

- Hooks are called as **separate processes** (not shell pipelines)
- Stdin is a JSON object (see §6 for per-event schemas)
- Stdout is discarded
- Stderr is captured to debug logs
- Non-zero exit codes are logged at DEBUG level but do not interrupt the session
- Hooks run **synchronously** with respect to the event — a slow hook delays the
  session (keep timeouts short)
- `preToolUse` and `postToolUse` fire for **every** tool, including internal ones
  (`report_intent`, `thinking`, `task_complete`, etc.)

---

## 6. Hook Stdin Schemas

All schemas confirmed against real session data. Fields may be added in future
versions; schemas should be parsed defensively.

### `sessionStart`

```json
{
  "sessionId": "a90725b0-ff9d-4017-ae04-3d523a63dc1a",
  "cwd": "/path/to/project",
  "model": {
    "id": "claude-sonnet-4.6",
    "display_name": "claude-sonnet-4.6 (high)"
  }
}
```

**Note:** `sessionId` is **camelCase** in hook stdin, but `session_id`
(snake_case) in the statusLine stdin. Handle both when writing hook scripts.

### `userPromptSubmitted`

```json
{
  "prompt": "the user's message text",
  "timestamp": 1715648745000
}
```

`timestamp` is a Unix millisecond timestamp.

### `preToolUse`

```json
{
  "toolName": "bash",
  "toolArgs": {
    "command": "ls -la",
    "description": "List files"
  },
  "timestamp": 1715648746000
}
```

`toolArgs` structure varies by tool. Common tools:
- `bash` / `shell` — `{ command, description }`
- `edit` — `{ path, old_str, new_str }`
- `view` — `{ path, view_range }`
- `create` — `{ path, file_text }`
- `task` (agent spawn) — `{ name, prompt, agent_type, ... }`
- `read_agent` — `{ agent_id }`

### `postToolUse`

```json
{
  "toolName": "bash",
  "toolResult": {
    "resultType": "success"
  },
  "timestamp": 1715648747000
}
```

`resultType` values: `"success"` | `"failure"` | `"denied"`

### `sessionEnd`

```json
{
  "sessionId": "a90725b0-ff9d-4017-ae04-3d523a63dc1a"
}
```

Only the session ID is provided. All token/cost data must come from the session
file (which the statusLine compositor writes on every turn via `last_known_tokens`).

---

## 7. Settings.json Reference

File: `~/.copilot/settings.json`

```json
{
  "experimental": true,

  "statusLine": {
    "type": "command",
    "command": "/path/to/executable-script",
    "padding": 0
  },

  "footer": {
    "showModelEffort": true,
    "showDirectory": true,
    "showBranch": true,
    "showContextWindow": true,
    "showQuota": true,
    "showAgent": true,
    "showCodeChanges": true,
    "showUsername": true,
    "showCustom": true
  },

  "enabledPlugins": {
    "plugin-name@marketplace": true
  },

  "installed_plugins": [
    {
      "name": "plugin-name",
      "marketplace": "local",
      "installed_at": "2026-05-12T21:40:07.000Z",
      "enabled": true,
      "cache_path": "/Users/username/.copilot/installed-plugins/local/plugin-name"
    }
  ],

  "featureFlags": {
    "STATUS_LINE": true
  },

  "logLevel": "debug",

  "trusted_folders": ["/Users/username"],

  "firstLaunchAt": "2026-04-14T02:33:31.269Z",

  "effortLevel": "high"
}
```

**Important notes:**
- `featureFlags.STATUS_LINE: true` — appears to be read by a separate code path
  (`oi()` function) for some settings but does NOT reliably drive the feature flag
  service. Use `--experimental` or env vars for reliable flag activation.
- `statusLine.command` — must be a **file path** to an executable, not a shell
  command. `"node /path/to/script.js"` will NOT work (fails `existsSync` check).
- `statusLine.padding` — each line of output is left-padded by this many spaces.
- `logLevel: "debug"` — enables verbose debug logging including hook lifecycle.
  Remove after debugging (produces very large log files).

---

## 8. File Locations

| Path | Description |
|------|-------------|
| `~/.copilot/settings.json` | User settings (manually edited) |
| `~/.copilot/config.json` | Auto-managed by Copilot; do not edit directly |
| `~/.copilot/hooks/*.json` | User-level hook declarations |
| `~/.copilot/installed-plugins/` | Plugin cache directory |
| `~/.copilot/installed-plugins/local/<name>` | Symlink for local plugins |
| `~/.copilot/logs/process-<ts>-<pid>.log` | Session log files |
| `~/.copilot/session-state/<session_id>/` | Session transcript and state |
| `~/.copilot/plugin-data/burnrate-copilot/` | burnrate-copilot data directory |
| `~/.copilot/plugin-data/burnrate-copilot/sessions/<uuid>.json` | Per-session token snapshot |
| `~/.copilot/plugin-data/burnrate-copilot/monthly/<YYYY-MM>.jsonl` | Monthly cost records |
| `~/.copilot/plugin-data/burnrate-copilot/config.json` | burnrate-copilot widget config |
| `~/.copilot/hud-state.json` | Live state updated by hook scripts |
| `.github/hooks/*.json` | Repo-level hook declarations |

---

## 9. Debugging

### Enable debug logging

Add to `~/.copilot/settings.json`:
```json
{ "logLevel": "debug" }
```

Remove after debugging — log files are large (100-200KB per session at debug level
vs ~6KB at info level).

### Reading logs

```bash
# Find the most recent log
ls -lt ~/.copilot/logs/ | head -5

# Check if hooks are loading and firing
LOGFILE=~/.copilot/logs/process-TIMESTAMP-PID.log
grep -i 'hook\|plugin.*loaded\|Loaded.*hook' "$LOGFILE"

# See hook executions
grep -i 'Executing hook\|hook.*script' "$LOGFILE"
```

Expected log lines when hooks work (DEBUG level only):
```
[DEBUG] Loaded 6 hook(s) from 2 plugin(s)
[DEBUG] Executing hook: /path/to/session-start.sh
[DEBUG] Spawned status line script: pid=12345
```

### Capturing statusLine stdin

Temporarily force debug capture in `scripts/statusline.js`:
```js
const DEBUG = true;  // was: process.env.COPILOT_HUD_DEBUG === '1'
```

Then read `~/.copilot/plugin-data/burnrate-copilot/stdin-debug.jsonl`.

### Testing statusLine manually

```bash
# Test with a crafted payload
echo '{"session_id":"test","cwd":"/path","model":{"id":"claude-sonnet-4.6","display_name":"claude-sonnet-4.6 (high)"},"context_window":{"total_input_tokens":50000,"total_output_tokens":1000,"used_percentage":25},"cost":{"total_api_duration_ms":5000,"total_premium_requests":2,"total_duration_ms":120000,"total_lines_added":0,"total_lines_removed":0},"version":"1.0.46","remote":{"connected":false}}' \
  | /path/to/scripts/statusline.js

# Test with real captured data
tail -1 ~/.copilot/plugin-data/burnrate-copilot/stdin-debug.jsonl | \
  python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d['data']))" | \
  /path/to/scripts/statusline.js
```

### Verifying hooks fire

```bash
# Quick test: add a diagnostic hook that creates a file
# In ~/.copilot/hooks/test.json:
{
  "version": 1,
  "hooks": {
    "sessionStart": [{
      "type": "command",
      "bash": "/bin/bash -c 'touch /tmp/hook-fired-$(date +%s)'"
    }]
  }
}
# Start copilot --experimental and check: ls /tmp/hook-fired-*
```

---

## 10. Known Gotchas

### The `featureFlags` vs `enabledFeatureFlags` confusion

`settings.json` has `featureFlags: { STATUS_LINE: true }`. This is read by the
`oi()` utility function for specific settings checks, but does **not** flow into
the main `FeatureFlagService.resolveFlags()` pipeline. That pipeline uses
`enabledFeatureFlags` (camelCase). For reliable flag activation, use
`--experimental` or `COPILOT_CLI_ENABLED_FEATURE_FLAGS=STATUS_LINE`.

### `statusLine.command` must be a file path

The internal code does:
```js
if (fs.existsSync(command)) { spawn(command, [], { shell: false }) }
else { setStatusLine("") }  // silently empty
```

`"node /path/to/script.js"` fails `existsSync` because no file has that literal
name. The script must be executable (`chmod +x`) and use a shebang line
(`#!/usr/bin/env node`).

### Hook log messages are invisible without debug mode

All hook activity — loading, firing, errors — is logged at DEBUG level. At the
default log level, hooks appear to do nothing even when working perfectly.

### `sessionEnd` is not called on crash/force-quit

If Copilot exits unexpectedly, `sessionEnd` never fires. The session file in
`sessions/<uuid>.json` remains on disk. The burnrate-copilot `sessionStart` hook
handles this with orphan recovery: it scans for stale session files older than
2 minutes and archives them to the monthly JSONL before deleting.

### `session_id` vs `sessionId` casing

Hook scripts receive the session ID as `sessionId` (camelCase) in their stdin.
The statusLine command receives it as `session_id` (snake_case). Both refer to
the same UUID. Handle both in any script that reads from either source.

### Hook execution blocks the UI

Hooks run synchronously with respect to the triggering event. A hook that takes
500ms adds 500ms of delay. Keep `timeoutSec` small (5 seconds) and scripts fast.

### `PLUGIN_ROOT` expands to the symlink path

For local plugins, `PLUGIN_ROOT` is the symlink path
(`~/.copilot/installed-plugins/local/plugin-name`), not the real path of the
source directory. Scripts that call `readlink -f` or `realpath` to resolve the
real path work correctly — the symlink is transparent on macOS and Linux.

### Orphaned sessions accumulate if sessionEnd never fires

After a crash, session files remain in `~/.copilot/plugin-data/burnrate-copilot/sessions/`. The
orphan recovery in `session-start.js` cleans these up at the next session start.
The 2-minute grace period prevents cleaning up a session that may be running
concurrently in another terminal window.

### The custom statusLine is a widget, not a statusline replacement

As of v1.0.46, the `custom` widget appears as an **additional line below** the
built-in footer, not as a replacement for it. The built-in footer widgets
(branch, directory, quota, model/effort, etc.) are still shown. To avoid
redundancy, the default burnrate-copilot config omits widgets that duplicate the
built-in footer (git branch, lines changed).

This may change in future versions — the feature is explicitly marked as
experimental and unstable by GitHub.

---

## 11. GitHub Copilot Billing

**Source:** https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing

### Credit system

GitHub Copilot is transitioning to a **token-based, credit-metered billing system** effective **June 1, 2026**. All Copilot plans (Free, Pro, Pro+, Business, Enterprise) include a monthly AI credit allowance; usage beyond the allowance is billed at per-token rates.

**1 AI credit = $0.01 USD.** Token costs are denominated in credits and converted to USD at that rate.

### Per-token rates for Anthropic models (per 1 million tokens)

Anthropic models include a separate cache write charge in addition to the cached input (read) rate.

| Model | Input | Cached input (read) | Cache write | Output |
|---|---|---|---|---|
| Claude Haiku 4.5 | $1.00 | $0.10 | $1.25 | $5.00 |
| Claude Sonnet 4 | $3.00 | $0.30 | $3.75 | $15.00 |
| Claude Sonnet 4.5 | $3.00 | $0.30 | $3.75 | $15.00 |
| Claude Sonnet 4.6 | $3.00 | $0.30 | $3.75 | $15.00 |
| Claude Opus 4.5 | $5.00 | $0.50 | $6.25 | $25.00 |
| Claude Opus 4.6 | $5.00 | $0.50 | $6.25 | $25.00 |
| Claude Opus 4.7 | $5.00 | $0.50 | $6.25 | $15.00 |

### Mapping stdin token fields to rate table columns

The four token fields in `stdinData.context_window` map to the rate columns as follows:

| stdin field | Rate column | Sonnet 4.6 rate |
|---|---|---|
| `total_input_tokens` | Input | $3.00 / MTok |
| `total_cache_read_tokens` | Cached input (read) | $0.30 / MTok |
| `total_cache_write_tokens` | Cache write | $3.75 / MTok |
| `total_output_tokens` | Output | $15.00 / MTok |

### Cost formula

```
cost_usd = (
  total_input_tokens       * 3.00 +
  total_cache_read_tokens  * 0.30 +
  total_cache_write_tokens * 3.75 +
  total_output_tokens      * 15.00
) / 1_000_000
```

All values are cumulative session totals. To get the session cost delta, subtract the zero-baseline snapshot captured at SessionStart before applying the formula.

### Notes

- GitHub's published per-token rates for Claude models match Anthropic's direct API rates exactly (as of May 2026).
- Code completions and Next Edit Suggestions are **not** metered in AI credits — they remain unlimited on all paid plans.
- The `total_premium_requests` field in `stdinData.cost` reflects the pre-June 2026 request-based billing model and will become less significant once token billing is active.

---

## Appendix: Relevant source symbols (v1.0.46 app.js)

| Symbol | Description |
|--------|-------------|
| `u1e` | Feature flag defaults map (`FLAG: "on"|"off"|"experimental"|...`) |
| `d1e` | Array of all flag names (keys of `u1e`) |
| `ZBt(staff, exp, team)` | Resolves `u1e` to boolean map based on role/mode |
| `XBt(flags)` | Applies `COPILOT_CLI_ENABLED_FEATURE_FLAGS` env overrides |
| `eLt(config, flags)` | Applies `config.enabledFeatureFlags` overrides |
| `KBt(name)` | Case-insensitive flag name lookup (e.g. `"status_line"` → `"STATUS_LINE"`) |
| `ffe` | Frozen defaults map (`{FLAG: u1e[FLAG]==="on"}`) |
| `R5o` | React component: custom statusLine renderer |
| `RBa` | Async fn: reads config, calls `PBa` if command file exists |
| `PBa(path, data)` | Spawns command, writes stdin JSON, returns stdout promise |
| `Y4e()` | Scans `~/.copilot/hooks/*.json` for user-level hooks |
| `hir()` | Loads plugin hooks from `installedPlugins[].cache_path/hooks.json` |
| `vdt()` | Merges hook sources into a single hook registry |
| `Gs()` | Returns `~/.copilot` dir (ignores second argument) |
| `oi(settings, flag)` | Reads `settings.featureFlags[flag]` (different from flag service) |
