#!/usr/bin/env bash
# session-start.sh — SessionStart hook wrapper.
# PLUGIN_ROOT is set by Copilot for plugin installs; fall back to script's own dir.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/session-start.js"
