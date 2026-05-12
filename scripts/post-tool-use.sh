#!/usr/bin/env bash
# post-tool-use.sh — PostToolUse hook wrapper.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/post-tool-use.js"
