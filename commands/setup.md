# /copilot-hud:setup

Set up copilot-hud statusline integration in GitHub Copilot CLI.

## Instructions

This command configures Copilot CLI to call the copilot-hud statusline script on every turn.
You will make the following changes:

1. **Find the plugin install directory**:
   Run `ls ~/.copilot/installed-plugins/copilot-hud/scripts/statusline.js` to confirm the plugin is installed.
   If not found, tell the user to run `copilot plugin install bripley/copilot-hud` first.

2. **Enable the experimental flag**:
   Read `~/.copilot/config.json` (create it as `{}` if it doesn't exist).
   Set `"experimental": true` in the root of the JSON object.

3. **Configure the statusLine**:
   Set the following in `~/.copilot/config.json`:
   ```json
   "statusLine": {
     "type": "command",
     "command": "node ~/.copilot/installed-plugins/copilot-hud/scripts/statusline.js"
   }
   ```
   If `statusLine` already exists, show the current value and ask the user before overwriting.

4. **Write the updated config.json** with 2-space indentation.

5. **Confirm success**:
   Print a summary of what was changed:
   - Path to config.json
   - The statusLine command configured
   - Any previous value that was replaced
   - Instructions to restart Copilot CLI for changes to take effect

> Note: The `experimental` flag is required for the `statusLine` feature to function.
> If you already use `experimental` features, this will not affect them.
