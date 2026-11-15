// SPDX-License-Identifier: GPL-3.0-only
import {accumulator,merge,metrics,MAX_WINDOWS} from './dsp-stats.js';
import {build} from './dsp-version.js';
let controller,panel,toggle,visible=false,running=false,session=null,records=[],total=accumulator(),last=null,windows=0;
const stamp=()=>new Date().toISOString();
const control=(action,extra={})=>controller.send({t:'dsp-control',action,...extra});
const number=v=>v===null||v===undefined?'indisponível':v.toFixed(3)+' ms';
export function mountDspMonitor(c){
 controller=c;toggle=document.createElement('button');toggle.type='button';toggle.textContent='Mostrar WASWAN DSP Monitor';toggle.dataset.dspToggle='';toggle.setAttribute('aria-expanded','false');
 panel=document.createElement('section');panel.className='waswan-dsp';panel.hidden=true;panel.setAttribute('aria-label','WASWAN DSP Monitor');
 panel.innerHTML=`<strong>WASWAN DSP Monitor</strong><p data-dsp-state>Captura inativa · monitor desligado</p><p data-dsp-voices>Vozes: — / 256 · pico amostrado: —</p><p data-dsp-times>Tempos indisponíveis</p><p data-dsp-budget></p><p data-dsp-quality></p><button data-dsp-start>Iniciar captura</button> <button data-dsp-stop>Encerrar captura</button> <button data-dsp-export>Exportar JSONL</button> <button data-dsp-clear>Limpar sessão</button><p>Vozes alocadas incluem release; gate inclui sustain. Picos amostrados a 25 Hz. Exceder o orçamento não comprova falha de áudio. Captura limitada a uma hora de áudio.</p>`;
 const anchor=document.querySelector('.instrument');anchor.before(toggle,panel);
 const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./dsp-monitor.css',import.meta.url).href;document.head.append(css);
 toggle.onclick=()=>{visible=!visible;panel.hidden=!visible;toggle.textContent=(visible?'Ocultar':'Mostrar')+' WASWAN DSP Monitor';toggle.setAttribute('aria-expanded',String(visible));if(!session)control('enable',{enabled:visible});draw();};
 panel.querySelector('[data-dsp-start]').onclick=()=>{
  if(!running||session)return;records=[];total=accumulator();windows=0;last=null;
  session=globalThis.crypto.randomUUID();records.push({type:'start',timestamp:stamp(),session,instrument:'WASWAN Synth DSP Monitor v1',build,environment:{sampleRateRequested:44100,audioWorklet:true},limits:{maxWindows:MAX_WINDOWS,binMs:.025,bins:1024},privacy:'No MIDI events, device identifiers, paths or musical content'});
  control('start',{session});draw();
 };
 panel.querySelector('[data-dsp-stop]').onclick=()=>{if(session){const stopping=session;control('stop');setTimeout(()=>{if(session===stopping)finish('stop-timeout-incomplete');},2000);}};
 panel.querySelector('[data-dsp-clear]').onclick=()=>{if(session)return;records=[];total=accumulator();last=null;draw();};
 panel.querySelector('[data-dsp-export]').onclick=()=>{
  if(!records.length)return;const blob=new Blob([records.map(r=>JSON.stringify(r)).join('\n')+'\n'],{type:'application/x-ndjson'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='waswan-dsp-'+new Date().toISOString().slice(0,19).replaceAll('-','').replace('T','-').replaceAll(':','')+'.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 addEventListener('pagehide',()=>{if(session)finish('pagehide-incomplete');});draw();
}
function finish(reason){if(!session)return;records.push({type:'summary',timestamp:stamp(),session,reason,...metrics(total),sampleRate:last?.sampleRate??null,poolCapacity:last?.poolCapacity??256,measurement:last?.measurement??{state:'unavailable',quality:'no-windows'},voicePeakSampling:'25 Hz; transients may be missed'});session=null;if(running)control('enable',{enabled:visible});draw();}
function draw(){if(!panel)return;
 panel.querySelector('[data-dsp-state]').textContent=`Captura ${session?'em andamento':'inativa'} · ${last?.measurement?.quality??(visible?'aguardando áudio':'monitor desligado')}`;
 const m=last?.metrics;
 panel.querySelector('[data-dsp-quality]').textContent=last?.measurement?.clock==='Date.now'?'Relógio Date.now: resolução nominal de 1 ms, não monotônico. Percentis aproximados; não são medidas de underrun.':last?.measurement?.state==='unavailable'?'Este worklet não oferece relógio de duração: tempos indisponíveis.':'Percentis aproximados por histograma; resolução do relógio depende do navegador.';
 panel.querySelector('[data-dsp-voices]').textContent=`Vozes: ${last?.voices?.active??'—'} / ${last?.poolCapacity??256} · gate ${last?.voices?.gate??'—'} · release ${last?.voices?.release??'—'} · pico amostrado: ${total.peakVoices}`;
 panel.querySelector('[data-dsp-times]').textContent=`Média ${number(m?.meanMs)} · p95 ${number(m?.p95Ms)} · p99 ${number(m?.p99Ms)} · máximo ${number(m?.maxMs)}`;
 panel.querySelector('[data-dsp-budget]').textContent=`Orçamento ${number(m?.budgetMs)} · uso ${m?.budgetUsedPercent==null?'indisponível':m.budgetUsedPercent.toFixed(1)+'%'} · blocos acima ${m?.overBudget??'indisponível'} · blocos ${m?.blocks??0}`;
 panel.querySelector('[data-dsp-start]').disabled=!running||!!session;
 panel.querySelector('[data-dsp-stop]').disabled=!session;
 panel.querySelector('[data-dsp-clear]').disabled=!!session;
 panel.querySelector('[data-dsp-export]').disabled=!records.length||!!session;
}
export function updateDspMonitor(m){
 if(!panel)return;
 if(m.t==='ready'){running=!!m.audio;if(running)queueMicrotask(()=>control('enable',{enabled:visible}));draw();return;}
 if(m.t==='error'){running=false;finish('audio-error-incomplete');draw();return;}
 if(m.t!=='dsp-window')return;
 // Ignore queued messages from earlier sessions after a stop/restart.
 if(m.session!==session)return;
 last={sampleRate:m.sampleRate,poolCapacity:m.voices.capacity,voices:m.voices,measurement:m.measurement,metrics:metrics(m.stats)};
 if(session){merge(total,m.stats);records.push({type:'window',timestamp:stamp(),session,...last,...last.metrics});windows++;
  if(m.final)finish(m.reason);else if(windows>=MAX_WINDOWS){finish('window-limit');}
 }
 draw();
}
