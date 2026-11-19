#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
set -eu
cd "$(dirname "$0")/../.."
root=$(pwd)
src="$root/.local/build/source-mellotron-a"
dest="$root/.local/www/mellotron-a"
test -f .local/www/simulator/dsp-worklet.js || { echo 'Run sh scripts/build-simulator.sh first.' >&2; exit 1; }
python3 scripts/prepare-wasm-source.py --voices 256 --daw --mellotron-probe
zig=${ZIG:-$(".tools/venv/bin/python" -c 'import pathlib, ziglang; print(pathlib.Path(ziglang.__file__).parent / "zig")')}
export ZIG_GLOBAL_CACHE_DIR="$root/.tools/zig-cache"
"$zig" cc --target=wasm32-freestanding -mcpu=generic+bulk_memory -O2 \
  '-DAPP_VER="1.2.0"' -DOBV_EXPERIMENTAL=1 -DWASWAN_VOICES=256 \
  "-DWASWAN_SIM_SOURCE=\"$src/web/sim/sim.c\"" -fno-builtin -ffreestanding -nostdlib \
  -Wno-unused-function -Wno-unused-variable -Wno-unused-but-set-variable \
  -I"$src/firmware/src" -I"$src/firmware/gen" \
  -Wl,--no-entry -Wl,--export-memory -Wl,--export-dynamic -Wl,-z,stack-size=262144 \
  -o .local/build/mellotron-a-raw.wasm wasm/waswan-sim.c
mkdir -p "$dest/simulator"
cp -R .local/www/simulator/. "$dest/simulator/"
"${WASM_OPT:-.tools/binaryen-version_133/bin/wasm-opt}" .local/build/mellotron-a-raw.wasm \
  --enable-bulk-memory --asyncify -O2 --strip-debug --strip-producers -o "$dest/simulator/obervave-voice.wasm"
cp tests/mellotron-a/index.html tests/mellotron-a/wav.mjs "$dest/"
python3 - <<'PY'
from pathlib import Path
base = Path('.local/www/mellotron-a/simulator')
# Inject the one-time PCM installation into the isolated copy, before the
# first process() call. All MIDI, recording and export code stays original.
def replace(name, before, after):
    path = base / name
    source = path.read_text()
    if source.count(before) != 1:
        raise RuntimeError(f'Probe integration point changed in {name}')
    path.write_text(source.replace(before, after))
replace('app.js', 'processorOptions:{wasm,store}', 'processorOptions:{wasm,store,sample:window.parent.takeProbeSample?.()}')
replace('dsp-worklet.js', 'super(options);this.enabled', '''super(options);
  const sample=options.processorOptions.sample;
  if(sample) {
    const x=this.engine.ex;
    if(!(sample.pcm instanceof Int16Array) || !x.waswan_probe_install(sample.pcm.length,sample.root)) throw Error('Invalid probe sample');
    new Int16Array(x.memory.buffer,x.waswan_probe_pcm(),sample.pcm.length).set(sample.pcm);
  }
  this.enabled''')
PY
