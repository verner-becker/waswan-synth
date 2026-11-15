#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
upstream="$root/upstream/SMKSYNTH"
test -f "$upstream/web/sim/sim.c" || { echo 'Execute git submodule update --init.' >&2; exit 1; }
if [ -z "${ZIG:-}" ]; then
  ZIG=$("$root/.tools/venv/bin/python" -c 'import pathlib,ziglang; print(pathlib.Path(ziglang.__file__).parent / "zig")')
fi
export ZIG
export WASM_OPT="${WASM_OPT:-$root/.tools/binaryen-version_133/bin/wasm-opt}"
export ZIG_GLOBAL_CACHE_DIR="$root/.tools/zig-cache"
export SIM_VERSION=1.2.0
export SIM_OUT="$root/.local/build"
sh "$upstream/tools/build_controls_sim.sh"
mkdir -p "$root/.local/www/simulator"
cp "$upstream"/web/simulator/* "$root/.local/www/simulator/"
cp "$SIM_OUT/SMKSYNTH-$SIM_VERSION.wasm" "$root/.local/www/simulator/obervave-voice.wasm"
# A página original espera i18n.js no diretório pai.
cp "$upstream/web/site/i18n.js" "$root/.local/www/i18n.js"
cp "$upstream/LICENSE" "$root/.local/www/LICENSE.txt"
cp "$upstream/LICENSING.md" "$upstream/CREDITS.md" "$root/.local/www/"
sha256sum "$SIM_OUT/SMKSYNTH-$SIM_VERSION.wasm" "$upstream/web/simulator/obervave-voice.wasm"
echo 'Build local pronto. Execute python3 scripts/serve-simulator.py'
