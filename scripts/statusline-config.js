'use strict';
// statusline-config.js — auto-configure the Copilot CLI statusLine setting.
//
// Exports:
//   ensureStatusLineConfig(pluginRoot, copilotDir, dataDir)
//     → string|null
//
// Reads ~/.copilot/settings.json and checks whether statusLine.command is
// already pointing to this plugin's statusline script. If not, it writes the
// correct entry (and migrates any existing command into the hud config as a
// custom_command widget). Returns a notification string when a change is made,
// or null when already configured or when it cannot safely act.
//
// Called from session-start.js on every session open. Idempotent.

const fs   = require('fs');
const path = require('path');

/**
 * Compare two file paths, resolving symlinks for equality.
 * Returns true if both paths exist and resolve to the same real file.
 * Falls back to direct string comparison if realpath fails.
 */
function sameFile(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch (_) {
    return a === b;
  }
}

/**
 * Atomically write JSON to a file using a temp-file rename to avoid
 * partial writes on crash.
 */
function writeJSON(filePath, obj) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

/**
 * Load the hud config file, returning {} if absent or malformed.
 */
function loadHudConfig(hudConfigPath) {
  try {
    const raw = fs.readFileSync(hudConfigPath, 'utf8');
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch (_) {
    return {};
  }
}

/**
 * Ensure ~/.copilot/settings.json has statusLine.command pointing to our script.
 *
 * @param {string} pluginRoot   - Absolute path to the plugin install root
 *                                (PLUGIN_ROOT env var). Nothing happens if absent.
 * @param {string} copilotDir   - Copilot config directory (e.g. ~/.copilot).
 * @param {string} [dataDir]    - Plugin data directory. Used to locate hud
 *                                config.json when migrating an existing command.
 *                                Defaults to <copilotDir>/burnrate-copilot.
 * @returns {string|null}       - Notification message on change; null on no-op.
 */
function ensureStatusLineConfig(pluginRoot, copilotDir, dataDir) {
  // Safety: we must know where the plugin lives to build the command path.
  if (!pluginRoot || !copilotDir) return null;

  const ourScript    = path.join(pluginRoot, 'scripts', 'statusline.js');
  const settingsPath = path.join(copilotDir, 'settings.json');
  const hudDataDir   = dataDir || path.join(copilotDir, 'burnrate-copilot');

  // ---------------------------------------------------------------------------
  // Read current settings.json (or start empty)
  // ---------------------------------------------------------------------------
  let settings = {};
  let fileExists = false;

  if (fs.existsSync(settingsPath)) {
    fileExists = true;
    let raw;
    try {
      raw = fs.readFileSync(settingsPath, 'utf8');
    } catch (_) {
      return null; // unreadable — do nothing
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        settings = parsed;
      } else {
        return null; // valid JSON but not an object — leave it alone
      }
    } catch (_) {
      return null; // malformed JSON — do not overwrite
    }
  }

  // ---------------------------------------------------------------------------
  // Check if already pointing to our script
  // ---------------------------------------------------------------------------
  const existing = settings.statusLine;
  const currentCmd = existing && typeof existing.command === 'string'
    ? existing.command : null;

  if (currentCmd) {
    if (sameFile(currentCmd, ourScript)) {
      return null; // already configured — idempotent no-op
    }

    // A different statusline command is configured.
    // Preserve it as a custom_command widget in the hud config, then replace.
    try {
      const hudConfigPath = path.join(hudDataDir, 'config.json');
      fs.mkdirSync(hudDataDir, { recursive: true });
      const hudConfig = loadHudConfig(hudConfigPath);

      if (!Array.isArray(hudConfig.segments)) {
        hudConfig.segments = [];
      }

      // Only add the migration entry if it isn't already there.
      const alreadyMigrated = hudConfig.segments.some(
        s => s.widget === 'custom_command' && s.command === currentCmd
      );
      if (!alreadyMigrated) {
        hudConfig.segments.unshift({
          widget:  'custom_command',
          command: currentCmd,
        });
        writeJSON(hudConfigPath, hudConfig);
      }
    } catch (_) {
      // Migration failure is non-fatal — still replace the statusLine
    }

    settings.statusLine = { type: 'command', command: ourScript };
    try {
      writeJSON(settingsPath, settings);
    } catch (_) {
      return null;
    }

    return (
      `burnrate: statusLine updated (previous command preserved as custom_command widget)\n` +
      `  old: ${currentCmd}\n` +
      `  new: ${ourScript}`
    );
  }

  // ---------------------------------------------------------------------------
  // No statusLine configured — add it
  // ---------------------------------------------------------------------------
  settings.statusLine = { type: 'command', command: ourScript };
  try {
    if (!fileExists) {
      // Create directory if needed (should already exist but be safe)
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    }
    writeJSON(settingsPath, settings);
  } catch (_) {
    return null;
  }

  return `burnrate: statusLine auto-configured → ${ourScript}`;
}

module.exports = { ensureStatusLineConfig };
