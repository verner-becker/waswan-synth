#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# Empacota a UI original com o adaptador WASWAN, sem recompilar o DSP.
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
upstream="$root/upstream/SMKSYNTH"
voices="${WASWAN_VOICES:-256}"
case "$voices" in 8|16|32|64|128|256) ;; *) echo 'Etapas aceitas: 8, 16, 32, 64, 128 e o experimento de 256.' >&2; exit 1;; esac
test -f ".local/build/waswan-$voices.wasm" || { echo "Execute sh scripts/build-simulator.sh para compilar a etapa de $voices vozes." >&2; exit 1; }
mkdir -p .local/www/simulator
cp "$upstream"/web/simulator/* .local/www/simulator/
cp ".local/build/waswan-$voices.wasm" .local/www/simulator/obervave-voice.wasm
cp "$upstream/web/simulator/midi.js" .local/www/simulator/midi-original.js
cp "$upstream/web/simulator/engine.js" .local/www/simulator/engine-original.js
cp web/ui-*.js web/ui-foundation.css .local/www/simulator/
cp web/midi.js web/midi-diagnostic.js web/midi-profile.js web/midi-profile-panel.js web/midi-profile.css web/engine.js web/polyphony-panel.js web/polyphony.css web/dsp-stats.js web/dsp-worklet.js web/dsp-monitor.js web/dsp-monitor.css .local/www/simulator/
# One explicit hook in the derived app; never edit the submodule.
python3 - <<'PY'
from pathlib import Path
import json, subprocess
root = Path('.local/www/simulator')
# Preserve the pinned processor body; export its class for a host-only wrapper.
w = (root / 'worklet.js').read_text()
assert w.count('class OberVave extends') == 1
assert w.count("registerProcessor('obervave-smk37',OberVave);") == 1
(root / 'worklet-original.js').write_text(w.replace('class OberVave extends', 'export class OberVave extends').replace("registerProcessor('obervave-smk37',OberVave);", ''))
(root / 'worklet.js').write_text("// SPDX-License-Identifier: GPL-3.0-only\nimport './dsp-worklet.js';\n")
version = {'referenceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(), 'dirty':bool(subprocess.check_output(['git','status','--porcelain'],text=True).strip()), 'baseCommit':'5edc7449942703b8e893bb112657f7a024354648'}
(root / 'dsp-version.js').write_text('export const build='+json.dumps(version)+';\n')
p = root / 'app.js'
s = p.read_text()
s = "import {mountFoundation,updateFoundation} from './ui-foundation.js';\n" + s
# One shared instrument instance: the shell receives snapshots and delegates commands.
s += "\nmountFoundation({send,midi,isRunning:()=>on,getAudio:()=>({context,node,gain,muted})});\n"

anchor = 'function frame(m){state=m;'
if s.count(anchor) != 1:
    raise SystemExit('Contrato de frame upstream mudou; revisar integração de polifonia.')
s = "import {updateMidiDiagnostic} from './midi-diagnostic.js';\nimport {updateMidiProfile} from './midi-profile-panel.js';\nimport {updatePolyphony} from './polyphony-panel.js';\n" + s.replace(anchor, 'function frame(m){updateMidiDiagnostic(m);updateMidiProfile(m);updatePolyphony(m);state=m;')
receive = 'function receive({data:m}){'
assert s.count(receive) == 1
s = "import {updateDspMonitor} from './dsp-monitor.js';\n" + s.replace(receive, receive+'updateFoundation(m);updateDspMonitor(m);')
assert s.count("node.onprocessorerror=()=>log(") == 1
s = s.replace("node.onprocessorerror=()=>log(", "node.onprocessorerror=()=>{updateFoundation({t:'error',message:'Audio processor stopped'});updateDspMonitor({t:'error'});log(").replace("Reinicie o simulador.');gain=", "Reinicie o simulador.');};gain=")
p.write_text(s)
PY
python3 - <<'PYHTML'
from pathlib import Path
p=Path('.local/www/simulator/index.html')
s=p.read_text().replace('SMKSYNTH — Simulador','WASWAN Synth')
s=s.replace('<script src="../i18n.js', '<script>if(!new URLSearchParams(location.search).has("lang")){try{if(!localStorage.getItem("smksynth-language"))localStorage.setItem("smksynth-language","en");}catch{}}</script><script src="../i18n.js')
p.write_text(s)
PYHTML
cp "$upstream/web/site/i18n.js" .local/www/i18n.js
cp "$upstream/LICENSE" .local/www/LICENSE.txt
cp "$upstream/LICENSING.md" "$upstream/CREDITS.md" .local/www/
echo "Simulador de $voices vozes e perfil MIDI prontos em .local/www/simulator/"
