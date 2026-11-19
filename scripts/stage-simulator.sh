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
cp web/mellotron-*.js web/fm-*.js web/tone-bank.js web/ui-*.js web/ui-foundation.css .local/www/simulator/
cp web/studio-*.js .local/www/simulator/
cp web/daw-*.js web/daw-tab.html .local/www/simulator/
mkdir -p .local/www/simulator/vendor
cp -R web/vendor/lamejs .local/www/simulator/vendor/
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
midi = root / 'midi-original.js'
text = midi.read_text()
assert text.count('this.message(event.data)') == 1
midi.write_text(text.replace('this.message(event.data)', 'this.message(event.data,event.timeStamp)'))
version = {'referenceCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(), 'dirty':bool(subprocess.check_output(['git','status','--porcelain'],text=True).strip()), 'baseCommit':'5edc7449942703b8e893bb112657f7a024354648'}
(root / 'dsp-version.js').write_text('export const build='+json.dumps(version)+';\n')
p = root / 'app.js'
s = p.read_text()
# Reserve output ports at startup; workspace navigation never replaces the node.
outputs_anchor = "numberOfInputs:0,outputChannelCount:[2],processorOptions:{wasm,store}"
assert s.count(outputs_anchor) == 1
s = s.replace(outputs_anchor,"numberOfInputs:0,numberOfOutputs:17,outputChannelCount:[2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2],processorOptions:{wasm,store}")
s = "import {AudioOwner,SessionObserver} from './daw-session.js';\nconst audioOwner=new AudioOwner(),sessionObserver=new SessionObserver(audioOwner);\n" + s
# Reserve the session before creating AudioContext/WASM, for the public route.
start_anchor = "try{const audioMode=window.isSecureContext&&window.AudioWorkletNode;"
assert s.count(start_anchor) == 1
s = s.replace(start_anchor, "try{if(!await audioOwner.acquire()){starting=false;log('Audio is running in another WASWAN tab. Return to that tab or close it before starting here.');updateFoundation({t:'audio-owner-busy'});return;}if(context&&context.state!=='closed')await context.close();node?.disconnect();worker?.terminate();const audioMode=window.isSecureContext&&window.AudioWorkletNode;")
failure_anchor = "if(context)await context.close();}}"
assert s.count(failure_anchor) == 1
s = s.replace(failure_anchor, "updateFoundation({t:'audio-start-error',message:e.message});try{if(context&&context.state!=='closed')await context.close();await audioOwner.release();context=null;node=null;worker=null;}catch(cleanupError){updateFoundation({t:'audio-start-error',message:'Audio shutdown failed. Close this tab before starting another session.'});}}}")
s = "import {mountFoundation,updateFoundation} from './ui-foundation.js';\n" + s
# Losing keyboard focus releases browser-held keys only. A connected MIDI device
# must still send its own note-offs when the Mixer is brought to the foreground.
focus_anchor = "function releaseAll(){midi.release();"
assert s.count(focus_anchor) == 1
s = s.replace(focus_anchor, "function releaseAll(){midi.release();releaseBrowserKeys();}\nfunction releaseBrowserKeys(){")
s = s.replace("window.addEventListener('blur',releaseAll)", "window.addEventListener('blur',releaseBrowserKeys)")
s = s.replace("if(document.hidden)releaseAll()", "if(document.hidden)releaseBrowserKeys()")
midi_focus_anchor = "isListening:()=>!document.hidden"
assert s.count(midi_focus_anchor) == 1
s = s.replace(midi_focus_anchor, "isListening:()=>audioOwner.owned")
# Closed Bank/Tone selectors double as a performance surface. Native open
# menus keep type-ahead; search, save names and other controls keep typing.
typing_anchor = "const typing=e=>['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey;"
assert s.count(typing_anchor) == 1
s = s.replace(typing_anchor, """const supportsOpenSelect = CSS.supports('selector(select:open)');
function typing(e){
  if(e.ctrlKey||e.metaKey||e.altKey)return true;
  if(e.target.matches?.('.ww-program-picker select')){
    return supportsOpenSelect && e.target.matches(':open');
  }
  return ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(e.target.tagName);
}""")
key_anchor = "if(typing(e)||e.repeat||!on)return;"
assert s.count(key_anchor) == 1
s = s.replace(key_anchor, "if(typing(e)||e.defaultPrevented||e.repeat||!on)return;const shell=document.querySelector('.ww-shell');if(shell?.dataset.activeWorkspace==='daw'&&!e.target.closest?.('.ww-dock'))return;")
# The upstream event handlers retain private initialization nodes. Only controls
# composed by Foundation remain in the public document.
query_anchor = "const $=s=>document.querySelector(s),key="
assert s.count(query_anchor) == 1
s = s.replace(query_anchor,"const panelBackend=document.createDocumentFragment();\nconst $=s=>document.querySelector(s)||panelBackend.querySelector(s),key=")
s = s.replace("document.querySelector('.instrument').dataset.bank","$('.instrument').dataset.bank")
frame_start = "const image=$('#screen').getContext('2d'),pixels=image.createImageData(240,240);\n"
assert s.count(frame_start) == 1
s = s.replace(frame_start, "")
frame_start = "if(m.fb){for(let i=0;i<57600;i++)"
frame_end = "image.putImageData(pixels,0,0);}"
assert s.count(frame_start) == 1 and s.count(frame_end) == 1
start = s.index(frame_start)
s = s[:start] + s[s.index(frame_end,start)+len(frame_end):]
# Browser controls call the same host actions as the reference panel.
mute_anchor = "$('#mute').onclick=()=>{muted=!muted;gain.gain.setTargetAtTime(muted?0:1,context.currentTime,.01);$('#mute').textContent=muted?'Ativar som':'Silenciar';};"
assert s.count(mute_anchor) == 1
s = s.replace(mute_anchor, "function toggleOutputMute(){if(!gain||!context)return muted;muted=!muted;gain.gain.setTargetAtTime(muted?0:1,context.currentTime,.01);$('#mute').textContent=muted?'Ativar som':'Silenciar';return muted;}\n$('#mute').onclick=toggleOutputMute;")
# One shared instrument instance: the shell receives snapshots and delegates commands.
s += "\nmountFoundation({send,midi,panelBackend,actions:{start,mute:toggleOutputMute,panic:releaseAll},isRunning:()=>on,getAudio:()=>({context,node,gain,muted})});\n"

anchor = 'function frame(m){state=m;'
if s.count(anchor) != 1:
    raise SystemExit('Contrato de frame upstream mudou; revisar integração de polifonia.')
s = "import {updateMidiDiagnostic} from './midi-diagnostic.js';\nimport {updateMidiProfile} from './midi-profile-panel.js';\nimport {updatePolyphony} from './polyphony-panel.js';\n" + s.replace(anchor, 'function frame(m){updateMidiDiagnostic(m);updateMidiProfile(m);updatePolyphony(m);state=m;')
receive = 'function receive({data:m}){'
assert s.count(receive) == 1
s = "import {updateDspMonitor} from './dsp-monitor.js';\n" + s.replace(receive, receive+'sessionObserver.publish(m);updateFoundation(m);updateDspMonitor(m);')
assert s.count("node.onprocessorerror=()=>log(") == 1
s = s.replace("node.onprocessorerror=()=>log(", "node.onprocessorerror=()=>{updateFoundation({t:'error',message:'Audio processor stopped'});updateDspMonitor({t:'error'});log(").replace("Reinicie o simulador.');gain=", "Reinicie o simulador.');};gain=")
# Report the existing browser write, without a second persistence mechanism.
store_anchor = "localStorage.setItem(key,b64(store));$('#savedState')"
assert s.count(store_anchor) == 1
s = s.replace(store_anchor, "localStorage.setItem(key,b64(store));updateFoundation({t:'tone-store',ok:true,data:store});$('#savedState')")
error_anchor = "catch{log('A memória funciona nesta sessão;"
assert s.count(error_anchor) == 1
s = s.replace(error_anchor, "catch{updateFoundation({t:'tone-store',ok:false,data:store});log('A memória funciona nesta sessão;")
p.write_text(s)
PY
python3 - <<'PYHTML'
from pathlib import Path
p=Path('.local/www/simulator/index.html')
s=p.read_text().replace('SMKSYNTH — Simulador','WASWAN Synth')
assert s.count('<body>') == 1 and s.count('</main><script type="module"') == 1
s=s.replace('<body>','<body><div hidden id="waswan-bootstrap">',1).replace('</main><script type="module"','</main></div><script type="module"',1)
s=s.replace('<script src="../i18n.js', '<script>if(!new URLSearchParams(location.search).has("lang")){try{if(!localStorage.getItem("smksynth-language"))localStorage.setItem("smksynth-language","en");}catch{}}</script><script src="../i18n.js')
p.write_text(s)
PYHTML
cp "$upstream/web/site/i18n.js" .local/www/i18n.js
mkdir -p .local/www/simulator/vendor/sloopdx
cp wasm/vendor/sloopdx/NOTICE.md wasm/vendor/sloopdx/Apache-2.0.txt .local/www/simulator/vendor/sloopdx/
cp "$upstream/LICENSE" .local/www/LICENSE.txt
cp "$upstream/LICENSING.md" "$upstream/CREDITS.md" .local/www/
echo "Simulador de $voices vozes e perfil MIDI prontos em .local/www/simulator/"
