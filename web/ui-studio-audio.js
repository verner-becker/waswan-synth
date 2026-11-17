// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {AUDIO_RATE,MAX_ASSET_FRAMES,validateAssets,validateAudioClips} from './studio-audio.js';
export class AudioEditor {
  constructor(owner){
    this.owner=owner;this.assets=[];this.node=Panel('Audio clips','PCM16 WAV · 44.1 kHz · four sources / 120 seconds total');
    const tools=el('div','ww-studio-actions'),label=el('label','','Import audio WAV ');this.file=el('input');this.file.type='file';this.file.accept='.wav,audio/wav';this.file.setAttribute('aria-label','Import audio WAV');label.append(this.file);tools.append(label);
    this.file.onchange=()=>owner.run(async()=>{try{await this.import(this.file.files[0]);}finally{this.file.value='';}});
    this.use=action('Use recorded take audio',()=>owner.run(async()=>{const take=owner.recorder.take;if(!take?.project.frames)throw Error('Record a take first');await this.import(take.audio,'Recorded take');}));tools.append(this.use);
    this.removeUnused=action('Remove unused audio sources',()=>{if(this.locked)return;const used=new Set((owner.sequence.audioClips||[]).map(c=>c.asset));this.assets=this.assets.filter(a=>used.has(a.meta.id));this.cached=null;owner.history=[];owner.draw();});tools.append(this.removeUnused);this.localSave=action('Save browser composition',()=>owner.run(async()=>{if(this.locked)throw Error('Stop transport before saving');await owner.storeProject();const {projectBlob}=await import('./studio-format.js'),take=owner.recorder.take,root=await navigator.storage.getDirectory(),file=await root.getFileHandle('waswan-studio-composition.wsproj',{create:true}),writer=await file.createWritable();try{await writer.write(projectBlob(take.project,take.audio,take.assets));await writer.close();}catch(error){await writer.abort().catch(()=>{});throw error;}this.status.textContent='Composition saved in this browser · export a project file for a portable copy';}));
    this.localRecover=action('Recover browser composition',()=>owner.run(async()=>{if(this.locked)throw Error('Stop transport before recovery');const root=await navigator.storage.getDirectory(),file=await(await root.getFileHandle('waswan-studio-composition.wsproj')).getFile();await owner.recorder.open(file);this.status.textContent='Browser composition recovered · current synth unchanged';}));tools.append(this.localSave,this.localRecover);this.node.append(tools);
    this.status=el('p','ww-muted','Imports are copied into the project. Cuts preserve the source. Audio keeps its original speed when BPM changes; no time stretch. Balance attenuates the opposite stereo side. Overlapping clips can clip: reduce clip gain when needed.');this.node.append(this.status);
    this.list=el('select');this.list.size=4;this.list.setAttribute('aria-label','Audio clips');this.list.onchange=()=>{this.selected=this.list.value;this.draw();};this.node.append(this.list);
    const fields=el('div','ww-sequence-settings');
    const field=(name,value,min,max,step)=>{const label=el('label','',name+' '),input=el('input');input.type='number';Object.assign(input,{value,min,max,step});input.setAttribute('aria-label',name);label.append(input);fields.append(label);return input;};
    this.start=field('Audio start beat',1,1,4097,'any');this.offset=field('Audio source offset seconds',0,0,120,'any');this.duration=field('Audio duration seconds',1,1/AUDIO_RATE,120,'any');this.gain=field('Audio gain',1,0,2,.01);this.pan=field('Audio balance',0,-1,1,.01);
    const labelMute=el('label','','Mute audio clip ');this.mute=el('input');this.mute.type='checkbox';this.mute.setAttribute('aria-label','Mute audio clip');labelMute.append(this.mute);fields.append(labelMute);
    this.apply=action('Apply audio clip edit',()=>owner.edit(s=>{const c=s.audioClips.find(c=>c.id===this.selected);if(!c)throw Error('Select an audio clip');Object.assign(c,{start:Math.round((Number(this.start.value)-1)*960),offset:Math.round(Number(this.offset.value)*AUDIO_RATE),frames:Math.round(Number(this.duration.value)*AUDIO_RATE),gain:Number(this.gain.value),pan:Number(this.pan.value),mute:this.mute.checked});validateAudioClips(s.audioClips,s,this.assets.map(a=>a.meta));}));
    this.duplicate=action('Duplicate audio clip',()=>{const c=owner.sequence.audioClips?.find(c=>c.id===this.selected);if(c)owner.edit(s=>{s.audioClips.push({...c,id:crypto.randomUUID()});});});
    this.delete=action('Delete audio clip',()=>owner.edit(s=>s.audioClips=s.audioClips.filter(c=>c.id!==this.selected)));fields.append(this.apply,this.duplicate,this.delete);this.node.append(fields);
    this.canvas=el('canvas','ww-audio-regions');this.canvas.width=1152;this.canvas.height=180;this.canvas.setAttribute('aria-label','Audio arrangement overview');this.node.append(this.canvas);
  }
  get locked(){return this.owner.playing||this.owner.rendering||this.owner.starting||this.busy||this.owner.recorder.busy;}
  job(message){return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./studio-audio-worker.js',import.meta.url),{type:'module'});this.worker=worker;const timer=setTimeout(()=>finish(Error('Audio operation timed out')),30000);const finish=(error,value)=>{clearTimeout(timer);worker.terminate();if(this.worker===worker){this.worker=null;this.cancelJob=null;}error?reject(error):resolve(value);};this.cancelJob=()=>finish(Error('Audio preparation cancelled'));worker.onerror=()=>finish(Error('Audio worker failed'));worker.onmessage=({data:m})=>m.t==='error'?finish(Error(m.message)):finish(null,m);worker.postMessage(message);});}
  async import(file,name=file?.name||'Audio WAV'){
    if(!file||this.locked)throw Error('Stop playback and recording before importing audio');
    const generation=this.generation||0;this.busy=true;this.draw();
    try{
      if(this.assets.length>=4)throw Error('Remove an unused source before importing another file');
      const result=await this.job({t:'import',file});if((this.generation||0)!==generation)throw Error('Project changed during audio import');
      const asset={meta:{id:crypto.randomUUID(),name:String(name).slice(0,120),frames:result.frames,bytes:result.audio.size},audio:result.audio,peaks:result.peaks};validateAssets([...this.assets,asset].map(a=>a.meta));
      const next=structuredClone(this.owner.sequence),ticks=Math.ceil(result.frames*next.bpm*960/(AUDIO_RATE*60)),bar=960*4/next.meter[1]*next.meter[0];next.length=Math.max(next.length,Math.ceil(ticks/bar)*bar);
      (next.audioClips??=[]).push({id:crypto.randomUUID(),asset:asset.meta.id,start:0,offset:0,frames:result.frames,gain:1,pan:0,mute:false});validateAudioClips(next.audioClips,next,[...this.assets,asset].map(a=>a.meta));
      this.assets.push(asset);this.selected=next.audioClips.at(-1).id;this.owner.replace(next);this.status.textContent='Audio imported · source preserved; save the project to keep it';
    }finally{this.busy=false;this.draw();}
  }
  adopt(take){this.generation=(this.generation||0)+1;this.stop();this.assets=take?.assets||[];this.cached=null;this.selected=null;this.draw();}
  attach(take){take.assets=this.assets;take.project.assets=this.assets.map(a=>a.meta);if(this.assets.length)take.project.version=2;}
  async prepare(context){
    if(!this.owner.sequence.audioClips?.some(c=>!c.mute))return null;
    if(this.cached?.sequence===this.owner.sequence&&this.cached.assets===this.assets)return this.cached.buffer;
    const sequence=this.owner.sequence;validateAudioClips(sequence.audioClips,sequence,this.assets.map(a=>a.meta));
    this.preparing=true;let mixed;try{mixed=await this.job({t:'mix',sequence,assets:this.assets.map(({meta,audio})=>({meta,audio}))});}finally{this.preparing=false;}
    const buffer=context.createBuffer(2,mixed.frames,AUDIO_RATE);buffer.copyToChannel(mixed.left,0);buffer.copyToChannel(mixed.right,1);this.cached={sequence,assets:this.assets,buffer};return buffer;
  }
  play(context,gain,buffer,startFrame,loop){
    this.stop();if(!buffer)return;const source=context.createBufferSource();source.buffer=buffer;source.loop=loop;source.loopStart=0;source.loopEnd=buffer.duration;
    source.connect(gain);source.connect(this.owner.recorder.captureBus());this.source=source;source.onended=()=>{source.disconnect();if(this.source===source)this.source=null;};source.start(startFrame/AUDIO_RATE);
  }
  stop(){if(this.preparing)this.cancelJob?.();if(this.source){try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}}
  draw(){
    const owner=this.owner,clips=owner.sequence.audioClips||[],clip=clips.find(c=>c.id===this.selected),locked=this.locked;
    for(const control of [this.file,this.use,this.removeUnused,this.localSave,this.localRecover])control.disabled=locked;for(const control of [this.start,this.offset,this.duration,this.gain,this.pan,this.mute,this.apply,this.duplicate,this.delete])control.disabled=locked||!clip;
    if(this.drawSequence!==owner.sequence||this.drawAssets!==this.assets){this.drawSequence=owner.sequence;this.drawAssets=this.assets;this.list.replaceChildren();for(const c of clips){const asset=this.assets.find(a=>a.meta.id===c.asset);this.list.add(new Option(`${asset?.meta.name||'Audio'} · beat ${(1+c.start/960).toFixed(2)} · ${(c.frames/AUDIO_RATE).toFixed(3)} s${c.mute?' · muted':''}`,c.id));}}
    this.list.value=this.selected||'';
    if(clip){this.start.value=1+clip.start/960;this.offset.value=clip.offset/AUDIO_RATE;this.duration.value=clip.frames/AUDIO_RATE;this.gain.value=clip.gain;this.pan.value=clip.pan;this.mute.checked=clip.mute;}
    const c=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height;c.fillStyle='#101a20';c.fillRect(0,0,w,h);const total=Math.round(owner.sequence.length*AUDIO_RATE*60/(owner.sequence.bpm*960));
    clips.forEach((clip,i)=>{const x=clip.start/owner.sequence.length*w,width=clip.frames/total*w,y=i%4*42+4,asset=this.assets.find(a=>a.meta.id===clip.asset);c.fillStyle=clip.id===this.selected?'#218f96':'#234851';c.globalAlpha=clip.mute?.35:.9;c.fillRect(x,y,width,38);c.fillStyle='#e1f7f7';c.font='12px sans-serif';c.fillText((asset?.meta.name||'Audio').slice(0,35),x+4,y+14);if(asset?.peaks){c.strokeStyle='#7ef8e0';c.beginPath();for(let p=0;p<128;p++){const source=(clip.offset+clip.frames*p/128)/asset.meta.frames,index=Math.min(255,Math.floor(source*256)),peak=asset.peaks[index]*10;c.moveTo(x+width*p/128,y+26-peak);c.lineTo(x+width*p/128,y+26+peak);}c.stroke();}c.globalAlpha=1;});
  }
}
