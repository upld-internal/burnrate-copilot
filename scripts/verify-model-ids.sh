#!/usr/bin/env bash
# verify-model-ids.sh — verify pricing.json keys against actual Copilot model.id values.
#
# Background: model.id is only available in the statusLine stdin (not in any hook).
# The statusLine only fires for interactive TUI sessions, not --prompt sessions.
# Therefore this script uses two strategies:
#
#   1. Historical analysis (default, no API calls):
#      Scans all monthly JSONL files for model IDs captured from real interactive
#      sessions. Cross-references against pricing.json keys.
#      Reports: CONFIRMED (seen in a real session) / UNSEEN (not yet encountered).
#
#   2. Accessibility test (--test flag, makes one API call per model):
#      Runs `copilot --model <id> --prompt "hi"` for each UNSEEN model.
#      If a monthly JSONL entry is created → model is ACCESSIBLE.
#      If no entry is created → NO_SESSION (not accessible or invalid ID).
#      Note: the model.id cannot be confirmed from --prompt sessions (statusLine
#      doesn't fire); the ID is assumed correct if the session runs successfully.
#
# Usage:
#   bash scripts/verify-model-ids.sh             # historical analysis only
#   bash scripts/verify-model-ids.sh --test      # also run accessibility tests
#   bash scripts/verify-model-ids.sh --list      # list pricing.json model IDs and exit
#
# Requires: node, jq
# Additional requires for --test: copilot CLI (authenticated)
# Cost for --test: ~$0.001 per tested model; < $0.10 for all 22 models

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PRICING_FILE="$REPO_ROOT/pricing.json"
DATA_DIR="${COPILOT_HOME:-$HOME/.copilot}/burnrate-copilot"
MONTHLY_DIR="$DATA_DIR/monthly"
SESSIONS_DIR="$DATA_DIR/sessions"

RUN_TESTS=0
LIST_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --test)     RUN_TESTS=1 ;;
    --list)     LIST_ONLY=1 ;;
  esac
done

# Check base dependencies
for cmd in node jq; do
  command -v "$cmd" &>/dev/null || { echo "Error: '$cmd' required but not in PATH" >&2; exit 1; }
done
if [ "$RUN_TESTS" = "1" ]; then
  command -v copilot &>/dev/null || { echo "Error: 'copilot' required for --test mode" >&2; exit 1; }
fi

# Extract model IDs from pricing.json (skip _meta and _comment_* keys)
MODEL_IDS=$(node -e "
  const p = require('$PRICING_FILE');
  Object.keys(p).filter(k => !k.startsWith('_')).forEach(k => console.log(k));
")
TOTAL=$(echo "$MODEL_IDS" | grep -c .)

if [ "$LIST_ONLY" = "1" ]; then
  echo "Model IDs in pricing.json ($TOTAL):"
  echo "$MODEL_IDS" | sed 's/^/  /'
  exit 0
fi

echo "burnrate-copilot: verify-model-ids"
echo ""

# ---------------------------------------------------------------------------
# Part 1: Historical analysis — scan monthly JSONL for confirmed model IDs
# ---------------------------------------------------------------------------
echo "=== Part 1: Historical analysis (from monthly JSONL) ==="
echo ""
printf "%-34s  %s\n" "MODEL ID" "STATUS"
printf "%-34s  %s\n" "----------------------------------" "--------------------------------"

CONFIRMED=()
UNSEEN=()

while IFS= read -r model_id; do
  [ -z "$model_id" ] && continue

  # Search all monthly JSONL files for this model ID
  FOUND=0
  if [ -d "$MONTHLY_DIR" ]; then
    for f in "$MONTHLY_DIR"/*.jsonl; do
      [ -f "$f" ] || continue
      if jq -re --arg m "$model_id" 'select(.model == $m) | .id' "$f" >/dev/null 2>&1; then
        FOUND=1
        break
      fi
    done
  fi

  if [ "$FOUND" = "1" ]; then
    printf "%-34s  %s\n" "$model_id" "✅ CONFIRMED (seen in session history)"
    CONFIRMED+=("$model_id")
  else
    printf "%-34s  %s\n" "$model_id" "⚠️  UNSEEN (not yet in session history)"
    UNSEEN+=("$model_id")
  fi

done <<< "$MODEL_IDS"

echo ""
printf "Confirmed: %d  Unseen: %d\n" "${#CONFIRMED[@]}" "${#UNSEEN[@]}"

if [ "${#UNSEEN[@]}" -gt 0 ] && [ "$RUN_TESTS" = "0" ]; then
  echo ""
  echo "Tip: run with --test to check accessibility of UNSEEN models."
  echo "     CONFIRMED models grow automatically as you use more models interactively."
fi

# ---------------------------------------------------------------------------
# Part 2: Accessibility test for UNSEEN models (--test flag only)
# ---------------------------------------------------------------------------
if [ "$RUN_TESTS" = "1" ] && [ "${#UNSEEN[@]}" -gt 0 ]; then
  echo ""
  echo "=== Part 2: Accessibility test (--prompt sessions, ~\$0.001/model) ==="
  echo ""
  printf "%-34s  %s\n" "MODEL ID" "RESULT"
  printf "%-34s  %s\n" "----------------------------------" "--------------------------------"

  ACCESSIBLE=0; NO_SESSION=0

  for model_id in "${UNSEEN[@]}"; do
    MONTH=$(date +%Y-%m)
    MONTHLY="$MONTHLY_DIR/$MONTH.jsonl"

    # Snapshot existing session IDs
    if [ -f "$MONTHLY" ]; then
      BEFORE_IDS=$(jq -r '.id' "$MONTHLY" 2>/dev/null | sort)
    else
      BEFORE_IDS=""
    fi
    if [ -d "$SESSIONS_DIR" ]; then
      SESSIONS_BEFORE=$(ls "$SESSIONS_DIR/" 2>/dev/null | sort)
    else
      SESSIONS_BEFORE=""
    fi

    # Run a minimal session. COPILOT_ALLOW_ALL=1 is required for --prompt mode.
    # Note: sessionStart stdin for --prompt sessions does NOT include model.id,
    # so we cannot confirm the exact model.id used — only that the session ran.
    COPILOT_ALLOW_ALL=1 copilot \
      --model "$model_id" \
      --prompt "hi" \
      --no-auto-update \
      >/dev/null 2>&1 || true

    sleep 1  # let sessionEnd hook finish writing monthly JSONL

    # Detect new monthly JSONL entry
    FOUND_SESSION=0
    if [ -f "$MONTHLY" ]; then
      AFTER_IDS=$(jq -r '.id' "$MONTHLY" 2>/dev/null | sort)
      if [ -z "$BEFORE_IDS" ]; then
        NEW_ID=$(echo "$AFTER_IDS" | head -1)
      else
        NEW_ID=$(comm -13 <(echo "$BEFORE_IDS") <(echo "$AFTER_IDS") | head -1)
      fi
      [ -n "$NEW_ID" ] && FOUND_SESSION=1
    fi

    # Also check for orphan session file (sessionEnd didn't fire)
    if [ "$FOUND_SESSION" = "0" ] && [ -d "$SESSIONS_DIR" ]; then
      SESSIONS_AFTER=$(ls "$SESSIONS_DIR/" 2>/dev/null | sort)
      if [ -z "$SESSIONS_BEFORE" ]; then
        NEW_SESSION_FILE=$(echo "$SESSIONS_AFTER" | head -1)
      else
        NEW_SESSION_FILE=$(comm -13 <(echo "$SESSIONS_BEFORE") <(echo "$SESSIONS_AFTER") | head -1)
      fi
      if [ -n "$NEW_SESSION_FILE" ]; then
        FOUND_SESSION=1
        rm -f "$SESSIONS_DIR/$NEW_SESSION_FILE"  # clean up orphan
      fi
    fi

    if [ "$FOUND_SESSION" = "1" ]; then
      printf "%-34s  %s\n" "$model_id" "✅ ACCESSIBLE (session ran; ID assumed correct)"
      ACCESSIBLE=$((ACCESSIBLE + 1))
    else
      printf "%-34s  %s\n" "$model_id" "❌ NO_SESSION — not accessible or ID unrecognized"
      NO_SESSION=$((NO_SESSION + 1))
    fi

  done

  echo ""
  printf "Accessible: %d  No session: %d\n" "$ACCESSIBLE" "$NO_SESSION"
  echo ""
  if [ "$NO_SESSION" -gt 0 ]; then
    echo "NO_SESSION: model may not be accessible on your Copilot plan, or the"
    echo "            pricing.json key may not match the model ID Copilot expects."
  fi
  echo ""
  echo "Note: accessibility tests cannot confirm the exact model.id sent in the"
  echo "      statusLine payload. Use models interactively to build CONFIRMED history."
fi
