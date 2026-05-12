#!/usr/bin/env bash
# session-end.sh — SessionEnd hook wrapper.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "${SCRIPT_DIR}/session-end.js"
