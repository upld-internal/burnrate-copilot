# /copilot-hud:configure

Interactively configure the copilot-hud widget layout. Writes to the hud config file.

## Instructions

### 1. Resolve paths

Determine the Copilot config directory:
- If `COPILOT_HOME` is set, use its value. Otherwise use `~/.copilot`.

The hud config file is at: `$COPILOT_DIR/hud-costs/config.json`

### 2. Read the current config

If the config file exists and is valid JSON, load it. Otherwise start from the
default (shown below under **Standard** preset).

Show the user:
```
Current copilot-hud config: <path to config.json>
  powerline: <true|false>
  theme:     <theme name>
  separator: "<char>"
  segments:  <count> widget(s)
```

### 3. Offer preset selection

Ask the user which preset or option they want:

**a) Minimal** — just essentials, one quick glance
```
[Model] │ [Context %] │ [Duration]
```
Config:
```json
{
  "powerline": false,
  "theme": "default",
  "separator": "│",
  "segments": [
    { "widget": "model_name", "short": true },
    { "widget": "separator" },
    { "widget": "context_window" },
    { "widget": "separator" },
    { "widget": "session_duration" }
  ]
}
```

**b) Standard** (default) — balanced display of key metrics
```
[Model] │ [Ctx%] │ [in/out/cache] │ [tok/s] │ [premium] │ [Duration]
```
Config:
```json
{
  "powerline": false,
  "theme": "default",
  "separator": "│",
  "segments": [
    { "widget": "model_name", "short": true },
    { "widget": "separator" },
    { "widget": "context_window" },
    { "widget": "separator" },
    { "widget": "token_breakdown", "show_cache": false },
    { "widget": "separator" },
    { "widget": "output_speed" },
    { "widget": "separator" },
    { "widget": "premium_requests" },
    { "widget": "separator" },
    { "widget": "session_duration" }
  ]
}
```

**c) Full** — everything including git and tool activity
```
[Model] │ [Ctx%] │ [in/out/cache] │ [tok/s] │ [premium] │ [+lines/-lines] │ [branch] │ [git] │ [tools] │ [Duration]
```
Config:
```json
{
  "powerline": false,
  "theme": "default",
  "separator": "│",
  "segments": [
    { "widget": "model_name", "short": true },
    { "widget": "separator" },
    { "widget": "context_window" },
    { "widget": "separator" },
    { "widget": "token_breakdown", "show_cache": true },
    { "widget": "separator" },
    { "widget": "output_speed" },
    { "widget": "separator" },
    { "widget": "premium_requests" },
    { "widget": "separator" },
    { "widget": "lines_changed" },
    { "widget": "separator" },
    { "widget": "git_branch" },
    { "widget": "separator" },
    { "widget": "git_status" },
    { "widget": "separator" },
    { "widget": "tool_activity" },
    { "widget": "separator" },
    { "widget": "session_duration" }
  ]
}
```

**d) Powerline** — standard layout with Powerline arrow styling (requires Nerd Font)
Same segments as **Standard** but with `"powerline": true`. Ask the user which theme they want:
- `default` — dark grays (works in any terminal)
- `nord` — Arctic blues and teals
- `dracula` — Dracula purples and pinks
- `catppuccin` — Catppuccin Mocha warm tones
- `minimal` — no background colors (no Nerd Font required)

**e) Custom** — fine-grained configuration (see step 4)

**f) Keep current** — exit without changes

### 4. Custom configuration (only if option e is selected)

Walk the user through each option. Show current value. Accept their input or press Enter to keep current.

#### 4a. Separator character

Current: `"<current separator>"`
Options:
- `│` — pipe (default)
- `·` — middle dot
- `/` — slash
- ` ` — space
- (type any other character)

#### 4b. Powerline mode

Current: `<true|false>`
Enable powerline segments? (yes/no)

If yes, ask for theme (same options as step 3d).

#### 4c. Widgets to include

List all available widgets. For each, show whether it is currently included and ask yes/no:

| Widget | Description | Currently included |
|--------|-------------|-------------------|
| `model_name` | Model ID and effort level | <yes/no> |
| `session_name` | Named session label | <yes/no> |
| `context_window` | Context window usage (%, bar, or tokens) | <yes/no> |
| `token_breakdown` | Input / output / cache token totals | <yes/no> |
| `output_speed` | Token output speed (tok/s) | <yes/no> |
| `premium_requests` | Number of premium API requests used | <yes/no> |
| `last_call` | Token counts for the most recent API call | <yes/no> |
| `cache_breakdown` | Separate cache read / write totals | <yes/no> |
| `lines_changed` | Lines added and removed this session | <yes/no> |
| `git_branch` | Current git branch (with ahead/behind counts) | <yes/no> |
| `git_status` | Working tree status (clean/modified/untracked) | <yes/no> |
| `tool_activity` | Recent tool calls with status icons | <yes/no> |
| `agent_activity` | Spawned agents with type and status | <yes/no> |
| `session_duration` | Elapsed session time | <yes/no> |
| `cwd` | Current working directory | <yes/no> |

> Note: `custom_command`, `custom_text`, and `custom_symbol` widgets run arbitrary
> content and are not offered as simple toggles. Add them manually to the config
> file if needed.

After collecting yes/no answers, generate the segments array:
- Add `{ "widget": "separator" }` between each selected content widget.
- Apply any widget-specific options (e.g. `"short": true` for model_name,
  `"show_cache": true/false` for token_breakdown).

### 5. Preview (always)

Before writing, show the user a text representation of the configured layout:

```
Preview:
  [model_name] │ [context_window] │ [token_breakdown] │ ...

  powerline: <true|false>
  theme:     <theme>
  separator: "<separator>"
```

Ask: **"Save this configuration? (yes/no)"**

If no: discard changes and exit without writing.

### 6. Write the config file

Create `$COPILOT_DIR/hud-costs/` directory if it does not exist.

Write the config object to `$COPILOT_DIR/hud-costs/config.json` with 2-space
indentation.

Print a confirmation:
```
✓ Config saved: ~/.copilot/hud-costs/config.json
  <N> widget(s) configured.

Changes take effect on the next Copilot CLI turn (no restart needed).
Run /copilot-hud:setup if the statusline is not yet configured.
```
