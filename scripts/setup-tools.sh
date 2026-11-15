#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Ferramentas locais; não instala pacotes do sistema.
set -eu
cd "$(dirname "$0")/.."
command -v uv >/dev/null || { echo 'Instale uv ou forneça ZIG e WASM_OPT ao script de build.' >&2; exit 1; }
uv venv .tools/venv
uv pip install --python .tools/venv/bin/python ziglang==0.15.1
archive=$(mktemp /tmp/waswan-binaryen.XXXXXX.tar.gz)
trap 'rm -f "$archive"' EXIT
curl -fL https://github.com/WebAssembly/binaryen/releases/download/version_133/binaryen-version_133-x86_64-linux.tar.gz -o "$archive"
tar -xzf "$archive" -C .tools
