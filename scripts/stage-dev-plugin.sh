#!/bin/sh
# Builds the host-native release binary into the plugin directory for local
# testing with `copilot --plugin-dir plugin/burnrate-copilot`. Not a release.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
target=$(rustc -vV | sed -n 's/^host: //p')
cargo build --locked --release --manifest-path "$root/Cargo.toml"
mkdir -p "$root/plugin/burnrate-copilot/bin/$target"
cp "$root/target/release/burnrate-copilot" "$root/plugin/burnrate-copilot/bin/$target/burnrate-copilot"
echo "staged plugin/burnrate-copilot/bin/$target/burnrate-copilot"
