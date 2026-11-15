// SPDX-License-Identifier: GPL-3.0-only
import {TARGETS,fineTarget} from './midi-profile.js';

let activeProfile,activePanel;
export function updateMidiProfile(frame) {
  if (!activeProfile) return;
  const control=frame.knobControl;
  activeProfile.setContext(control?.context??null);
  activePanel.querySelector('[data-fine-context]').textContent=control
    ? 'Fino disponível nesta tela: '+(control.parameters.map((p,k)=>p?'K'+(k+1):null).filter(Boolean).join(', ')||'nenhum')+'. Em menus e camadas especiais, use Normal.'
    : 'Controle fino indisponível neste WASM; recompile a extensão host.';
}
export function mountProfilePanel(controller) {
  const anchor = document.querySelector('.midi-panel');
  if (!anchor) return;
  const profile = controller.profile;activeProfile=profile;
  const panel = document.createElement('details');
  panel.className = 'waswan-profile';activePanel=panel;
  panel.innerHTML = `
    <summary>WASWAN · Mapeamento de knobs e faders</summary>
    <label class="waswan-enable"><input type="checkbox" data-enabled> Ativar meu perfil MIDI</label>
    <p>Escolha o controle virtual, clique em Aprender e mova apenas um controle físico na entrada MIDI selecionada. Notas e pitch continuam funcionando.</p>
    <div class="waswan-learn">
      <label>Controle virtual <select data-target></select></label>
      <label>Mensagem do controle <select data-mode>
        <option value="absolute">Absoluta · valor de 0 a 127</option>
        <option value="offset">Relativa · 65 aumenta / 63 diminui</option>
        <option value="twos">Relativa · 1 aumenta / 127 diminui</option>
      </select></label>
      <label>Comportamento do knob <select data-behavior>
        <option value="normal">Normal · passos e aceleração originais</option>
        <option value="fine">Fino · uma unidade interna por incremento</option>
      </select></label>
      <button type="button" data-learn>Aprender controle</button>
      <button type="button" data-cancel>Cancelar</button>
    </div>
    <p data-fine-context>Inicie o motor para consultar o controle fino.</p>
    <p>Fino aplica-se aos parâmetros diretos de K1–K4, preservando a escala original. Depois de mudar página ou preset, o primeiro valor absoluto apenas estabelece a nova referência. K5–K8 e faders mantêm Normal.</p>
    <p data-status role="status" aria-live="polite"></p>
    <p>Knobs absolutos usam a diferença entre movimentos; o primeiro valor após trocar a entrada, soltar tudo ou retornar à janela estabelece a posição inicial. Faders usam o valor recebido diretamente, respeitando JUMP/CATCH do instrumento.</p>
    <p>Um CC mapeado substitui sua função original nesta porta e canal. Se mapear CC64, ele passa a controlar esse destino em vez de sustain. Desative o perfil para voltar ao comportamento original. O perfil é salvo apenas neste navegador, separado dos timbres.</p>
    <div class="waswan-table"><table><thead><tr><th>Controle virtual</th><th>Entrada / canal / CC</th><th>Formato MIDI</th><th>Comportamento</th><th>Ação</th></tr></thead><tbody></tbody></table></div>
  `;
  anchor.after(panel);
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = new URL('./midi-profile.css',import.meta.url).href;
  document.head.append(css);
  const $ = s => panel.querySelector(s);
  for (const t of TARGETS) $('[data-target]').add(new Option(t.label,t.id));
  const updateMode = () => {
    const fader = $('[data-target]').value.startsWith('fader:');
    if (fader) $('[data-mode]').value = 'absolute';
    $('[data-mode]').disabled = fader;
    const fine=fineTarget($('[data-target]').value);
    $('[data-behavior]').disabled=!fine;
    if(!fine)$('[data-behavior]').value='normal';
  };
  $('[data-target]').onchange = () => { updateMode(); profile.reset(); };
  $('[data-mode]').onchange = () => profile.reset();
  $('[data-behavior]').onchange = () => profile.reset();
  updateMode();
  $('[data-enabled]').onchange = e => {
    const enabled = e.target.checked;
    controller.release();
    profile.setEnabled(enabled);
  };
  $('[data-learn]').onclick = () => {
    if (!controller.input) {
      $('[data-status]').textContent = 'Conecte e selecione uma entrada MIDI acima antes de aprender.';
      return;
    }
    controller.release();
    profile.learn($('[data-target]').value,$('[data-mode]').value,$('[data-behavior]').value);
  };
  $('[data-cancel]').onclick = () => profile.reset();
  profile.onChange = () => {
    $('[data-enabled]').checked = profile.enabled;
    $('[data-learn]').disabled = !profile.enabled;
    $('[data-cancel]').disabled = !profile.learning;
    $('[data-status]').textContent = profile.learning
      ? 'Aguardando: mova somente o controle físico que deseja associar. Para cancelar, use Cancelar.'
      : !profile.enabled ? 'Perfil desativado. Entrada MIDI original preservada.'
      : profile.bindings.length ? `${profile.bindings.length} controle(s) mapeado(s). Para testar, mova os controles com esta janela em foco.`
      : 'Perfil ativo. Aprenda o primeiro controle.';
    if (profile.persistenceError) $('[data-status]').textContent += ' Não foi possível salvar; o perfil funciona somente nesta sessão.';
    const tbody = $('tbody'); tbody.replaceChildren();
    for (const b of profile.bindings) {
      const row = document.createElement('tr');
      const mode = {absolute:'Absoluto',offset:'Relativo 65/63',twos:'Relativo 1/127'}[b.mode];
      for (const text of [TARGETS.find(t=>t.id===b.target).label,`${b.port} · canal ${b.channel+1} · CC${b.cc}`,mode]) {
        const cell = document.createElement('td'); cell.textContent = text; row.append(cell);
      }
      const behaviorCell=document.createElement('td'),behavior=document.createElement('select');
      behavior.dataset.bindingBehavior=b.target;behavior.setAttribute('aria-label',`Comportamento ${b.target}`);
      behavior.add(new Option('Normal','normal'));
      if(fineTarget(b.target))behavior.add(new Option('Fino · unidade interna','fine'));
      behavior.value=b.behavior;behavior.disabled=!fineTarget(b.target);
      behavior.onchange=()=>profile.setBehavior(b.target,behavior.value);
      behaviorCell.append(behavior);row.append(behaviorCell);
      const cell = document.createElement('td'), button = document.createElement('button');
      button.type='button'; button.textContent='Remover';
      button.setAttribute('aria-label',`Remover mapeamento ${TARGETS.find(t=>t.id===b.target).label}`);
      button.onclick=()=>{controller.release();profile.remove(b.target);};
      cell.append(button);row.append(cell);tbody.append(row);
    }
  };
  profile.onChange();
}
