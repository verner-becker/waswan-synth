// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {FX,effect,resolveEffect,validateEffects} from './daw-fx-catalog.js';
import {PPQ} from './daw-project.js';
import {frameBeat} from './daw-arrangement.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export class DawMix {
 constructor(w){this.w=w;const l=w.layout;this.fxPane=el('section','ww-daw-mix-tools');this.autoPane=el('section','ww-daw-mix-tools');l.fxPane=this.fxPane;l.autoPane=this.autoPane;l.bottom.append(this.fxPane,this.autoPane);const tabs=l.clipTab.parentElement;l.autoTab=action('Automation',()=>l.panel('automation'));l.fxTab=action('Effects',()=>l.panel('effects'));tabs.insertBefore(l.autoTab,l.bottomToggle);tabs.insertBefore(l.fxTab,l.bottomToggle);
  this.target=el('select');this.target.setAttribute('aria-label','FX target');this.target.append(new Option('Selected track','track'),new Option('DAW Master','master'));this.target.onchange=()=>this.refresh();this.type=el('select');this.type.setAttribute('aria-label','Add effect type');for(const [key,v] of Object.entries(FX))this.type.add(new Option(v.name,key));this.add=action('Add effect',()=>this.run(()=>{const list=this.effects();this.commit([...list,effect(this.type.value)]);}));this.list=el('div','ww-daw-fx-list');this.master=el('output','ww-daw-master-readout');this.master.setAttribute('aria-label','DAW Master stereo peaks');this.fxPane.append(this.target,this.type,this.add,this.master,action('Reset DAW clip indicator',()=>w.player.masterMeter?.port.postMessage({t:'reset'})),this.list,el('p','ww-muted','Source / Clip Gain → Track FX → Volume/Pan → DAW Master Volume → Master FX. Sample peak dBFS; no LUFS/true peak claim. Stop closes sources; effect tails can finish through the restored base faders. DSP Monitor measures Synth processing; it excludes these independent FX.'));
  this.buildAutomation();
  this.refresh();
  l.layout(false);
 }
 buildAutomation(){
  this.autoTarget=el('select');
  this.autoTarget.setAttribute('aria-label','Automation parameter');
  this.autoTarget.append(new Option('Volume','volume'),new Option('Pan','pan'));
  this.autoTarget.onchange=()=>this.refresh();
  this.enable=action('Enable automation',()=>this.run(()=>{
   const lane=this.lane();
   if(lane)this.w.controller.command('automation.update',{id:lane.id,changes:{enabled:!lane.enabled}});
   else this.setPoints([]);
  }));
  this.clear=action('Clear automation points',()=>this.run(()=>this.setPoints([])));
  this.curve=el('select');
  this.curve.setAttribute('aria-label','Automation interpolation');
  this.curve.append(new Option('Linear','linear'),new Option('Step','step'));
  this.curve.onchange=()=>this.run(()=>{
   const lane=this.lane();
   if(lane)this.w.controller.command('automation.update',{id:lane.id,changes:{curve:this.curve.value}});
  });
  this.autoInfo=el('output','ww-muted');
  this.canvas=el('canvas','ww-daw-automation-canvas');
  this.canvas.tabIndex=0;
  this.canvas.setAttribute('aria-label','Draw track automation');
  this.canvas.setAttribute('aria-describedby','ww-daw-automation-hint');
  this.canvas.onkeydown=event=>this.pointKey(event);
  this.canvas.onpointerdown=event=>this.down(event);
  this.canvas.oncontextmenu=event=>{
   event.preventDefault();
   if(this.locked()||!this.points().length)return;
   const {tick}=this.point(event);
   const closest=this.points().reduce((a,b)=>Math.abs(b.tick-tick)<Math.abs(a.tick-tick)?b:a);
   this.removePoint(closest.tick);
  };
  const hint=el('p','ww-muted ww-daw-automation-hint','Click or drag to edit. With the graph focused, Page Up/Down selects a point, arrows adjust it, Enter adds at the cursor and Delete removes it.');
  hint.id='ww-daw-automation-hint';
  const fields=el('div','ww-daw-automation-point');
  this.pointSelect=el('select');
  this.pointSelect.setAttribute('aria-label','Automation point');
  const label=el('label','','Automation point');
  label.append(this.pointSelect);
  fields.append(label);
  this.pointSelect.onchange=()=>this.selectPoint(Number(this.pointSelect.value));
  this.pointBeat=this.w.field('Automation point beat','number','',fields);
  this.pointBeat.parentElement.firstChild.textContent='Position (quarter beat)';
  Object.assign(this.pointBeat,{min:1,step:'any'});
  this.pointValue=this.w.field('Automation point value','number','',fields);
  this.pointValue.step='any';
  this.pointApply=action('Apply point',()=>this.applyPoint());
  this.pointAdd=action('Add point at cursor',()=>this.addPoint());
  this.pointRemove=action('Delete point',()=>this.removePoint(this.pointTick));
  fields.append(this.pointApply,this.pointAdd,this.pointRemove);
  this.autoPane.append(this.autoTarget,this.enable,this.curve,this.clear,this.autoInfo,this.canvas,hint,fields);
  this.resize=new ResizeObserver(()=>this.paint());
  this.resize.observe(this.autoPane);
 }
 locked(){return !!(this.w.busy||this.w.player.playing||this.w.player.starting||this.w.recorder.busy||this.w.importer.busy||this.w.audition.busy);}
 run(task){try{task();}catch(e){this.w.error(e);this.refresh();}}
 effects(){return this.target.value==='master'?this.w.snapshot.master.fx:this.w.selectedTrack()?.fx||[];}
 commit(fx){if(fx.length>16)throw Error('FX chain limit: 16');if(this.w.recorder.busy||this.w.importer.busy||this.w.audition.busy)throw Error('Finish recording/import/preview before changing effects');const candidate=structuredClone(this.w.snapshot);if(this.target.value==='master')candidate.master.fx=fx;else{const t=candidate.tracks.find(t=>t.id===this.w.selected);if(!t)throw Error('Select a track');t.fx=fx;}try{validateEffects(candidate);}catch(error){const old=this.effects(),removal=fx.length<old.length&&fx.every(e=>old.some(o=>JSON.stringify(e)===JSON.stringify(o)));if(!removal)throw error;}if(this.target.value==='master')this.w.controller.command('master.update',{fx});else{const track=this.w.selectedTrack();if(!track)throw Error('Select a track');this.w.controller.command('track.update',{id:track.id,changes:{fx}});}}
 refresh(){const key=JSON.stringify([this.target.value,this.w.selected,this.effects()]);if(key!==this.fxKey){this.fxKey=key;this.list.replaceChildren();for(const [index,e] of this.effects().entries()){const row=el('div','ww-daw-fx-row'),head=el('div','ww-daw-piano-tools'),name=el('strong','',FX[e.type]?.name||e.type);head.append(name,action(e.bypass?'Enable effect':'Bypass effect',()=>this.run(()=>this.commit(this.effects().map(v=>v.id===e.id?{...v,bypass:!v.bypass}:v)))),action('Move effect up',()=>this.run(()=>this.move(index,-1))),action('Move effect down',()=>this.run(()=>this.move(index,1))),action('Remove effect',()=>this.run(()=>this.commit(this.effects().filter(v=>v.id!==e.id)))));row.append(head);try{const p=resolveEffect(e).parameters;for(const [key,spec] of Object.entries(FX[e.type].params)){const input=this.w.field(spec.name,'number',p[key],row);Object.assign(input,{min:spec.min,max:spec.max,step:spec.step});input.onchange=()=>this.run(()=>{const params={...e.parameters,[key]:Number(input.value)};resolveEffect({...e,parameters:params});this.commit(this.effects().map(v=>v.id===e.id?{...v,parameters:params}:v));});}}catch(error){row.append(el('p','ww-muted',error.message));}this.list.append(row);}}
  this.add.disabled=this.w.busy||this.w.recorder.busy||this.w.importer.busy||this.w.audition.busy||this.target.value==='track'&&!this.w.selectedTrack()||this.effects().length>=16;this.refreshAutomation();this.paint();this.meters();
 }
 move(index,delta){const fx=[...this.effects()],to=index+delta;if(to<0||to>=fx.length)return;const [e]=fx.splice(index,1);fx.splice(to,0,e);this.commit(fx);}
 lane(){return this.w.snapshot.automation.find(l=>l.trackId===this.w.selected&&l.target===this.autoTarget.value);}
 points(){return this.lane()?.points||[];}
 valueRange(){return this.autoTarget.value==='pan'?[-1,1]:[0,2];}
 refreshAutomation(){
  const track=this.w.selectedTrack(),lane=this.lane(),points=this.points();
  const scope=JSON.stringify([this.w.snapshot.id,this.w.selected,this.autoTarget.value]);
  if(this.pointScope!==scope){
   this.pointScope=scope;
   this.pointTick=null;
  }
  if(!points.some(point=>point.tick===this.pointTick))this.pointTick=points[0]?.tick??null;
  const key=JSON.stringify([scope,points]);
  if(this.pointListKey!==key){
   this.pointListKey=key;
   this.pointSelect.replaceChildren(...points.map(({tick,value})=>new Option(
    `Beat ${+(tick/PPQ+1).toFixed(4)} · ${+value.toFixed(3)}`,String(tick)
   )));
  }
  this.pointSelect.disabled=!points.length;
  this.pointSelect.value=this.pointTick??'';
  this.enable.textContent=lane?.enabled?'Disable automation':'Enable automation';
  this.automationControls();
  this.curve.value=lane?.curve||'linear';
  this.autoInfo.textContent=track?track.name+' · '+(lane?.enabled&&points.length?'Automation active':'Base fader value'):'Select a track';
  this.refreshPointFields();
 }
 automationControls(){
  const points=this.points(),locked=this.locked()||!this.w.selectedTrack();
  this.enable.disabled=locked;
  this.pointAdd.disabled=locked||points.length>=4096;
  this.clear.disabled=locked||!points.length;
  this.curve.disabled=locked||!this.lane();
  this.pointBeat.disabled=this.pointValue.disabled=this.pointApply.disabled=this.pointRemove.disabled=locked||this.pointTick===null;
 }
 refreshPointFields(){
  const point=this.points().find(value=>value.tick===this.pointTick);
  const [min,max]=this.valueRange();
  this.pointValue.parentElement.firstChild.textContent=this.autoTarget.value==='pan'?'Pan (−1 L to +1 R)':'Volume (0–2 linear)';
  this.pointBeat.max=this.w.snapshot.length/PPQ+1;
  Object.assign(this.pointValue,{min,max});
  const key=JSON.stringify([this.pointScope,point]);
  if(key===this.pointFieldKey)return;
  this.pointFieldKey=key;
  this.pointBeat.value=point?point.tick/PPQ+1:'';
  this.pointValue.value=point?.value??'';
 }
 selectPoint(tick){
  this.pointTick=tick;
  this.pointSelect.value=tick??'';
  this.refreshPointFields();
  this.automationControls();
  this.paint();
 }
 changePoint(previous,point){
  const points=this.points();
  if(points.some(p=>p.tick===point.tick&&p.value===point.value)&&(previous===null||previous===point.tick)){
   this.selectPoint(point.tick);
   return;
  }
  this.pointTick=point.tick;
  this.setPoints([...points.filter(p=>p.tick!==previous&&p.tick!==point.tick),point]);
 }
 addPoint(){
  if(this.locked()||!this.w.selectedTrack()||this.points().length>=4096)return;
  const tick=clamp(Math.round(frameBeat(this.w.cursor,this.w.snapshot)*PPQ),0,this.w.snapshot.length);
  if(this.points().some(point=>point.tick===tick)){
   this.selectPoint(tick);
   return;
  }
  this.run(()=>this.changePoint(null,{tick,value:this.w.selectedTrack()[this.autoTarget.value]}));
 }
 applyPoint(){
  if(this.locked()||this.pointTick===null)return;
  if(!this.pointBeat.value||!this.pointBeat.reportValidity()||!this.pointValue.value||!this.pointValue.reportValidity()){
   this.w.error(Error('Enter a beat and a value within the displayed ranges'));
   return;
  }
  this.run(()=>this.changePoint(this.pointTick,{tick:Math.round((this.pointBeat.valueAsNumber-1)*PPQ),value:this.pointValue.valueAsNumber}));
 }
 removePoint(tick){
  if(this.locked()||tick===null)return;
  this.run(()=>this.setPoints(this.points().filter(point=>point.tick!==tick)));
 }
 pointKey(event){
  if(event.ctrlKey||event.metaKey||event.altKey)return;
  const key=event.key;
  if(!['PageUp','PageDown','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Delete'].includes(key))return;
  event.preventDefault();
  event.stopPropagation();
  const points=this.points(),index=points.findIndex(point=>point.tick===this.pointTick);
  if(key==='PageUp'||key==='PageDown'){
   this.selectPoint(points[clamp(index+(key==='PageUp'?-1:1),0,points.length-1)]?.tick??null);
   return;
  }
  if(this.locked())return;
  if(key==='Enter')return this.addPoint();
  if(key==='Delete')return this.removePoint(this.pointTick);
  const point=points[index];
  if(!point)return;
  const horizontal=key==='ArrowLeft'||key==='ArrowRight';
  const direction=key==='ArrowLeft'||key==='ArrowDown'?-1:1;
  const grid=this.w.layout.snap?this.w.layout.grid*PPQ:1;
  const next={
   tick:horizontal?clamp(point.tick+direction*grid,0,this.w.snapshot.length):point.tick,
   value:horizontal?point.value:clamp(+(point.value+direction*(event.shiftKey ? .1 : .01)).toFixed(6),...this.valueRange())
  };
  this.run(()=>this.changePoint(point.tick,next));
 }
 setPoints(points){if(this.locked())return;const lane=this.lane(),sorted=[...points].sort((a,b)=>a.tick-b.tick);if(lane)this.w.controller.command('automation.update',{id:lane.id,changes:{points:sorted}});else{if(!this.w.selectedTrack())throw Error('Select a track');this.w.controller.command('automation.add',{id:crypto.randomUUID(),trackId:this.w.selected,target:this.autoTarget.value,enabled:true,curve:this.curve.value,points:sorted});}}
 range(){const p=this.w.snapshot,t=p.transport;return t&&t.start<p.length?{start:t.start,end:Math.min(t.end,p.length)}:{start:0,end:p.length};}
 point(e){const r=this.canvas.getBoundingClientRect(),range=this.range(),[min,max]=this.valueRange(),tick=Math.max(range.start,Math.min(range.end,Math.round(range.start+(e.clientX-r.left)/r.width*(range.end-range.start)))),value=Math.max(min,Math.min(max,max-(e.clientY-r.top)/r.height*(max-min)));return {tick:Math.min(this.w.snapshot.length,tick),value};}
 paint(){this.paintWindow?.cancelAnimationFrame(this.paintFrame);this.paintWindow=this.canvas.ownerDocument.defaultView;this.paintFrame=this.paintWindow.requestAnimationFrame(()=>{if(this.autoPane.hidden||!this.canvas.clientWidth)return;const width=this.canvas.clientWidth,height=220;this.canvas.width=width;this.canvas.height=height;const ctx=this.canvas.getContext('2d'),range=this.range(),pan=this.autoTarget.value==='pan',points=this.preview||this.lane()?.points||[],xy=p=>[(p.tick-range.start)/(range.end-range.start)*width,(pan?(1-p.value)/2:1-p.value/2)*height];ctx.fillStyle='#0e1d25';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#526e7b';for(let y=0;y<=height;y+=height/4){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}ctx.strokeStyle='#93dcd9';ctx.beginPath();for(const [i,p] of points.entries()){const [x,y]=xy(p);if(!i)ctx.moveTo(x,y);else{if(this.lane()?.curve==='step'){const old=xy(points[i-1]);ctx.lineTo(x,old[1]);}ctx.lineTo(x,y);}}ctx.stroke();ctx.fillStyle='#b7fff4';for(const p of points){const [x,y]=xy(p);ctx.fillStyle=p.tick===(this.previewTick??this.pointTick)?'#ffd696':'#b7fff4';ctx.fillRect(x-4,y-4,8,8);}ctx.fillStyle='#c1d5df';ctx.font='11px sans-serif';ctx.fillText(`${range.start/PPQ+1} → ${range.end/PPQ+1} quarter beats · ${pan?'−1 … +1 Pan':'0 … 2 Volume'}`,8,16);});}
 down(event){
  if(event.button!==0||this.locked()||!this.w.selectedTrack())return;
  event.preventDefault();
  this.canvas.focus({preventScroll:true});
  const lane=this.lane(),project=this.w.snapshot;
  const context=JSON.stringify([project.id,this.w.selected,this.autoTarget.value,lane]);
  const points=this.points(),point=this.point(event),range=this.range();
  const original=points.find(p=>Math.abs(p.tick-point.tick)/(range.end-range.start)*this.canvas.clientWidth<10);
  if(!original&&points.length>=4096)return;
  let next=original||point;
  this.canvas.setPointerCapture(event.pointerId);
  const preview=()=>{
   this.preview=[...points.filter(p=>p!==original&&p.tick!==next.tick),next].sort((a,b)=>a.tick-b.tick);
   this.previewTick=next.tick;
   this.paint();
  };
  const move=e=>{next=this.point(e);preview();};
  const end=e=>{
   this.canvas.removeEventListener('pointermove',move);
   this.canvas.removeEventListener('pointerup',end);
   this.canvas.removeEventListener('lostpointercapture',end);
   this.preview=this.previewTick=null;
   const current=JSON.stringify([this.w.snapshot.id,this.w.selected,this.autoTarget.value,this.lane()]);
   if(e.type==='pointerup'&&current===context&&!this.locked())this.run(()=>this.changePoint(original?.tick??null,next));
   this.paint();
  };
  this.canvas.addEventListener('pointermove',move);
  this.canvas.addEventListener('pointerup',end);
  this.canvas.addEventListener('lostpointercapture',end);
  preview();
 }
 meters(){
  const m=this.w.player.masterLevels,format=n=>n>0?(20*Math.log10(n)).toFixed(1):'−∞';
  const limited=[...(this.w.player.masterFx?.entries.values()||[])].some(e=>e.type==='limiter'&&!e.bypass);
  const text=`DAW Master L ${format(m?.peaks[0])} / R ${format(m?.peaks[1])} dBFS${m?.clipped?' · CLIP':''}${m?.invalid?' · Invalid audio muted':''}${limited?' · Sample peak limiter active':''}`;
  for(const output of [this.master,this.w.mixerMasterPeaks]){
   output.textContent=text;output.dataset.clipped=String(!!m?.clipped);
  }
 }
}
