#!/usr/bin/env bash
# user-prompt.sh — UserPromptSubmitted hook wrapper.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/user-prompt.js"
