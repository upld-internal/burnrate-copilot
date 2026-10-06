#!/bin/sh
# Selects the packaged native binary for this OS and architecture.
set -eu
case "$(uname -s)" in
  Darwin) target_os=apple-darwin ;;
  Linux) target_os=unknown-linux-gnu ;;
  *) exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) target_arch=aarch64 ;;
  x86_64) target_arch=x86_64 ;;
  *) exit 1 ;;
esac
binary="${PLUGIN_ROOT:?}/bin/${target_arch}-${target_os}/burnrate-copilot"
[ -x "$binary" ] || exit 1
case "${1:-}" in
  hook|langfuse|migration|setup) action="$1"; shift; exec "$binary" "$action" "$@" ;;
  langfuse-status) exec "$binary" langfuse status ;;
  langfuse-suggest-user-id) exec "$binary" langfuse suggest-user-id ;;
  *) exec "$binary" hook "$1" ;;
esac
