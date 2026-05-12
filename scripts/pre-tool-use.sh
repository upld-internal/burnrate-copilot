#!/usr/bin/env bash
# pre-tool-use.sh — PreToolUse hook wrapper.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/pre-tool-use.js"
