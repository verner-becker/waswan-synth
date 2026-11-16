// SPDX-License-Identifier: GPL-3.0-only
export const MODES = [{id:0,label:'POLY'},{id:3,label:'MONO'},{id:1,label:'DUAL'},{id:2,label:'UNISON'}];
let controller, panel, latest;
const noteName = n => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12] + (Math.floor(n/12)-1);

// Shared user action for Diagnostics and the Performance surface.
export function selectVoiceMode(inputController,frame,mode) {
  if (!frame || !inputController.isRunning() || frame.midiMode || frame.engines[frame.track]!==0 || !MODES.some(m=>m.id===mode)) return false;
  inputController.release();
  inputController.send({t:'voice-mode',part:frame.track,mode});
  return true;
}

export function mountPolyphonyPanel(inputController) {
  controller = inputController;
  const instrument = document.querySelector('.instrument');
  if (!instrument) return;
  panel = document.createElement('section');
  panel.className = 'waswan-polyphony';
  panel.setAttribute('aria-label','Polifonia e modos de execução');
  panel.innerHTML = `
    <div class="voice-heading"><strong data-voice-title>WASWAN · Polifonia</strong><span data-voice-part>Parte A</span></div>
    <div class="voice-modes" role="group" aria-label="Modo de execução"></div>
    <p data-mode-help>Inicie o simulador para consultar o modo do timbre atual.</p>
    <label class="voice-unison">Vozes por nota em UNISON <select data-unison disabled aria-label="Vozes por nota em UNISON"></select></label>
    <label class="voice-unison"><input type="checkbox" data-sustain disabled> Sustain MIDI · mantém as notas após soltar as teclas</label>
    <div class="voice-heading voice-activity"><strong data-voice-count>Aguardando o motor</strong><span data-voice-free></span></div>
    <div class="voice-slots" role="group" aria-label="Vozes do motor"></div>
    <p data-voice-state>Aguardando início.</p>
    <p class="voice-hint">O pool de vozes é compartilhado entre A–D. Release também ocupa vozes. Trocar o modo libera as notas; o restante do timbre é preservado. Use SAVE no painel original se quiser guardar a edição. UNISON preserva o máximo de 8 vozes por nota.</p>
  `;
  for (const mode of MODES) {
    const button = document.createElement('button');
    button.type='button';button.textContent=mode.label;button.dataset.voiceMode=mode.id;
    button.setAttribute('aria-pressed','false');button.disabled=true;
    button.onclick=()=>selectVoiceMode(controller,latest,mode.id);
    panel.querySelector('.voice-modes').append(button);
  }
  const unison = panel.querySelector('[data-unison]');
  for (let n=1;n<=8;n++) unison.add(new Option(String(n),String(n)));
  unison.onchange=()=>{
    if (!latest || !controller.isRunning()) return;
    const count=Number(unison.value);
    controller.release();
    controller.send({t:'voice-unison',part:latest.track,count});
  };
  panel.querySelector('[data-sustain]').onchange=e=>{
    if (controller.isRunning()) controller.send({t:'voice-sustain',enabled:e.target.checked});
  };
  instrument.before(panel);
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./polyphony.css',import.meta.url).href;
  document.head.append(css);
}

export function updatePolyphony(frame) {
  if (!panel || !frame.polyphony) return;
  latest=frame;
  const state=frame.polyphony, part=state.parts[frame.track], melodic=frame.engines[frame.track]===0;
  panel.querySelector('[data-voice-title]').textContent=`WASWAN · Polifonia de ${state.limit} vozes`;
  const voiceSlots=panel.querySelector('.voice-slots');
  if (voiceSlots.children.length!==state.limit) {
    voiceSlots.replaceChildren();
    for(let i=0;i<state.limit;i++) {
      const slot=document.createElement('span');slot.className='voice-slot';slot.textContent=String(i+1);
      voiceSlots.append(slot);
    }
  }
  voiceSlots.setAttribute('aria-label',`${state.limit} vozes do motor`);
  panel.querySelector('[data-voice-part]').textContent=`Parte ${'ABCD'[frame.track]} · preset ${frame.programs[frame.track]}`;
  for (const button of panel.querySelectorAll('[data-voice-mode]')) {
    button.disabled=!melodic||frame.midiMode;
    button.setAttribute('aria-pressed',String(melodic&&Number(button.dataset.voiceMode)===part.mode));
  }
  const unison=panel.querySelector('[data-unison]');unison.value=String(part.unison);
  unison.disabled=!melodic||frame.midiMode||part.mode!==2;
  panel.querySelector('[data-sustain]').checked=state.midiSustain;
  panel.querySelector('[data-sustain]').disabled=!melodic||frame.midiMode;
  const notes=part.mode===0?Math.min(128,part.limit):part.mode===1?Math.floor(part.limit/2):1;
  const mode=MODES.find(m=>m.id===part.mode)?.label;
  panel.querySelector('[data-mode-help]').textContent=!melodic
    ? 'Esta parte usa DRUM-X; escolha uma parte ANALOG para editar POLY, MONO, DUAL ou UNISON.'
    : frame.midiMode ? 'MIDI MODE ativo: sintetizador suspenso. Volte ao modo synth no painel original.'
    : `${mode} · até ${notes} nota(s) simultânea(s) nesta parte${part.limit===5?' · SUPER limitado a 5 vozes':''}. `+
      (part.mode===0?'Uma voz por nota.':part.mode===1?'Duas vozes por nota.':part.mode===2?`${Math.min(part.unison,part.limit)} vozes sobre a mesma nota.`:'Uma nota por vez, com prioridade da última tecla.');
  const active=state.slots.filter(v=>v.active).length,gated=state.slots.filter(v=>v.active&&v.gate).length;
  panel.querySelector('[data-voice-count]').textContent=`Vozes em uso: ${active} / ${state.limit}`;
  panel.querySelector('[data-voice-free]').textContent=`Disponíveis: ${state.limit-active}`;
  panel.querySelector('[data-voice-state]').textContent=`Sustentadas: ${gated} · Em release: ${active-gated}`+
    ` · Pedal/HOLD da parte: ${part.sustain?'ligado':'desligado'}`+
    (part.arp?' · Arpejador ativo: notas podem soar em sequência.':'');
  state.slots.forEach((v,i)=>{
    const slot=panel.querySelectorAll('.voice-slot')[i];
    slot.dataset.state=!v.active?'idle':v.gate?'held':'release';
    const label=!v.active?`Voz ${i+1}: livre`:`Voz ${i+1}: ${noteName(v.note)}, parte ${'ABCD'[v.part]}, ${v.gate?'sustentada':'release'}`;
    slot.title=label;slot.setAttribute('aria-label',label);
    slot.textContent=v.active?noteName(v.note):String(i+1);
  });
}
