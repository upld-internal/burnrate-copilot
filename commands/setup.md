# /burnrate:setup

Configure GitHub Copilot CLI to use the burnrate-copilot statusline script.

## Instructions

### 1. Resolve the base directory

Determine the Copilot config directory:
- If the environment variable `COPILOT_HOME` is set, use its value.
- Otherwise use `~/.copilot` (expanded to the user's home directory).

Call this `COPILOT_DIR`.

### 2. Find the plugin install path

Check for the plugin in this order (stop at the first one where `scripts/statusline.js` exists as a file):

1. Read `$COPILOT_DIR/config.json` and look for an entry in `installedPlugins` where `name === "burnrate-copilot"`. If found, use its `cache_path` field as the plugin root. Check if `<cache_path>/scripts/statusline.js` exists.
2. `$COPILOT_DIR/installed-plugins/local/burnrate-copilot/scripts/statusline.js`
3. `$COPILOT_DIR/installed-plugins/burnrate-copilot/scripts/statusline.js`
4. Any `$COPILOT_DIR/installed-plugins/_direct/*/scripts/statusline.js` (glob — for URL installs via `/plugin install https://...`)

Print which path was found and how the plugin was installed (URL install, local symlink, or marketplace).

If no path contains the file, tell the user:

> burnrate-copilot is not installed. Install it with:
> ```
> /plugin install https://github.com/upld-internal/burnrate-copilot.git
> ```

Then stop.

### 3. Make the statusline script executable (Unix only, best-effort)

On macOS/Linux, attempt to run:
```bash
chmod +x <found-path>/scripts/statusline.js
```

If this fails (e.g. on Windows), skip silently and continue.

### 4. Read `settings.json`

Read `$COPILOT_DIR/settings.json`:
- If the file does not exist, start with an empty object `{}`.
- If the file exists but contains invalid JSON, report:
  > `settings.json` contains invalid JSON. Please repair or delete it manually before running setup.
  Then stop.

### 5. Configure `statusLine`

If `settings.statusLine` already exists, show the current value:
```
Current statusLine config:
  type:    <current type>
  command: <current command>
```
Ask the user: **"Replace this with the burnrate-copilot statusline? (yes/no)"**
- If no: skip the statusLine update but continue with the other changes.
- If yes (or if no existing statusLine): set:
```json
"statusLine": {
  "type": "command",
  "command": "node <full absolute path to statusline.js>"
}
```

> **Note:** The command is always prefixed with `node` for cross-platform compatibility
> (Windows does not support the `#!/usr/bin/env node` shebang).

### 6. Ensure `footer.showCustom` is not disabled

If `settings.footer?.showCustom === false`, warn the user:
> ⚠️ `footer.showCustom` is set to `false` in your settings. The burnrate-copilot
> statusline will not be visible until this is changed.
> Set it to `true`? (yes/no)

If the user says yes, set `settings.footer.showCustom = true`.

### 7. Write `settings.json`

Write the updated object back to `$COPILOT_DIR/settings.json` with 2-space indentation.

### 7b. Write default `config.json` if absent

Check whether `$COPILOT_DIR/burnrate-copilot/config.json` already exists.

- If it **does not exist**: create `$COPILOT_DIR/burnrate-copilot/` if needed, then write:
```json
{
  "powerline": false,
  "theme": "default",
  "separator": "│",
  "segments": [
    { "widget": "model_name", "short": true, "show_label": true },
    { "widget": "separator" },
    { "widget": "context_window", "format": "full", "show_label": true },
    { "widget": "separator" },
    { "widget": "git_branch" },
    { "widget": "git_status" },
    { "widget": "newline" },
    { "widget": "session_cost", "show_label": true },
    { "widget": "session_duration" },
    { "widget": "separator" },
    { "widget": "mtd_cost" }
  ]
}
```
- If it **already exists**: leave it untouched (the user may have customised it).

### 8. Print a summary

```
✓ burnrate-copilot setup complete

  Config file:   ~/.copilot/settings.json
  Plugin path:   <path>
  Command:       node <statusline.js path>

Restart GitHub Copilot CLI for changes to take effect.
Run /burnrate:configure to customise the widget layout.
```

If any existing value was replaced, show what changed.
