// SPDX-License-Identifier: GPL-3.0-only
// Musical data only. Track IDs never encode firmware part numbers or UI layout.
export const RATE=44100,PPQ=960;
export const LIMITS={tracks:32,assets:32,clips:512,notes:65536,json:16*1024*1024,totalFrames:RATE*1800,sourceFrames:RATE*1200};
export const uuid=()=>crypto.randomUUID();
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const number=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b;
const id=s=>typeof s==='string'&&/^[\w-]{1,80}$/.test(s);
const text=(s,n)=>typeof s==='string'&&s.length>0&&s.length<=n;
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const unique=(items,label)=>{const ids=new Set();for(const item of items){assert(id(item?.id)&&!ids.has(item.id),`Invalid or duplicate ${label} ID`);ids.add(item.id);}return ids;};
export function emptyProject(){return {format:'waswan-daw-project',version:3,id:uuid(),name:'Untitled',sampleRate:RATE,ppq:PPQ,bpm:120,meter:[4,4],length:PPQ*16,transport:{loop:false,start:0,end:PPQ*16},tracks:[],clips:[],assets:[],markers:[],automation:[],master:{volume:1,fx:[]}};}
export function validateFx(effects){
  assert(Array.isArray(effects)&&effects.length<=16,'FX chain limit: 16');unique(effects,'effect');
  for(const e of effects){
    assert(['eq','compressor','reverb','delay','chorus','limiter','saturation'].includes(e.type)&&typeof e.bypass==='boolean'&&e.parameters&&Object.getPrototypeOf(e.parameters)===Object.prototype,'Invalid effect');
    const entries=Object.entries(e.parameters);assert(entries.length<=32&&entries.every(([key,value])=>/^[a-zA-Z][\w-]{0,31}$/.test(key)&&number(value,-100000,100000)),'Invalid FX parameters');
  }
}
export function validateProject(p){
  assert(p?.format==='waswan-daw-project'&&p.version===3&&id(p.id)&&text(p.name,120)&&p.sampleRate===RATE&&p.ppq===PPQ,'Invalid DAW project');
  assert(number(p.bpm,40,240)&&Array.isArray(p.meter)&&p.meter.length===2&&int(p.meter[0],1,12)&&[4,8].includes(p.meter[1])&&int(p.length,1,PPQ*8192),'Invalid project time');
  if(p.transport!==undefined)assert(typeof p.transport?.loop==='boolean'&&int(p.transport.start,0,PPQ*8192-1)&&int(p.transport.end,p.transport.start+1,PPQ*8192),'Invalid transport interval');
  assert(Array.isArray(p.tracks)&&p.tracks.length<=LIMITS.tracks&&Array.isArray(p.assets)&&p.assets.length<=LIMITS.assets&&Array.isArray(p.clips)&&p.clips.length<=LIMITS.clips,'Project capacity exceeded');
  const tracks=unique(p.tracks,'track'),assets=unique(p.assets,'asset');unique(p.clips,'clip');
  let total=0,notes=0,midiEvents=0;
  for(const a of p.assets){assert(text(a.name,120)&&a.sampleRate===RATE&&a.channels===2&&int(a.frames,1,LIMITS.sourceFrames)&&a.bytes===44+a.frames*4,'Invalid audio source');total+=a.frames;}
  assert(total<=LIMITS.totalFrames,'Decoded audio budget: 30 minutes total / 20 minutes per source');
  for(const t of p.tracks){
    assert(['audio','midi'].includes(t.type)&&text(t.name,80)&&text(t.icon,32)&&/^#[a-fA-F0-9]{6}$/.test(t.color)&&number(t.volume,0,2)&&number(t.pan,-1,1)&&typeof t.mute==='boolean'&&typeof t.solo==='boolean'&&['in','auto','off'].includes(t.monitor),'Invalid track');
    if(t.arm!==undefined)assert(typeof t.arm==='boolean','Invalid track arm');
    if(t.instrument!==null){assert(t.type==='midi'&&['analog','super','drumx'].includes(t.instrument?.type)&&Array.isArray(t.instrument.patch)&&t.instrument.patch.length===80&&t.instrument.patch.every(v=>int(v,0,255)),'Invalid instrument snapshot');}
    validateFx(t.fx);
  }
  assert(p.tracks.filter(t=>t.arm).length<=1,'Only one track can be armed');
  for(const c of p.clips){
    const track=p.tracks.find(t=>t.id===c.trackId);
    assert(tracks.has(c.trackId)&&c.type===track.type&&text(c.name,120)&&['ticks','seconds'].includes(c.position?.unit)&&number(c.position.value,0,c.position.unit==='ticks'?PPQ*8192:1200),'Invalid clip position or track');
    if(c.position.unit==='ticks')assert(Number.isSafeInteger(c.position.value),'Musical clip positions use whole ticks');
    if(c.type==='audio'){
      const a=p.assets.find(a=>a.id===c.assetId);
      assert(assets.has(c.assetId)&&int(c.offset,0,a.frames-1)&&int(c.frames,1,a.frames-c.offset)&&number(c.gain,0,4)&&number(c.pan??0,-1,1)&&int(c.fadeIn,0,c.frames)&&int(c.fadeOut,0,c.frames),'Invalid audio clip');
    }else{
      assert(int(c.length,1,PPQ*8192)&&int(c.loopLength,1,c.length)&&typeof c.loop==='boolean'&&Array.isArray(c.notes),'Invalid MIDI clip');unique(c.notes,'note');
      notes+=c.notes.length;
      for(const n of c.notes)assert(int(n.pitch,0,127)&&int(n.velocity,1,127)&&int(n.start,0,c.loopLength-1)&&int(n.duration,1,c.loopLength-n.start),'Invalid MIDI note');
      for(const n of c.notes)if(n.channel!==undefined)assert(int(n.channel,0,15),'Invalid MIDI note channel');
      if(c.midiEvents!==undefined){assert(Array.isArray(c.midiEvents),'Invalid MIDI performance events');unique(c.midiEvents,'MIDI event');midiEvents+=c.midiEvents.length;for(const e of c.midiEvents)assert(int(e.tick,0,c.loopLength-1)&&int(e.channel,0,15)&&['bend','mod'].includes(e.type)&&int(e.value,e.type==='bend'?-8192:0,e.type==='bend'?8191:127),'Invalid MIDI performance event');}
    }
  }
  assert(notes<=LIMITS.notes,'MIDI note budget exceeded');
  assert(midiEvents<=65536,'MIDI performance event budget exceeded');
  assert(Array.isArray(p.markers)&&p.markers.length<=256,'Invalid markers');unique(p.markers,'marker');
  for(const m of p.markers)assert(text(m.name,80)&&int(m.tick,0,p.length),'Invalid marker');
  assert(Array.isArray(p.automation)&&p.automation.length<=64,'Automation lane limit exceeded');unique(p.automation,'automation');
  const targets=new Set();
  for(const lane of p.automation){
    const target=lane.trackId+':'+lane.target;
    assert(tracks.has(lane.trackId)&&['volume','pan'].includes(lane.target)&&!targets.has(target)&&['linear','step'].includes(lane.curve)&&typeof lane.enabled==='boolean'&&Array.isArray(lane.points)&&lane.points.length<=4096,'Invalid automation lane');targets.add(target);
    let previous=-1;
    for(const point of lane.points){assert(int(point.tick,0,p.length)&&point.tick>previous&&number(point.value,lane.target==='pan'?-1:0,lane.target==='pan'?1:2),'Invalid automation point');previous=point.tick;}
  }
  assert(number(p.master?.volume,0,2),'Invalid master');validateFx(p.master.fx);
  assert(new TextEncoder().encode(JSON.stringify(p)).length<=LIMITS.json,'Project metadata exceeds 16 MiB');
  return p;
}
export function makeTrack(type,name=type==='midi'?'Instrument':'Audio'){
  return {id:uuid(),type,name,icon:type==='midi'?'keyboard':'audio',color:type==='midi'?'#8b6ce0':'#3699bb',volume:1,pan:0,mute:false,solo:false,arm:false,monitor:'auto',instrument:null,fx:[]};
}
export const clipSeconds=(clip,bpm)=>clip.position.unit==='seconds'?clip.position.value:clip.position.value*60/(bpm*PPQ);
export const clipDuration=(clip,bpm)=>clip.type==='audio'?clip.frames/RATE:clip.length*60/(bpm*PPQ);
