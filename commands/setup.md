# /burnrate:setup

Configure GitHub Copilot CLI to use the copilot-hud statusline script.

## Instructions

### 1. Resolve the base directory

Determine the Copilot config directory:
- If the environment variable `COPILOT_HOME` is set, use its value.
- Otherwise use `~/.copilot` (expanded to the user's home directory).

Call this `COPILOT_DIR`.

### 2. Find the plugin install path

Check for the plugin in this order (stop at the first one where `scripts/statusline.js` exists as a file):

1. `$COPILOT_DIR/installed-plugins/local/copilot-hud/scripts/statusline.js`
2. `$COPILOT_DIR/installed-plugins/copilot-hud/scripts/statusline.js`

Print which path was found and whether it was a local or marketplace install.

If neither path contains the file, tell the user:

> copilot-hud is not installed. To install locally, run:
> ```
> mkdir -p ~/.copilot/installed-plugins/local
> ln -sf /path/to/copilot-hud ~/.copilot/installed-plugins/local/copilot-hud
> ```
> Or install from the marketplace with: `copilot plugin install bripley/copilot-hud`

Then stop.

### 3. Make the statusline script executable

Run:
```bash
chmod +x <found-path>/scripts/statusline.js
```

If this fails, report the error and stop.

### 4. Read `settings.json`

Read `$COPILOT_DIR/settings.json`:
- If the file does not exist, start with an empty object `{}`.
- If the file exists but contains invalid JSON, report:
  > `settings.json` contains invalid JSON. Please repair or delete it manually before running setup.
  Then stop.

### 5. Set `experimental: true`

Add or update `"experimental": true` at the root of the settings object.

### 6. Configure `statusLine`

If `settings.statusLine` already exists, show the current value:
```
Current statusLine config:
  type:    <current type>
  command: <current command>
```
Ask the user: **"Replace this with the copilot-hud statusline? (yes/no)"**
- If no: skip the statusLine update but continue with the other changes.
- If yes (or if no existing statusLine): set:
```json
"statusLine": {
  "type": "command",
  "command": "<full absolute path to statusline.js>"
}
```

> **Important:** The `command` must be the **full executable path** to `statusline.js`,
> not a shell command like `node /path/script.js`. The script already has a
> `#!/usr/bin/env node` shebang and will be made executable in step 3.

### 7. Ensure `footer.showCustom` is not disabled

If `settings.footer?.showCustom === false`, warn the user:
> ⚠️ `footer.showCustom` is set to `false` in your settings. The copilot-hud
> statusline will not be visible until this is changed.
> Set it to `true`? (yes/no)

If the user says yes, set `settings.footer.showCustom = true`.

### 8. Write `settings.json`

Write the updated object back to `$COPILOT_DIR/settings.json` with 2-space indentation.

### 8b. Write default `config.json` if absent

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

### 9. Print a summary

```
✓ copilot-hud setup complete

  Config file:   ~/.copilot/settings.json
  Plugin path:   <path>
  Command:       <statusline.js path>
  experimental:  true

Restart GitHub Copilot CLI for changes to take effect.
Run /burnrate:configure to customise the widget layout.
```

If any existing value was replaced, show what changed.
