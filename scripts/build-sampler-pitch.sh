#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
zig="${ZIG:-}"
if [ -z "${ZIG:-}" ]; then
  zig=$("$root/.tools/venv/bin/python" -c 'import pathlib,ziglang; print(pathlib.Path(ziglang.__file__).parent / "zig")')
fi
wasm_opt="${WASM_OPT:-$root/.tools/binaryen-version_133/bin/wasm-opt}"
export ZIG_GLOBAL_CACHE_DIR="${ZIG_GLOBAL_CACHE_DIR:-$root/.tools/zig-cache}"
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT HUP INT TERM
vendor=wasm/vendor/signalsmith
mkdir -p .local/build
"$zig" c++ -target wasm32-wasi -mexec-model=reactor -std=c++17 -O3 -DNDEBUG \
  -fno-exceptions -fno-rtti -I"$vendor" wasm/sampler-pitch.cpp \
  -Wl,--export=shift_mono -Wl,--export=malloc -Wl,--export=free -Wl,--max-memory=67108864 \
  -o "$scratch/sampler-pitch.wasm"
"$wasm_opt" "$scratch/sampler-pitch.wasm" -Oz --all-features --strip-debug --strip-producers \
  -o .local/build/sampler-pitch.wasm
