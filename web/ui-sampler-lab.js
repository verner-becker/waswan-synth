// SPDX-License-Identifier: GPL-3.0-only
import {action,el} from './ui-primitives.js';
import {labEnvelope,labEnvelopes,labMap,labSource,labTests,captureLabTest,materializeLab,prepareLabPreview,renderLabPitch,pitchLabMap,persistLabPitch,forkLabWorking} from './sampler-lab.js';
import {labMaxSeconds} from './sampler-lab-analysis.js';
import {runOffline} from './sampler-offline.js';
import {saveWorking,updateWorking} from './sampler-working.js';

const db=value=>value>0?(20*Math.log10(value)).toFixed(1)+' dBFS':'−∞ dBFS';
const clamp=(value,lo,hi)=>Math.max(lo,Math.min(hi,value));
const percent=value=>Math.round(value*100)+'%';
const timePosition=ms=>Math.log1p(ms)/Math.log1p(60000);
const millis=position=>Math.round(Math.expm1(clamp(position,0,1)*Math.log1p(60000)));
const envelopeFields=[['attackMs','Attack (ms)'],['decayMs','Decay (ms)'],['sustain','Sustain level'],['releaseMs','Release (ms)']];
const loopModes=[['forward','Forward'],['reverse','Reverse'],['pingPong','Ping-pong']];
const channels=(values,property)=>values.map((c,i)=>(values.length===1?'Mono':i?'R':'L')+' '+db(c[property])).join(' · ');

function select(label,options,fn) {
  const input=el('select');
  input.setAttribute('aria-label',label);
  for(const [value,name] of options)input.append(new Option(name,value));
  input.onchange=()=>fn(input.value);
  return input;
}

function label(text,input) {
  const node=el('label','',text);
  node.append(input);
  return node;
}

function numeric(text,min,max,step,fn) {
  const input=el('input');
  Object.assign(input,{type:'number',min,max,step});
  input.setAttribute('aria-label',text);
  input.onchange=()=>fn(input.valueAsNumber);
  return input;
}

function panel(title,open=true) {
  const node=el('details','ww-lab-panel');
  node.open=open;
  node.append(el('summary','',title));
  return node;
}

function graph(name,width,height,draw,drag) {
  const canvas=el('canvas','ww-lab-graph');
  Object.assign(canvas,{width,height});
  canvas.setAttribute('aria-label',name);
  canvas.setAttribute('role','img');
  const paint=()=>draw(canvas.getContext('2d'),width,height);
  let gesture;
  const coords=e=>{
    const box=canvas.getBoundingClientRect();
    return [(e.clientX-box.left)*width/box.width,(e.clientY-box.top)*height/box.height];
  };
  canvas.onpointerdown=e=>{
    gesture=drag?.(...coords(e));
    if(gesture)canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove=e=>gesture?.move(...coords(e));
  canvas.onpointerup=e=>{gesture?.move(...coords(e));gesture?.finish();gesture=null;};
  canvas.onpointercancel=()=>{gesture?.cancel();gesture=null;};
  return {canvas,paint};
}

export class SampleLab {
  constructor(studio) {
    this.studio=studio;
    this.node=el('section','ww-sample-lab');
    this.node.hidden=true;this.node.setAttribute('aria-label','Sample Lab');
    this.heading=el('h3','','Sample Lab');this.heading.tabIndex=-1;
    this.status=el('p','ww-sampler-status');this.status.setAttribute('role','status');
    this.title=el('p','ww-muted');
    this.controls=el('fieldset','ww-lab-controls');
    this.regionInput=select('Lab region',[],id=>this.run(()=>this.load(id,this.model)));
    this.top=el('div','ww-sampler-actions');
    this.close=action('Close Sample Lab',()=>this.hide());
    this.top.append(label('Region',this.regionInput),this.close);
    this.pitchPanel=panel('Pitch & Timbre',false);
    this.createPitch();
    this.envelopePanel=panel('Envelope Designer');
    this.loopPanel=panel('Sustain & Loop');
    this.testPanel=panel('Performance Test');
    this.createEnvelope();
    this.createLoop();
    this.createTests();
    this.applyButton=this.button('Apply to Working Copy',()=>this.apply());
    const save=this.button('Save Working',async()=>{await this.apply();await studio.saveDraft();this.bound=studio.draft;this.status.textContent='Working Copy saved.';});
    const promote=this.button('Promote to Official',async()=>{await this.apply();await studio.promoteDraft();this.bound=studio.draft;this.status.textContent=studio.status.textContent;});
    const actions=el('div','ww-sampler-actions ww-lab-save');
    actions.append(this.applyButton,save,promote);
    this.controls.append(this.pitchPanel,this.envelopePanel,this.loopPanel,this.testPanel,actions);
    this.node.append(this.heading,this.title,this.top,this.controls,this.cancelTest,this.status);
  }
  button(name,fn) {return action(name,()=>this.run(fn));}
  run(fn) {
    return this.studio.run(async()=>{
      this.status.textContent='';
      this.controls.disabled=true;this.regionInput.disabled=true;this.close.disabled=true;
      try{await fn();}
      catch(error){if(error.name!=='AbortError')this.status.textContent=error.message;}
      finally{this.controls.disabled=!this.source;this.regionInput.disabled=!this.source;this.close.disabled=false;}
    },this.node,true);
  }
  async show() {
    const s=this.studio;
    s.body.hidden=true;this.node.hidden=false;this.heading.focus();
    if(this.bound!==s.draft||!this.source)await this.run(()=>this.load(s.regionId));
  }
  hide(focus=true) {
    this.node.hidden=true;this.studio.body.hidden=false;
    if(focus)this.studio.labButton.focus();
  }
  sync() {
    if(this.bound===this.studio.draft || this.studio.busy)return;
    this.bound=null;this.source=null;this.previewRef=null;
    if(!this.node.hidden&&!this.studio.body.hidden)this.hide(false);
  }
  async load(regionId,keepModel) {
    const s=this.studio;
    if(!s.draft)throw Error('Open a WAV or Working Copy in the library first.');
    this.source=null;this.previewRef=null;this.result=null;this.comparison=null;this.peaks=null;this.bound=s.draft;
    this.variant=null;this.pitchSlot.replaceChildren(new Option('A · Native Resampling','A'));this.pitchStatus.textContent='';
    const source=await labSource(s.root,s.draft,regionId);
    const {file,sample}=source;
    const model=keepModel??source.model,region=model.regions.find(r=>r.id===source.region.id);
    this.regionInput.replaceChildren(...model.regions.map(r=>new Option(r.id+' · MIDI '+r.root,r.id)));
    this.regionInput.value=region.id;
    this.title.textContent=s.draft.name+' · '+sample.path.split('/').at(-1)+' · '+(sample.sampleRate/1000)+' kHz';
    this.model=model;
    this.regionId=region.id;
    this.initialEnvelope=labEnvelope(model,region);
    this.previousEnvelope=null;
    this.loop=region.loop??this.defaultLoop(region);
    this.candidates.replaceChildren();this.loopReport.textContent='';this.testReport.textContent='';
    this.updateResult();
    const [start,end]=region.frames;
    const view={start,end,bins:900};
    const metricsRange={start,end:Math.min(end,start+labMaxSeconds*sample.sampleRate)};
    const [peaks,metrics]=await Promise.all([runOffline(file,{type:'waveform',...view}),
      runOffline(file,{type:'lab-source',range:metricsRange})]);
    this.peaks=peaks;
    this.source=source;
    this.metrics=metrics;
    const provenance=sample.provenance?.sampleLab;
    if(provenance)this.pitchStatus.textContent='Source processed with '+provenance.algorithm+' v'+provenance.algorithmVersion+
      ' · anchor MIDI '+provenance.anchor+'.';
    this.sourcePartial=metricsRange.end<end;
    if(!s.draft.instrument){
      const gain=this.safeGain(region);
      if(gain<region.gainDb)this.model=labMap(this.model,region.id,{gainDb:gain});
    }
    this.refresh();
  }
  get region(){return this.model.regions.find(r=>r.id===this.regionId);}
  get envelope(){return labEnvelope(this.model,this.region);}
  safeGain(region) {
    const group=this.model.groups.find(g=>g.id===region.group);
    const peak=Math.max(...this.metrics.levels.map(c=>c.peak));
    // Four phase-aligned voices and a 3 dB margin. Actual levels depend on pitch,
    // modulation and any other simultaneously mapped regions.
    return clamp(Math.min(region.gainDb,Math.floor(20*Math.log10(.707/(4*Math.max(peak,1e-9)))-
      this.model.gainDb-group.gainDb)),-144,48);
  }
  setRegion(changes) {
    try{
      this.model=labMap(this.model,this.regionId,changes);
      this.previewRef=null;
      this.refresh();
      this.refreshAudible();
    }catch(error){this.status.textContent=error.message;this.refresh();}
  }
  refreshAudible() {
    if(this.studio.liveRoute?.lab!==this || this.studio.busy)return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer=setTimeout(()=>void this.run(async()=>{
      if(this.studio.liveRoute?.lab===this)await this.arm();
    }),120);
  }
  createPitch() {
    this.pitchSlot=select('Pitch variant',[['A','A · Native Resampling']],()=>{
      this.previewRef=null;this.updateResult();this.refreshAudible();this.refresh();
    });
    const fields=el('div','ww-sampler-fields');
    this.semitones=numeric('Anchor shift (semitones)',-12,12,1,()=>{});
    this.fine=numeric('Processor fine tuning (cents)',-100,100,1,()=>{});
    this.outputGain=numeric('Variant B gain (dB)',-48,24,.1,()=>{this.previewRef=null;this.refreshAudible();});
    this.semitones.value=7;this.fine.value=0;this.outputGain.value=0;
    this.match=el('input');this.match.type='checkbox';this.match.checked=true;
    this.match.onchange=()=>{this.previewRef=null;this.refreshAudible();};
    this.pitchStatus=el('p','ww-sampler-status');this.pitchStatus.setAttribute('aria-live','polite');
    const actions=el('div','ww-sampler-actions');
    this.renderPitchButton=this.button('Render variant B',()=>this.renderPitch());
    this.compareButton=this.button('Compare A/B with selected sequence',()=>this.test(true));
    this.forkButton=this.button('Save variant as new Working Copy',()=>this.saveVariant());
    fields.append(label('Listen to',this.pitchSlot),label('Anchor shift (semitones)',this.semitones),
      label('Processor fine tuning (cents)',this.fine),label('Variant B gain (dB)',this.outputGain),label('Match preview RMS',this.match));
    actions.append(this.renderPitchButton,this.compareButton,this.forkButton);
    const names=el('p','ww-muted','A uses the native Hermite reader. B uses WSOLA + Pitch Shift offline and keeps the same audio length.');
    this.pitchPanel.append(names,fields,actions,this.pitchStatus);
  }
  async renderPitch() {
    const variant=await renderLabPitch(this.source,this.region,{
      semitones:this.semitones.valueAsNumber,fine:this.fine.valueAsNumber,
    });
    const monoRms=levels=>Math.sqrt(levels.reduce((sum,ch)=>sum+ch.rms**2,0)/levels.length);
    this.variant=variant;
    const offset=20*Math.log10(monoRms(this.metrics.levels)/monoRms(variant.report.levels));
    variant.matchGain=Number.isFinite(offset)?clamp(offset,-12,12):0;
    this.pitchSlot.replaceChildren(new Option('A · Native Resampling','A'),new Option('B · WSOLA + Pitch Shift','B'));
    this.pitchSlot.value='B';
    this.previewRef=null;
    this.comparison=null;this.result=null;this.updateResult();
    this.pitchStatus.textContent='B ready · anchor MIDI '+(this.region.root+variant.semitones)+' · '+
      variant.report.overRange+' samples above full scale before WAV encoding · RMS match '+variant.matchGain.toFixed(1)+' dB.';
    this.refresh();
    if(this.studio.liveRoute?.lab===this)await this.arm();
  }
  pitchGain() {
    const gain=this.outputGain.valueAsNumber;
    if(!Number.isFinite(gain)||gain<-48||gain>24)throw Error('Choose a variant gain between −48 and +24 dB.');
    return gain;
  }
  pitchModel(slot,preview) {
    return slot==='B'&&this.variant?pitchLabMap(this.model,this.variant,{
      gain:this.pitchGain(),offset:preview&&this.match.checked?this.variant.matchGain:0,
    }):this.model;
  }
  async saveVariant() {
    const {root,draft,browser}=this.studio;
    const slot=this.pitchSlot.value;
    const {draft:base,model}=slot==='B'?await persistLabPitch(root,draft,this.source,this.model,this.variant,this.pitchGain()):
      await materializeLab(root,draft,this.source,this.model);
    const suffix=slot==='B'?' · '+this.variant.algorithm+' '+(this.variant.semitones>=0?'+':'')+this.variant.semitones:' · Native A';
    const name=draft.name.slice(0,128-suffix.length)+suffix;
    await saveWorking(root,forkLabWorking(base,model,name));
    await browser.refreshWorking();
    this.status.textContent='Variant saved as a new Working Copy · '+name;
  }
  createEnvelope() {
    this.envelopeGraph=graph('Amplitude ADSR curve',720,180,(...args)=>this.drawEnvelope(...args),
      (x,y)=>this.dragEnvelope(x,y));
    const tools=el('div','ww-sampler-actions');
    const presets=select('Envelope preset',[['','Choose preset…'],...Object.keys(labEnvelopes).map(v=>[v,v])],name=>{
      if(name)this.setEnvelope(labEnvelopes[name]);
      presets.value='';
    });
    this.previous=action('Compare previous envelope',()=>{
      if(this.previousEnvelope)this.setEnvelope(this.previousEnvelope);
    });
    tools.append(label('Preset',presets),action('Reset envelope',()=>this.setEnvelope(this.initialEnvelope)),this.previous);
    const fields=el('div','ww-lab-envelope-fields');
    this.envelopeInputs=new Map();
    for(const [key,name] of envelopeFields){
      const sustain=key==='sustain';
      const input=numeric(name,0,sustain?1:60000,sustain?.001:1,value=>this.setEnvelope({...this.envelope,[key]:value}));
      const slider=el('input');
      Object.assign(slider,{type:'range',min:0,max:1,step:.001});
      slider.setAttribute('aria-label',name+' slider');
      slider.oninput=()=>{
        const value=sustain?slider.valueAsNumber:millis(slider.valueAsNumber);
        this.envelopeDrawing={...this.envelope,[key]:value};input.value=value;this.envelopeGraph.paint();
      };
      slider.onchange=()=>{if(this.envelopeDrawing)this.setEnvelope(this.envelopeDrawing);};
      fields.append(label(name,input),slider);
      this.envelopeInputs.set(key,{input,slider});
    }
    this.playback=select('Playback mode',[['gate','Gate · respects Note Off'],['oneShot','One-shot']],mode=>
      this.setRegion(mode==='oneShot'?{mode,loop:null}:{mode}));
    tools.append(label('Playback',this.playback));
    this.envelopePanel.append(this.envelopeGraph.canvas,fields,tools,el('small','ww-muted',
      'Time controls use a logarithmic scale. The envelope shapes volume. Enable a loop to repeat the sample for longer holds.'));
  }
  setEnvelope(envelope) {
    this.envelopeDrawing=null;
    const before=this.envelope;
    this.previousEnvelope=before;
    this.setRegion({envelope});
  }
  envelopePoints(envelope) {
    const y=level=>144-level*110;
    return [[22,y(0)],[28+192*timePosition(envelope.attackMs),y(1)],[225+190*timePosition(envelope.decayMs),y(envelope.sustain)],
      [471,y(envelope.sustain)],[480+216*timePosition(envelope.releaseMs),y(0)]];
  }
  drawEnvelope(ctx,width,height) {
    ctx.clearRect(0,0,width,height);
    ctx.strokeStyle='#334653';ctx.lineWidth=1;
    for(const y of [34,89,144]){ctx.beginPath();ctx.moveTo(22,y);ctx.lineTo(698,y);ctx.stroke();}
    const draw=(envelope,color,dashed)=>{
      const points=this.envelopePoints(envelope);
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;
      ctx.setLineDash(dashed?[6,5]:[]);ctx.beginPath();ctx.moveTo(...points[0]);
      points.slice(1).forEach(p=>ctx.lineTo(...p));ctx.stroke();ctx.setLineDash([]);
      if(!dashed)for(const [x,y] of points.slice(1)){ctx.beginPath();ctx.arc(x,y,5.5,0,2*Math.PI);ctx.fill();}
    };
    if(this.previousEnvelope)draw(this.previousEnvelope,'#8395a1',true);
    draw(this.envelopeDrawing??this.envelope,'#27e3dd',false);
    ctx.font='13px system-ui';ctx.fillStyle='#a5bcc9';
    for(const [text,x] of [['Attack',28],['Decay',225],['Hold',420],['Release',490]])ctx.fillText(text,x,168);
  }
  dragEnvelope(x,y) {
    const start=this.envelope;
    const index=this.envelopePoints(start).findIndex(([a,b],i)=>i>0&&Math.hypot(x-a,y-b)<20);
    if(index<0)return null;
    return {move:(x,y)=>{
      const sustain=Math.round(clamp((144-y)/110,0,1)*1000)/1000;
      const changes=[{}, {attackMs:millis((x-28)/192)}, {decayMs:millis((x-225)/190),sustain},{sustain},
        {releaseMs:millis((x-480)/216)}][index];
      this.envelopeDrawing={...start,...changes};this.envelopeGraph.paint();
    },finish:()=>this.setEnvelope(this.envelopeDrawing??start),cancel:()=>{this.envelopeDrawing=null;this.refresh();}};
  }
  defaultLoop(region) {
    const [start,end]=region.frames,span=end-start;
    return {start:start+Math.floor(span*.25),end:end-Math.floor(span*.20),mode:'forward',crossfade:0};
  }
  createLoop() {
    this.waveGraph=graph('Loop waveform with attack, sustain and crossfade',900,180,
      (...args)=>this.drawWave(...args),(x)=>this.dragLoop(x));
    this.loopEnable=el('input');this.loopEnable.type='checkbox';
    this.loopEnable.onchange=()=>this.setRegion(this.loopEnable.checked?{mode:'gate',loop:this.loop}:{loop:null});
    this.loopMode=select('Loop mode',loopModes,value=>this.setLoop({...this.loop,mode:value}));
    this.loopFields=new Map();
    const inputs=el('div','ww-sampler-fields');
    inputs.append(label('Enable loop',this.loopEnable),label('Loop mode',this.loopMode));
    for(const [key,name] of [['start','Loop start (frames)'],['end','Loop end (frames)'],['crossfade','Crossfade (frames)']]){
      const input=numeric(name,0,Infinity,1,value=>this.setLoop({...this.loop,[key]:value}));
      this.loopFields.set(key,input);inputs.append(label(name,input));
    }
    this.loopTime=el('small','ww-muted');
    this.loopReport=el('p','ww-sampler-status');this.loopReport.setAttribute('aria-live','polite');
    this.candidates=el('div','ww-sampler-actions');
    const actions=el('div','ww-sampler-actions');
    actions.append(this.button('Optimize Loop',()=>this.optimize()),
      this.button('Measure Loop',()=>this.measureLoop()),
      this.button('Preview loop on keyboard',async()=>{if(!this.region.loop)this.setLoop(this.loop,true);await this.arm();}));
    this.loopPanel.append(this.waveGraph.canvas,this.loopTime,inputs,actions,this.candidates,this.loopReport);
  }
  setLoop(loop,enable=!!this.region.loop) {
    const previous=this.loop;
    this.loop=loop;
    try{
      const tested=labMap(this.model,this.regionId,{mode:'gate',loop});
      if(enable){this.model=tested;this.previewRef=null;this.refreshAudible();}
      this.loopReport.textContent='';
    }catch(error){this.loop=previous;this.status.textContent=error.message;}
    this.refresh();
  }
  drawWave(ctx,width,height) {
    ctx.clearRect(0,0,width,height);
    if(!this.peaks)return;
    const [start,end]=this.region.frames,loop=this.loopDrawing??this.loop;
    const x=value=>(value-start)*width/(end-start);
    const fill=(lo,hi,color)=>{ctx.fillStyle=color;ctx.fillRect(x(lo),0,x(hi)-x(lo),height);};
    if(this.region.reverse){fill(loop.end,end,'#173348');fill(start,loop.start,'#242d3f');}
    else{fill(start,loop.start,'#173348');fill(loop.end,end,'#242d3f');}
    fill(loop.start,loop.end,this.region.loop?'#16413d':'#243643');
    const crossfade=loop.crossfade??0;
    if(crossfade){
      fill(loop.start,loop.start+crossfade,'#534139');fill(loop.end-crossfade,loop.end,'#534139');
    }
    const ch=this.source.sample.channels,bins=this.peaks.length/(2*ch),stride=(height-24)/ch;
    ctx.strokeStyle='#a0c3ce';ctx.beginPath();
    for(let channel=0;channel<ch;channel++)for(let i=0;i<bins;i++){
      const at=2*(i*ch+channel),center=24+stride*(channel+.5),scale=stride/65536;
      ctx.moveTo(i*width/bins,center-this.peaks[at]*scale);ctx.lineTo(i*width/bins,center-this.peaks[at+1]*scale);
    }
    ctx.stroke();
    ctx.fillStyle='#47e1d0';
    for(const frame of [loop.start,loop.end])ctx.fillRect(Math.min(width-2,x(frame)),0,2,height);
    ctx.font='13px system-ui';ctx.fillStyle='#d2e2e8';
    const reverse=this.region.reverse,active=this.region.loop;
    ctx.fillText(reverse?'Post-loop':'Attack',8,17);
    ctx.fillText(active?'Sustain loop':'Loop candidate',clamp(x(loop.start)+8,70,width-180),17);
    ctx.fillText(reverse?'Attack':'Post-loop',width-65,17);
  }
  dragLoop(x) {
    const width=this.waveGraph.canvas.width,[start,end]=this.region.frames;
    const boundary=x<(this.loop.start+this.loop.end-2*start)*width/(2*(end-start))?'start':'end';
    const min=boundary==='start'?start:this.loop.start+1;
    const max=boundary==='end'?end:this.loop.end-1;
    return {move:x=>{
      const position=clamp(start+Math.round(x*(end-start)/width),min,max);
      const loop={...this.loop,[boundary]:position};
      if(loop.mode==='pingPong'&&loop.end-loop.start<2)return;
      loop.crossfade=Math.min(loop.crossfade??0,Math.floor((loop.end-loop.start-Number(loop.mode==='pingPong'))/2));
      this.loopDrawing=loop;this.waveGraph.paint();
    },finish:()=>{const loop=this.loopDrawing;this.loopDrawing=null;if(loop)this.setLoop(loop);},
    cancel:()=>{this.loopDrawing=null;this.waveGraph.paint();}};
  }
  loopAnalysis() {
    const activeB=this.pitchSlot.value==='B';
    const {root,key,cents,reverse,fixedPitch}=this.region;
    const offsets=[-12,0,12].filter(n=>root+n>=key[0]&&root+n<=key[1]);
    if(!offsets.length)offsets.push(clamp(root,...key)-root);
    const transpose=activeB?this.variant.semitones+this.variant.fine/100:0;
    const origin=activeB?this.variant.sourceFrames[0]:0;
    return {file:activeB?this.variant.file:this.source.file,origin,options:{reverse,
      offsets:[...new Set(offsets.map(n=>(fixedPitch?0:n)+cents/100-transpose))]}};
  }
  async optimize() {
    const [first,last]=this.region.frames;
    const {start,end}=last-first>labMaxSeconds*this.source.sample.sampleRate?this.loop:{start:first,end:last};
    const {file,origin,options}=this.loopAnalysis();
    const candidates=await runOffline(file,{type:'lab-loops',range:{start:start-origin,end:end-origin},options});
    this.candidates.replaceChildren();
    this.loopReport.textContent=candidates.length?'Select a forward loop, then hold a note on the keyboard.':
      'No suitable loop found. Try a steadier excerpt or place the loop points by ear.';
    for(const [i,candidate] of candidates.entries()){
      const loop={...candidate.loop,start:candidate.loop.start+origin,end:candidate.loop.end+origin};
      this.candidates.append(action('Candidate '+(i+1)+' · '+loop.start+'–'+loop.end,()=>{
        this.setLoop(loop,true);this.showLoopMetrics(candidate.metrics);
      }));
    }
  }
  async measureLoop() {
    const {file,origin,options}=this.loopAnalysis();
    const loop={...this.loop,start:this.loop.start-origin,end:this.loop.end-origin};
    const {start,end}=loop;
    this.showLoopMetrics(await runOffline(file,{type:'lab-loops',range:{start,end},loop,options}));
  }
  showLoopMetrics(metrics) {
    const summary=metrics.ranges.map(r=>(r.offset>=0?'+':'')+r.offset.toFixed(1)+' st '+r.cycleMs.toFixed(0)+' ms / '+r.rippleDb.toFixed(1)+' dB ripple').join(' · ');
    this.loopReport.textContent='Loop continuity · '+percent(metrics.seam)+' edge step relative to local RMS · '+
      metrics.endsDb.toFixed(1)+' dB edge level change'+
      (metrics.harmonicDistance==null?'':' · '+percent(metrics.harmonicDistance)+' harmonic profile difference')+
      '. Sustain stability · '+summary+'.';
  }
  createTests() {
    this.sourceReadout=el('p','ww-muted');
    this.testInput=select('Performance test',[],()=>{});
    this.gain=numeric('Region gain (dB)',-144,48,.1,value=>this.setRegion({gainDb:value}));
    this.route=el('p','ww-muted');
    const actions=el('div','ww-sampler-actions');
    actions.append(this.button('Play on Keyboard',()=>this.arm()),
      this.button('Release Keyboard',()=>this.studio.releaseLive()),
      action('Show virtual keyboard',()=>{
        const key=this.studio.node.ownerDocument.querySelector('.ww-dock #keys .key')??document.querySelector('.ww-dock #keys .key');
        if(key){key.ownerDocument.defaultView.focus();key.scrollIntoView({block:'center'});key.focus({preventScroll:true});}
      }),
      this.button('Set conservative gain',()=>this.setRegion({gainDb:this.safeGain(this.region)})));
    const tests=el('div','ww-sampler-actions');
    this.cancelTest=action('Cancel test',()=>this.capture?.abort());this.cancelTest.hidden=true;
    const stop=action('Stop capture playback',()=>this.studio.audition.stop());
    this.listen=action('Listen to capture',()=>void this.studio.audition.play(this.result.wav)
      .catch(error=>{this.status.textContent=error.message;}));
    this.download=action('Download WAV',()=>this.downloadWav());
    this.testReport=el('div','ww-lab-report');this.testReport.setAttribute('aria-live','polite');
    tests.append(label('Sequence',this.testInput),this.button('Run dry test',()=>this.test()),this.listen,stop,this.download);
    this.testPanel.append(this.sourceReadout,this.route,actions,label('Region gain (dB)',this.gain),tests,this.testReport);
  }
  async prepare(slot=this.pitchSlot.value) {
    const s=this.studio;
    if(this.previewRef&&this.preparedSlot===slot){
      const {resident}=await s.player.requests().request('daw-sampler-status',{ref:this.previewRef});
      if(resident)return this.previewRef;
    }
    this.previewRef=await prepareLabPreview(s.player,s.root,this.source,this.pitchModel(slot,true),
      slot==='B'?this.variant:null);
    this.preparedSlot=slot;
    return this.previewRef;
  }
  async arm() {
    const s=this.studio;
    const root=s.root,source=this.source,slot=this.pitchSlot.value;
    const model=this.pitchModel(slot,true),variant=slot==='B'?this.variant:null;
    const label=s.draft.name+' · Sample Lab '+slot;
    await s.playPrepared(()=>this.prepare(slot),label,{restorePrevious:true,keyboardFx:'dry'});
    s.liveRoute.prepare=()=>prepareLabPreview(s.player,root,source,model,variant);
    s.liveRoute.lab=this;
    this.status.textContent='Dry keyboard preview active.';
    this.route.textContent=s.route.textContent;
  }
  async test(both=false) {
    const s=this.studio;
    const test=this.tests.find(test=>test.id===this.testInput.value);
    const capture=new AbortController();
    this.capture=capture;this.cancelTest.hidden=false;
    const slots=both?['A','B']:[this.pitchSlot.value];
    const renders={};
    try{
      s.daw.audioExport.exporter.checkIdle();
      const release=Math.max(...this.model.regions.map(region=>labEnvelope(this.model,region).releaseMs));
      for(const slot of slots){
        capture.signal.throwIfAborted();
        const ref=await this.prepare(slot);
        renders[slot]=await captureLabTest(s.daw,ref,test,release,{signal:capture.signal,onProgress:(stage,fraction)=>{
          this.status.textContent=slot+' · '+stage+' · '+percent(fraction);
        }});
      }
      this.comparison={renders,test};
      this.updateResult();
      this.status.textContent=both?'Dry A/B captures ready.':'Dry capture ready.';
    }finally{this.capture=null;this.cancelTest.hidden=true;}
  }
  paintTest(test,{metrics,clipped,channelLevels}) {
    const {pitch,sustainDb,maxStep,tailMs,truncated}=metrics;
    const measuredPitch=pitch?.hz?
      pitch.hz.toFixed(1)+' Hz · '+percent(pitch.confidence)+' confidence · '+pitch.spreadCents.toFixed(1)+' cents spread':'Unavailable';
    const readings=[
      ['Output peak',channels(channelLevels,'peak')],['Output RMS',channels(channelLevels,'rms')],
      ['Clipping detected',clipped?clipped+' samples above full scale · lower the gain':'0 samples above full scale'],
      ['Pitch confidence',measuredPitch],
      ['Largest held sample step',maxStep.toFixed(4)+' FS'],
      ['Sustain stability',!test.held||sustainDb==null?'Insufficient held signal':sustainDb.toFixed(2)+' dB across 50 ms windows'],
      ['Note Off tail',tailMs.toFixed(0)+' ms above −60 dBFS'+(truncated?' · capture boundary reached':'')],
    ];
    const heading=el('strong','',test.label);
    this.testReport.append(heading);
    const list=el('dl');
    for(const [term,value] of readings)list.append(el('dt','',term),el('dd','',value));
    this.testReport.append(list,el('small','ww-muted','Dry DAW mixer tap before WAV encoding. Pitch estimates apply to single-note tests. Peak and sample steps alone cannot identify aliasing.'));
  }
  updateResult() {
    const slot=this.pitchSlot.value;
    this.result=this.comparison?.renders[slot];
    this.listen.disabled=this.download.disabled=!this.result;
    this.testReport.replaceChildren();
    if(this.result)this.paintTest({...this.comparison.test,label:slot+' · '+this.comparison.test.label},this.result);
    if(this.comparison?.renders.A&&this.comparison.renders.B){
      const {A,B}=this.comparison.renders;
      this.testReport.prepend(el('p','ww-muted','A peak '+db(A.peak)+' · B peak '+db(B.peak)+
        ' · identical MIDI sequence. Select A or B in Pitch & Timbre to hear or download its capture.'));
    }
  }
  downloadWav() {
    const url=URL.createObjectURL(this.result.wav),anchor=el('a');
    anchor.href=url;anchor.download='waswan-sample-lab-'+this.pitchSlot.value+'.wav';anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async apply() {
    const s=this.studio;
    const useVariant=this.pitchSlot.value==='B';
    const {draft,model,sample}=useVariant?
      await persistLabPitch(s.root,s.draft,this.source,this.model,this.variant,this.pitchGain()):
      await materializeLab(s.root,s.draft,this.source,this.model);
    const next=updateWorking(draft,{instrument:model});
    if(next.history!==s.draft.history){s.dirty=true;s.resultStale=true;}
    s.regionId=this.regionId;
    this.bound=s.draft=next;
    if(useVariant){
      const {file}=this.variant;
      this.source={...this.source,file,sample,transient:false};
      this.model=model;
      this.loop=this.region.loop??this.defaultLoop(this.region);
      this.variant=null;this.sourcePartial=false;
      this.pitchSlot.replaceChildren(new Option('A · Native Resampling','A'));
      this.pitchStatus.textContent='Processed variant applied. The previous map is available in Undo.';
      const [start,end]=this.region.frames;
      this.peaks=await runOffline(file,{type:'waveform',start,end,bins:900});
      this.metrics=await runOffline(file,{type:'lab-source',range:{start,end}});
      this.previewRef=null;this.comparison=null;this.updateResult();this.refresh();
    }else if(this.source.transient){
      this.model=model;
      this.source={...this.source,transient:false,sample:draft.rendered};
    }
    this.status.textContent='Variant applied to the Working Copy. Use Undo in Versions & History to recover the previous map.';
  }
  refresh() {
    const region=this.region,envelope=this.envelope;
    for(const [key,{input,slider}] of this.envelopeInputs){
      input.value=envelope[key];slider.value=key==='sustain'?envelope[key]:timePosition(envelope[key]);
    }
    this.previous.disabled=!this.previousEnvelope;
    this.compareButton.disabled=!this.variant;
    this.renderPitchButton.disabled=!!region.fixedPitch||region.key[0]===region.key[1];
    this.playback.value=region.mode;
    this.loopEnable.disabled=region.trigger!=='attack';
    this.loopEnable.checked=!!region.loop;
    this.loopMode.value=this.loop.mode;
    for(const [key,input] of this.loopFields){
      input.value=this.loop[key]??0;
      input.min=key==='crossfade'?0:region.frames[0]+Number(key==='end');
      input.max=key==='crossfade'?Math.floor((this.loop.end-this.loop.start-Number(this.loop.mode==='pingPong'))/2):region.frames[1];
    }
    const rate=this.source.sample.sampleRate;
    this.loopTime.textContent='Local sample time · '+(this.loop.start/rate).toFixed(3)+'–'+(this.loop.end/rate).toFixed(3)+
      ' s · crossfade '+(1000*(this.loop.crossfade??0)/rate).toFixed(2)+' ms';
    this.gain.value=region.gainDb;
    const metrics=this.metrics;
    this.sourceReadout.textContent='Source level · '+channels(metrics.levels,'peak')+
      (this.sourcePartial?' · first 16 s':'')+' · Pitch confidence '+percent(metrics.pitch.confidence)+
      (metrics.levels.some(c=>c.rail)?' · PCM full-scale samples present':'');
    const prior=this.testInput.value;
    this.tests=labTests(region);
    this.testInput.replaceChildren(...this.tests.map(t=>new Option(t.label,t.id)));
    if(this.tests.some(t=>t.id===prior))this.testInput.value=prior;
    const peak=Math.max(...this.metrics.levels.map(c=>c.peak));
    const group=this.model.groups.find(g=>g.id===region.group);
    const estimate=4*peak*10**((this.model.gainDb+group.gainDb+region.gainDb)/20);
    this.route.textContent='Four-voice peak estimate · '+db(estimate)+(estimate>=1?' · saturation possible':'')+
      ' · assumes aligned copies of this region. '+this.studio.route.textContent;
    this.envelopeGraph.paint();this.waveGraph.paint();
  }
}
