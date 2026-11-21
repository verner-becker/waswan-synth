// SPDX-License-Identifier: GPL-3.0-only
import {detectPitch,suggestLoops} from './sampler-analysis.js';
import {checkFrameRange} from './sampler-waveform.js';

export const labMaxSeconds=16;
const minRms=.003;
const dbRatio=(hi,lo)=>20*Math.log10(Math.max(1e-9,hi)/Math.max(1e-9,lo));
const rms=(channels,from,to,read)=>{
  let energy=0;
  for(let i=from;i<to;i++) for(let ch=0;ch<channels;ch++) energy+=read(i,ch)**2;
  return Math.sqrt(energy/((to-from)*channels));
};

export function labLevels({pcm,channels}) {
  return Array.from({length:channels},(_,ch)=>{
    let peak=0,energy=0,rail=0;
    for(let i=ch;i<pcm.length;i+=channels){
      const value=pcm[i];peak=Math.max(peak,Math.abs(value));energy+=value**2;
      if(value>=32767/32768||value<=-1)rail++;
    }
    return {peak,rms:Math.sqrt(energy/(pcm.length/channels)),rail};
  });
}

function harmonicProfile(read,channels,start,length,hz,rate) {
  const result=[];
  for(let harmonic=1;harmonic<=5;harmonic++){
    let energy=0;
    for(let ch=0;ch<channels;ch++){
      let real=0,imag=0;
      for(let i=0;i<length;i++){
        const angle=2*Math.PI*harmonic*hz*i/rate;
        const value=read(start+i,ch)*(.5-.5*Math.cos(2*Math.PI*i/(length-1)));
        real+=value*Math.cos(angle);imag+=value*Math.sin(angle);
      }
      energy+=real**2+imag**2;
    }
    result.push(Math.sqrt(energy));
  }
  const total=result.reduce((a,b)=>a+b,0);
  return result.map(value=>total?value/total:0);
}

// A model of the integer-frame loop traversal for ranking. Performance Test
// captures the actual Hermite reader and envelope in the shared WASM host.
function loopReader(pcm,channels,{start,end,mode,crossfade=0},reverse) {
  const span=end-start,ping=mode==='pingPong',leg=span-Number(ping)-crossfade;
  const value=(offset,ch)=>pcm[((reverse?end-1-offset:start+offset)*channels)+ch];
  function read(frame,ch) {
    const cycle=frame%(ping?2*leg:leg),back=ping?cycle<leg:mode==='reverse';
    const offset=Number(ping)+crossfade+cycle%leg;
    const a=value(back?span-1-offset:offset,ch);
    if(!crossfade||offset<span-crossfade)return a;
    const n=offset-span+crossfade;
    const b=value(ping?(back?n+1:span-2-n):(back?span-1-n:n),ch);
    return a+(b-a)*(n+1)/(crossfade+1);
  }
  return {read,leg,cycle:ping?2*leg:leg};
}

export function measureLabLoop(audio,loop,{reverse=false,offsets=[-12,0,12]}={}) {
  const {pcm,channels,sampleRate}=audio;
  checkFrameRange(loop,pcm.length/channels);
  const {read,leg,cycle}=loopReader(pcm,channels,loop,reverse);
  const edgeWidth=Math.min(leg,Math.round(sampleRate*.025));
  const seams=loop.mode==='pingPong'?[leg,cycle]:[cycle];
  let seam=0,slope=0,endsDb=0;
  for(const at of seams){
    const before=rms(channels,at-edgeWidth,at,read),after=rms(channels,at,at+edgeWidth,read);
    endsDb=Math.max(endsDb,dbRatio(Math.max(before,after),Math.min(before,after)));
    const scale=Math.max(minRms,(before+after)/2);
    for(let ch=0;ch<channels;ch++){
      const a=read(at-2+cycle,ch),b=read(at-1,ch),c=read(at,ch),d=read(at+1,ch);
      seam=Math.max(seam,Math.abs(c-b)/scale);
      slope=Math.max(slope,Math.abs((d-c)-(b-a))/scale);
    }
  }
  const pitch=detectPitch({...audio,pcm:pcm.subarray(loop.start*channels,loop.end*channels)});
  let harmonicDistance=null;
  if(pitch.hz){
    const width=Math.min(leg,Math.round(4*sampleRate/pitch.hz));
    if(width>=2*sampleRate/pitch.hz){
      harmonicDistance=Math.max(...seams.map(at=>{
        const before=harmonicProfile(read,channels,at-width,width,pitch.hz,sampleRate);
        const after=harmonicProfile(read,channels,at,width,pitch.hz,sampleRate);
        return before.reduce((sum,value,i)=>sum+Math.abs(value-after[i]),0)/2;
      }));
    }
  }
  const ranges=offsets.map(offset=>{
    const ratio=2**(offset/12), duration=cycle/(sampleRate*ratio);
    const bins=Math.max(12,Math.min(128,Math.ceil(duration/.015)));
    const window=pitch.hz?Math.round(Math.max(2,pitch.hz*ratio*.025)*sampleRate/(pitch.hz*ratio)):Math.round(sampleRate*.018);
    const width=Math.max(8,window);
    const levels=[];
    for(let i=0;i<bins*2;i++){
      const start=Math.floor(i*cycle/bins);
      // Sample at the transposed clock and interpolate for the energy estimate.
      levels.push(rms(channels,0,width,(j,ch)=>{
        const at=start+j*ratio,frame=Math.floor(at),weight=at-frame;
        return read(frame,ch)*(1-weight)+read(frame+1,ch)*weight;
      }));
    }
    levels.sort((a,b)=>a-b);
    return {offset,cycleMs:duration*1000,rippleDb:dbRatio(levels[Math.floor(levels.length*.9)],levels[Math.floor(levels.length*.1)])};
  });
  return {seam,slope,endsDb,harmonicDistance,ranges,pitch,rms:rms(channels,0,cycle,read)};
}

export function optimizeLabLoop(audio,range,options={}) {
  const {pcm,channels,sampleRate}=audio;
  checkFrameRange(range,pcm.length/channels);
  const span=range.end-range.start;
  if(span<sampleRate*.22)return [];
  const pitch=detectPitch({...audio,pcm:pcm.subarray(range.start*channels,range.end*channels)});
  const radius=pitch.hz?Math.min(2048,Math.ceil(sampleRate/pitch.hz)):256;
  const best=[];
  const windows=[[.08,.92],[.12,.78],[.22,.88],[.27,.74],[.36,.91],[.44,.80]];
  for(const [lo,hi] of windows){
    const start=range.start+Math.floor(lo*span),end=range.start+Math.floor(hi*span);
    const previous=suggestLoops(audio,{start,end,radius}).filter(p=>p.end<=range.end&&p.error<.22).slice(0,2);
    for(const point of previous){
      if(point.end-start<sampleRate*.13)continue;
      const loop={start,end:point.end,mode:'forward',crossfade:0};
      const variants=[0,.003,.010,.020].map(seconds=>{
        const candidate={...loop,crossfade:Math.round(seconds*sampleRate)};
        const metrics=measureLabLoop(audio,candidate,options);
        const ripple=Math.max(...metrics.ranges.map(r=>r.rippleDb));
        const score=metrics.seam+metrics.slope+metrics.endsDb/6+ripple/4+point.error+(metrics.harmonicDistance??0);
        return {loop:candidate,metrics,ripple,score};
      });
      const chosen=variants.filter(({metrics:m,ripple})=>m.rms>=minRms&&m.seam<=.85&&m.slope<=1.2&&
        m.endsDb<=4&&ripple<=6&&(m.harmonicDistance??0)<=.45&&m.pitch.reason!=='unstable-period'&&
        (!pitch.hz||m.pitch.hz&&Math.abs(1200*Math.log2(m.pitch.hz/pitch.hz))<=45))
        .sort((a,b)=>a.score-b.score)[0];
      if(chosen)best.push(chosen);
    }
  }
  const distinct=[];
  for(const candidate of best.sort((a,b)=>a.score-b.score)){
    if(distinct.some(({loop})=>Math.abs(loop.start-candidate.loop.start)+Math.abs(loop.end-candidate.loop.end)<sampleRate*.04))continue;
    distinct.push(candidate);
    if(distinct.length===3)break;
  }
  return distinct;
}

export function labPerformanceMetrics(audio,{off,heldFrom,monophonic}) {
  const {pcm,channels,sampleRate}=audio;
  const frames=pcm.length/channels,offFrame=Math.round(off*sampleRate);
  const first=Math.min(offFrame,Math.round(heldFrom*sampleRate));
  const held={...audio,pcm:pcm.subarray(first*channels,offFrame*channels)};
  const window=Math.round(sampleRate*.05),level=[];
  const read=(i,ch)=>pcm[i*channels+ch];
  let maxStep=0,tailFrame=offFrame;
  for(let i=0;i<frames;i++)for(let ch=0;ch<channels;ch++){
    const current=read(i,ch);
    if(i && i>=first && i<offFrame)maxStep=Math.max(maxStep,Math.abs(current-read(i-1,ch)));
    if(i>=offFrame && Math.abs(current)>.001)tailFrame=i+1;
  }
  for(let i=first;i+window<=offFrame;i+=window)level.push(rms(channels,i,i+window,read));
  const maxLevel=Math.max(0,...level),minLevel=Math.min(...level);
  const interrupted=level.length>1 && maxLevel>.001 && minLevel<Math.max(.001,maxLevel*.0316);
  const sustainDb=level.length>1 && maxLevel>.001 && !interrupted?dbRatio(maxLevel,minLevel):null;
  return {levels:labLevels(audio),maxStep,sustainDb,interrupted,
    pitch:monophonic&&held.pcm.length?detectPitch(held):null,
    tailMs:1000*(tailFrame-offFrame)/sampleRate,truncated:tailFrame>=frames-window};
}
