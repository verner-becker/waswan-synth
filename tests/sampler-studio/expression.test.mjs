// SPDX-License-Identifier: GPL-3.0-only
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Engine} from '../../.local/www/simulator/engine.js';
import {SamplerRuntime} from '../../web/sampler-runtime.js';
import {compile,createInstrument,explainNote} from '../../web/sampler-instrument.js';
const engine=new Engine(fs.readFileSync('.local/build/waswan-256.wasm'),fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
engine.advance(4000);
const x=engine.ex, runtime=new SamplerRuntime(x), libraryId='measure';
x.waswan_mel_patch();
const patches=new Uint8Array(x.memory.buffer,x.waswan_daw_stage_buffer(),160);
patches.copyWithin(80,0,80);
assert(x.waswan_daw_apply(3,x.waswan_daw_token()));
x.waswan_daw_taps(1);
const base={id:'zone',sample:'wave',group:'main',root:60};
function install(id,pcm,regions,options={},parts=[0]) {
  x.waswan_daw_stop(1);x.waswan_daw_live_stop(0xffffffff,1);engine.render(128);engine.render(128);
  const sample={id:'wave',path:'Samples/wave.wav',sha256:createHash('sha256').update(pcm).digest('hex'),
    channels:2,sampleRate:44100,frames:pcm.length/2};
  const model=createInstrument({id,revision:1,samples:[sample],regions,...options});
  const ref={libraryId,instrumentId:id,revision:1};
  const {token,sampleIds}=runtime.command({t:'daw-sampler-begin',request:id,ref,instrument:model});
  for(const sampleId of sampleIds)for(let offset=0;offset<pcm.length;offset+=32768)
    runtime.command({t:'daw-sampler-chunk',token,sampleId,offset,pcm:pcm.subarray(offset,offset+32768)});
  runtime.command({t:'daw-sampler-commit',token});
  runtime.applySlots(runtime.prepareSlots(parts.map(part=>({...ref,part,trackId:'track'+part,type:'sampler'}))));
  return model;
}
function capture(frames,part=0,channel=0) {
  const out=new Float32Array(frames);
  for(let i=0;i<frames;i+=128){engine.render(128);out.set(new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(part,channel),128),i);}
  return out;
}
const seq=(key,velocity,id=1,part=0,ch=0)=>assert(x.waswan_sampler_note_id(part,key,velocity,ch,id));
const control=(kind,n,v,channel=0,part=0)=>assert(x.waswan_sampler_control(part,channel,0,kind,n,v,0));
const active=()=>Array.from({length:256},(_,i)=>x.waswan_sampler_voice_region(i)).filter(Boolean);
const signal=Int16Array.from({length:64},(_,i)=>(i%2?-1:1)*(1+Math.floor(i/2))*500);
const level=i=>(i+1)*500/32768;
function outputVector(name,region,want) {
  install(name,signal,[{...base,frames:[4,24],...region}]);
  seq(60,100);const audio=capture(512);
  const start=audio.findIndex(value=>Math.abs(value)>.0001);
  assert(start>=0);
  want.forEach((expected,i)=>assert(Math.abs(audio[start+i]-expected)<.00005,
    name+' frame '+i+' actual='+audio[start+i]+' expected='+expected));
}
outputVector('back',{reverse:true},[23,22,21,20,19,18].map(level));
outputVector('forward',{loop:{start:6,end:10}},[4,5,6,7,8,9,6,7,8,9].map(level));
outputVector('reverseLoop',{loop:{start:6,end:10,mode:'reverse'}},[4,5,9,8,7,6,9,8].map(level));
outputVector('ping',{loop:{start:6,end:10,mode:'pingPong'}},[4,5,6,7,8,9,8,7,6,7,8,9].map(level));
outputVector('fade',{loop:{start:6,end:10,crossfade:1}},[4,5,6,7,8,7.5,7,8,7.5].map(level));
outputVector('pingFade',{loop:{start:6,end:10,mode:'pingPong',crossfade:1}},[4,5,6,7,8,8.5,7,6.5,8,8.5].map(level));
outputVector('revFade',{loop:{start:6,end:10,mode:'reverse',crossfade:1}},[4,5,9,8,7,7.5,8,7].map(level));
outputVector('reverseRegionLoop',{reverse:true,loop:{start:17,end:21}},
  [23,22,21,20,19,18,17,20,19,18].map(level));

function hermite(a,b,c,d,t) {return b+.5*t*((c-a)+t*((2*a-5*b+4*c-d)+t*(3*(b-c)+d-a)));}
for (const [name,mode,reverse] of [['fracForward','forward',false],['fracRev','reverse',false],['fracPing','pingPong',true]]) {
  const first=4,end=24,start=6,last=10;
  const raw=(k)=>{
    if(k<0)k=0;
    const intro=reverse?end-last:start-first;
    if(k<intro)return level(reverse?end-k-1:first+k);
    let j=k-intro;const n=last-start;
    if(mode==='pingPong'){j%=2*n-2;if(j>=n)j=2*n-2-j;}else {j%=n;if(mode==='reverse')j=n-1-j;}
    return level(reverse?last-1-j:start+j);
  };
  const expect=Array.from({length:64},(_,i)=>{const q=Math.floor(i/2);return i%2?hermite(raw(q-1),raw(q),raw(q+1),raw(q+2),.5):raw(q);});
  outputVector(name,{reverse,cents:-1200,loop:{start,end:last,mode}},expect);
}

const long=Int16Array.from({length:44100*2},(_,i)=>i%2?0:Math.round(3500*(Math.sin(2*Math.PI*220*i/88200)+Math.sin(2*Math.PI*5000*i/88200))));
const repeating={...base,loop:{start:0,end:44100}};
function amplitude(pcm,hz) {
  let re=0,im=0;for(let i=0;i<pcm.length;i++){const t=2*Math.PI*hz*i/44100,w=.5-.5*Math.cos(2*Math.PI*i/pcm.length);re+=pcm[i]*w*Math.cos(t);im+=pcm[i]*w*Math.sin(t);}
  return 4*Math.hypot(re,im)/pcm.length;
}
function peak(pcm){return pcm.reduce((n,v)=>Math.max(n,Math.abs(v)),0);}
const spectral={};
for(const type of ['lowpass','highpass','bandpass']) {
  install(type,long,[repeating],{filter:{type,cutoffHz:type==='bandpass'?220:1000,resonance:.45}});
  seq(60,100);capture(2048);const pcm=capture(8192);spectral[type]=[amplitude(pcm,220),amplitude(pcm,5000)];
  assert(peak(capture(256,0,1))===0,'stereo filter preserves silent right channel');
}
assert(spectral.lowpass[0]>spectral.lowpass[1]*10);
assert(spectral.highpass[1]>spectral.highpass[0]*10);
assert(spectral.bandpass[0]>spectral.bandpass[1]*10);

const flat=new Int16Array(16384).fill(4096);
const constant={...base,loop:{start:0,end:8192}};
install('ampEnv',flat,[constant],{envelope:{attackMs:20,decayMs:20,sustain:.25,releaseMs:20}});
seq(60,100);const attack=capture(3072);
const onset=attack.findIndex(v=>v>0);
assert(attack[onset+100]<.025 && attack[onset+880]>.115);
assert(Math.abs(attack.at(-1)-.03125)<.0005);
seq(60,0);const release=capture(2048);assert(peak(release.subarray(0,512))>.018 && peak(release.subarray(onset+900))===0,JSON.stringify([onset,release[0],release[512],release[1040],release[1280],release.at(-1),active()]));
assert.equal(active().length,0);

install('expression',long,[repeating],{filter:{type:'lowpass',cutoffHz:300,resonance:0},
  modulation:[{source:'channelPressure',destination:'cutoffOctaves',depth:5},
    {source:'polyPressure',destination:'gainDb',depth:-18},
    {source:{cc:74},destination:'pan',depth:1}]});
seq(60,100);capture(1024);const dark=amplitude(capture(8192),5000);
control(1,0,127,2);assert(amplitude(capture(8192),5000)<dark*1.1);
control(1,0,127);const bright=amplitude(capture(8192),5000);assert(bright>dark*25);
control(2,62,127);assert(amplitude(capture(8192),5000)>bright*.95);
control(2,60,127);assert(amplitude(capture(8192),5000)<bright*.2);
control(0,74,127);capture(512);assert(peak(capture(1024))===0);

install('aux',flat,[constant],{auxEnvelope:{attackMs:100,decayMs:0,sustain:1,releaseMs:10},
  modulation:[{source:'auxEnvelope',destination:'gainDb',depth:-24}]});
seq(60,100);const aux=capture(8192);assert(peak(aux.subarray(0,256))>.1 && peak(aux.subarray(6000))<.012);
install('filterEnv',long,[repeating],{filter:{type:'lowpass',cutoffHz:250,resonance:.2},
  filterEnvelope:{attackMs:200,decayMs:0,sustain:1,releaseMs:20},
  modulation:[{source:'filterEnvelope',destination:'cutoffOctaves',depth:5}]});
seq(60,100);const sweep=capture(16384);
assert(amplitude(sweep.subarray(12000),5000)>amplitude(sweep.subarray(0,2048),5000)*8);
for (const shape of ['sine','triangle']){
  install(shape,flat,[constant],{lfo:{rateHz:5,shape},modulation:[{source:'lfo',destination:'gainDb',depth:10}]});
  seq(60,100);capture(1024);const trem=capture(32768);
  assert(amplitude(trem,5)>.08 && amplitude(trem,5)>8*amplitude(trem,16),JSON.stringify([shape,amplitude(trem,5),amplitude(trem,16)]));
}

const kit={kind:'kit',groups:[{id:'open',choke:'hats'},{id:'closed',choke:'hats'},{id:'snare',voiceLimit:2}],
  pads:[{id:'openPad',index:1,note:36,groups:['open']},{id:'closedPad',index:2,note:38,groups:['closed']},
    {id:'snarePad',index:3,note:40,groups:['snare']}]};
const kitModel=install('kit',signal,['open','closed','snare'].map(group=>({...base,id:group,group,mode:'oneShot'})),kit,[0,1]);
seq(36,110,1,0);seq(36,110,2,1);assert.deepEqual(active(),[1,1]);
seq(38,110,3,0);assert.deepEqual(active().sort(),[1,2]); // second track's open hi-hat survives
seq(40,80,4);seq(40,80,5);seq(40,80,6);assert.equal(active().filter(r=>r===3).length,2);
assert.equal(explainNote(compile(kitModel),{type:'noteOn',note:36,velocity:100}).voices[0].cents,0);
seq(41,100,7);assert.equal(active().length,4);
const rootAudio=capture(512,1);const start=rootAudio.findIndex(v=>v>0);
assert(start>=0);assert(Math.abs(rootAudio[start+2]-level(2))<.0001,'pad pitch stays at the sample root');
const art=install('art',flat,[{...constant,articulation:'dry'},{...constant,id:'wetZone',articulation:'wet'}],{
  articulations:[{id:'dry',select:{cc:40,range:[0,63]}},{id:'wet',select:{cc:40,range:[64,127]}}],
  initialArticulation:'dry'});
let theor=explainNote(compile(art),{type:'cc',controller:40,value:70});
assert.equal(explainNote(compile(art),{type:'noteOn',note:60,velocity:100},theor.state).voices[0].regionId,'wetZone');
control(0,40,70);seq(60,110);assert.deepEqual(active(),[2]);
control(0,64,127);seq(60,0);capture(512);assert.deepEqual(active(),[2]);
control(0,64,0);capture(512);assert.deepEqual(active(),[]);
console.log('PASS cubic neighbours, both source directions, reverse/ping-pong loops and crossfades, group limits, isolated kit choke, CC articulation/pedal, ADSR, stereo SVF and modulation',spectral);

install('pitchWheel',long,[repeating],{modulation:[{source:'wheel',destination:'pitchCents',depth:1200}]});
control(0,1,127,1);seq(60,100,51,0,1);capture(512);
const shifted=capture(8192);assert(amplitude(shifted,440)>20*amplitude(shifted,220));
const model=compile(createInstrument({id:'explain',revision:1,samples:[{id:'wave',path:'wave.wav',
  sha256:'1'.repeat(64),sampleRate:44100,channels:2,frames:44100}],regions:[repeating],
  modulation:[{source:'wheel',destination:'pitchCents',depth:1200}]}));
const moved=explainNote(model,{type:'cc',controller:1,value:127});
assert.equal(explainNote(model,{type:'noteOn',note:60,velocity:100},moved.state).voices[0].cents,1200);

install('resonance',long,[repeating],{filter:{type:'bandpass',cutoffHz:220,resonance:0},
  modulation:[{source:'wheel',destination:'resonance',depth:.9}]});
seq(60,80);capture(4096);const dry=amplitude(capture(4096),220);
control(0,1,127);capture(4096);const resonant=amplitude(capture(4096),220);assert(resonant>2*dry);
for(let i=0;i<32;i++) {control(0,1,i%2?0:127);const mod=capture(128);assert(mod.every(Number.isFinite));}

install('padSource',flat,[constant],{},[0]);
runtime.command({t:'daw-sampler-live',ref:{libraryId,instrumentId:'padSource',revision:1}});
engine.input({t:'midi',st:144,d1:60,d2:100});engine.advance(20);
assert(x.waswan_sampler_live_pad(1,60,100));assert.equal(active().length,2);
engine.input({t:'midi',st:128,d1:60,d2:0});engine.advance(20);assert.equal(active().length,1);
assert(x.waswan_sampler_live_pad(1,60,0));engine.advance(30);assert.equal(active().length,0);
runtime.command({t:'daw-sampler-live',ref:null});

seq(60,100,80,0,0);seq(60,110,81,0,1);seq(65,90,82,0,1);
control(0,123,0,1);capture(512);assert.equal(active().length,1);
control(0,120,0,0);capture(512);assert.equal(active().length,0);
console.log('PASS per-channel wheel transposition, JS/WASM modulation parity, resonance, channel-mode cleanup and independent physical-key/pad owners.');

install('livePressure',flat,[constant],{gainDb:-12,modulation:[{source:'channelPressure',destination:'gainDb',depth:12}]});
assert(x.waswan_daw_live_note_channel(0,3,60,100));
function liveLevel() {
  for(let tick=0;tick<6;tick++)engine.render(128);
  return peak(new Float32Array(x.memory.buffer,x.waswan_daw_live_output(0,0),128));
}
const liveBase=liveLevel();
assert(x.waswan_sampler_control(0,3,0,1,0,127,0));
assert.equal(liveLevel(),liveBase,'sequencer controls leave the live owner unchanged');
assert(x.waswan_sampler_control(0,2,1,1,0,127,0));
assert.equal(liveLevel(),liveBase,'live channel pressure respects the MIDI channel');
assert(x.waswan_sampler_control(0,3,1,1,0,127,0));
assert(liveLevel()>3.8*liveBase);
assert.equal(x.waswan_sampler_control(0,0,2,1,0,127,0),0,'no Synth sampler is bound');
console.log('PASS live monitor pressure, sequencer/keyboard source isolation and MIDI channels.');
