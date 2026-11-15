// SPDX-License-Identifier: GPL-3.0-only
export class MidiDiagnostic {
  constructor({limit=10000,now=()=>performance.now(),stamp=()=>new Date().toISOString()}={}) {
    this.limit=limit;this.now=now;this.stamp=stamp;this.active=false;this.records=[];this.previous=new Map();this.frameState=null;this.lastCC=null;
  }
  start(){this.records=[];this.previous.clear();this.session=globalThis.crypto.randomUUID();this.started=this.now();this.active=true;this.lastCC=null;this.add('start',{schema:'waswan-midi-diagnostic-v1',limit:this.limit});}
  add(type,data={}){
    if(!this.active)return null;
    const record={type,seq:this.records.length,timestamp:this.stamp(),elapsedMs:this.now()-this.started,...data};this.records.push(record);
    if(this.records.length>=this.limit){this.active=false;this.records.push({type:'stop',seq:this.records.length,timestamp:this.stamp(),elapsedMs:this.now()-this.started,reason:'record-limit'});}
    return record;
  }
  stop(){this.add('stop',{reason:'user'});this.active=false;}
  reset(){this.previous.clear();this.add('reset',{reason:'controller-release'});}
  frame(frame){
    const k=frame.knobControl;if(!k)return;
    const next={context:k.context,parameters:k.parameters};
    this.frameState=next;this.frameAt=this.now();
    if(!this.active)return;
    const key=JSON.stringify(next);
    if(key!==this.frameKey){this.frameKey=key;this.add('state',next);}
  }
  input(data,meta){
    if(!this.active||!data||data.length!==3||!Array.from(data).every(Number.isInteger))return null;
    const [status,cc,value]=data;if(status<0xb0||status>0xbf||cc<0||cc>127||value<0||value>127)return null;
    const key=(status&15)*128+cc,previous=this.previous.get(key);this.previous.set(key,value);this.lastCC=this.now();
    return this.add('cc',{raw:[status,cc,value],channel:(status&15)+1,cc,value,rawDelta:previous===undefined?null:value-previous,
      ...meta,latestFrame:this.frameState,frameAgeMs:this.frameAt===undefined?null:this.now()-this.frameAt,commands:[]});
  }
  jsonl(){return this.records.map(r=>JSON.stringify({session:this.session,...r})).join('\n')+'\n';}
}
let current;
export function updateMidiDiagnostic(frame){current?.frame(frame);}
export function mountMidiDiagnostic(controller){
 const d=controller.diagnostic;current=d;
 const panel=document.createElement('details');panel.className='waswan-midi-diagnostic';panel.innerHTML=`<summary>WASWAN · Diagnóstico MIDI ao vivo</summary>
 <p>Registra somente CCs recebidos, interpretação do mapeamento e valores da tela. Sem áudio, notas ou nomes de dispositivos. Transmissão apenas para o servidor local deste simulador.</p>
 <button data-midi-log-start>Iniciar captura ao vivo</button> <button data-midi-log-stop disabled>Encerrar</button> <button data-midi-log-mark disabled>Marcar problema</button> <button data-midi-log-export disabled>Exportar JSONL</button>
 <p data-midi-log-status role="status">Inativo · nenhum dado transmitido.</p><p data-midi-log-last>Aguardando captura.</p><pre data-midi-log-preview style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto"></pre>`;
 document.querySelector('.waswan-profile').after(panel);
 const $=s=>panel.querySelector(s);let timer=null,sent=0,sending=false,error='',linked=false;
 async function transmit(){
  if(sending||!d.session||sent>=d.records.length)return;
  sending=true;const from=sent,batch=d.records.slice(from,from+40).map(r=>JSON.parse(JSON.stringify(r)));
  // Never send the CC record until its synchronous mapping handler has populated it.
  try{const response=await fetch('/diagnostics/midi',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:d.session,records:batch})});if(!response.ok)throw Error('HTTP '+response.status);sent=from+batch.length;error='';linked=true;}
  catch(e){error=e.message;linked=false;}finally{sending=false;}
 }
 function draw(){
  $('[data-midi-log-start]').disabled=d.active||sending||sent<d.records.length;
  $('[data-midi-log-stop]').disabled=!d.active;$('[data-midi-log-mark]').disabled=!d.active;$('[data-midi-log-export]').disabled=!d.records.length;
  $('[data-midi-log-status]').textContent=`${d.active?'Capturando':'Encerrado'} · ${d.records.length} registros · ${sent} enviados · `+(error?'falha no envio local: '+error:linked?'conexão local confirmada':'aguardando conexão local');
  const last=d.records.findLast(r=>r.type==='cc');
  $('[data-midi-log-last]').textContent=last?`Canal ${last.channel} · CC${last.cc} · valor ${last.value} · delta ${last.rawDelta??'inicial'} · último CC há ${Math.round(d.now()-d.lastCC)} ms`:'Nenhum CC recebido nesta captura.';
  $('[data-midi-log-preview]').textContent=d.records.slice(-5).map(r=>r.type==='cc'?`${r.seq}: CC${r.cc}=${r.value} Δ${r.rawDelta??'—'} · ${r.disposition??'recebido'} · ${r.behavior??'sem mapeamento'} · ${JSON.stringify(r.commands)}`:`${r.seq}: ${r.type}`).join('\n');
 }
 function tick(){void transmit().then(()=>{draw();if(!d.active&&sent===d.records.length&&timer){clearInterval(timer);timer=null;}});draw();}
 $('[data-midi-log-start]').onclick=()=>{if(d.active||sending)return;d.start();d.frameKey=null;sent=0;error='';linked=false;timer=setInterval(tick,250);tick();};
 $('[data-midi-log-stop]').onclick=()=>{d.stop();tick();};
 $('[data-midi-log-mark]').onclick=()=>{d.add('marker',{label:'problema observado'});tick();};
 $('[data-midi-log-export]').onclick=()=>{const url=URL.createObjectURL(new Blob([d.jsonl()],{type:'application/x-ndjson'})),a=document.createElement('a');a.href=url;a.download='waswan-midi-'+new Date().toISOString().replaceAll(':','-')+'.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 addEventListener('pagehide',()=>{if(timer)clearInterval(timer);});
}
