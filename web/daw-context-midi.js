// SPDX-License-Identifier: GPL-3.0-only
import {CONTROLS} from './ui-controls.js';

export const MIDI_CONTEXTS={
  performance:{label:'Performance',targets:CONTROLS.map(c=>['synth:'+c.id,c.name])},
  mixer:{label:'Mixer',targets:[['track:volume','Selected track volume'],['track:pan','Selected track pan'],['master:volume','DAW Master volume']]},
  instrument:{label:'Instrument',targets:[[0,'Cutoff'],[1,'Resonance'],[4,'Chorus send'],[5,'Delay send'],[6,'Reverb send']].map(([i,n])=>['synth:'+i,'Synth '+n])},
  envelope:{label:'Envelope',targets:[['synth:2','Synth filter envelope'],['synth:3','Synth amp release']]},
  transport:{label:'Transport',targets:[['transport:play','Play / stop'],['transport:record','Record'],['transport:loop','Loop'],['transport:click','Metronome']]}
};
export const CONTEXT_MIDI_KEY='waswan-daw-midi-profiles-v1';
const contexts=Object.keys(MIDI_CONTEXTS);
const modes=['absolute','offset','twos'];
const limit=(n,a,b)=>Math.max(a,Math.min(b,n));
const validTarget=(context,target)=>Object.hasOwn(MIDI_CONTEXTS,context)&&MIDI_CONTEXTS[context].targets.some(([id])=>id===target);
const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
const text=value=>String(value??'').trim().slice(0,160);
const identity=input=>({id:text(input.id),name:text(input.name),manufacturer:text(input.manufacturer)});
const family=d=>[d.manufacturer,d.name].map(s=>s.toLowerCase()).join('\0');
const sameDevice=(a,b)=>a.id&&a.id===b.id&&family(a)===family(b);
const validBinding=(context,b)=>b&&validTarget(context,b.target)&&integer(b.channel,0,15)&&integer(b.cc,0,119)&&b.cc!==64&&modes.includes(b.mode);
function validateBank(bank){
  return Object.fromEntries(contexts.map(c=>[c,Array.isArray(bank?.[c])?bank[c].filter(b=>validBinding(c,b)).slice(0,64):[]]));
}

export class ContextMidiProfiles {
  constructor(storage,dispatch){
    this.storage=storage;
    this.dispatch=dispatch;
    this.profiles=[];
    this.context='performance';
    this.revision=0x80000000;
    this.enabled=false;
    this.follow=true;
    this.pickup=new Map();
    try{
      const saved=JSON.parse(storage?.getItem(CONTEXT_MIDI_KEY)||'null');
      if(saved?.version===1&&Array.isArray(saved.profiles)){
        this.enabled=!!saved.enabled;this.follow=saved.follow!==false;
        if(Object.hasOwn(MIDI_CONTEXTS,saved.context))this.context=saved.context;
        for(const p of saved.profiles.slice(0,64)){
          if(typeof p?.id!=='string'||!text(p.name)||!p.device||this.profiles.some(v=>v.id===p.id))continue;
          this.profiles.push({id:p.id,name:text(p.name),device:identity(p.device),bindings:validateBank(p.bindings)});
        }
      }
    }catch{}
  }
  notify(){this.onChange?.();}
  save(){
    try{
      this.storage.setItem(CONTEXT_MIDI_KEY,JSON.stringify({version:1,enabled:this.enabled,follow:this.follow,context:this.context,profiles:this.profiles}));
      this.persistenceError=false;
    }catch{this.persistenceError=true;}
    this.notify();
  }
  reset(){this.revision=(0x80000000|((this.revision+1)&0x7fffffff))>>>0;this.pickup.clear();this.learning=null;}
  configure({enabled=this.enabled,follow=this.follow}){
    this.enabled=enabled;this.follow=follow;this.reset();this.save();
  }
  setContext(context,{automatic=false}={}){
    if(!Object.hasOwn(MIDI_CONTEXTS,context)||context===this.context||automatic&&(!this.enabled||!this.follow))return;
    this.context=context;
    this.reset();
    if(automatic)this.notify();else this.save();
  }
  match(input,inputs){
    if(!input)return null;
    const device=identity(input),exact=this.profiles.filter(p=>sameDevice(p.device,device));
    if(exact.length===1)return exact[0];
    const key=family(device);
    if(key==='\0'||inputs.filter(p=>family(identity(p))===key).length!==1)return null;
    const matches=this.profiles.filter(p=>family(p.device)===key);
    return matches.length===1?matches[0]:null;
  }
  selectDevice(input,inputs){
    const device=input?identity(input):null,matched=this.match(input,inputs);
    const changed=JSON.stringify(device)!==JSON.stringify(this.device)||this.active!==matched;
    this.device=device;
    this.active=matched;
    if(changed){this.reset();this.notify();}
  }
  create(name,cloneId){
    if(!this.device)throw Error('Connect and select a MIDI input');
    if(this.active&&sameDevice(this.active.device,this.device))throw Error('This device already has an associated profile');
    if(this.profiles.length>=64)throw Error('Controller profile limit reached');
    const source=this.profiles.find(p=>p.id===cloneId);
    if(cloneId&&!source)throw Error('Choose a profile to clone');
    const profile={id:crypto.randomUUID(),name:text(name)||this.device.name||'Controller',device:{...this.device},
      bindings:source?structuredClone(source.bindings):validateBank(null)};
    this.profiles.push(profile);this.active=profile;this.reset();this.save();
  }
  associate(id){
    if(!this.device)throw Error('Connect and select a MIDI input');
    const profile=this.profiles.find(p=>p.id===id);
    if(!profile)throw Error('Choose a profile to associate');
    if(this.profiles.some(p=>p!==profile&&sameDevice(p.device,this.device)))throw Error('This device already has an associated profile');
    profile.device={...this.device};this.active=profile;this.reset();this.save();
  }
  rename(name){
    if(!this.active||!text(name))return;
    this.active.name=text(name);this.save();
  }
  learn(target,mode){
    if(!this.enabled||!this.active||!validTarget(this.context,target)||!modes.includes(mode))return;
    this.learning={target,mode:target.startsWith('transport:')?'absolute':mode};
    this.notify();
  }
  cancel(){this.learning=null;this.notify();}
  remove(target){
    if(!this.active)return;
    this.active.bindings[this.context]=this.active.bindings[this.context].filter(b=>b.target!==target);
    this.reset();this.save();
  }
  handle(data){
    if(!this.enabled||!this.active||!data||data.length!==3)return false;
    const [status,cc,value]=data;
    if(!integer(status,176,191)||!integer(cc,0,119)||cc===64||!integer(value,0,127))return false;
    const channel=status&15,bindings=this.active.bindings[this.context];
    if(this.learning){
      const chosen={channel,cc,...this.learning};
      this.active.bindings[this.context]=[...bindings.filter(b=>b.target!==chosen.target).filter(b=>b.cc!==cc||b.channel!==channel),chosen];
      this.reset();this.save();
      return true;
    }
    const binding=bindings.find(b=>b.cc===cc&&b.channel===channel);
    if(!binding)return false;
    const target=this.dispatch(binding.target);
    if(!target)return true;
    const steps=binding.mode==='offset'?(value===0?0:value-64):value<64?value:value-128;
    if(target.midi){
      target.midi({mode:binding.mode,revision:this.revision,...(binding.mode==='absolute'?{value}:{steps})});
      return true;
    }
    const key=binding.target,previous=this.pickup.get(key);
    let owner=previous;
    if(!owner||owner.scope!==target.scope||!target.trigger&&owner.current!==target.value&&owner.expected!==target.value)
      owner={scope:target.scope,previous:null,current:target.value,expected:target.value,picked:false};
    this.pickup.set(key,owner);
    const prior=owner.previous;
    owner.previous=value;
    owner.current=target.value;
    if(target.trigger){
      if(value>=64&&(prior??0)<64)target.apply();
      return true;
    }
    if(binding.mode==='absolute'){
      const threshold=Math.round(target.value*127);
      if(!owner.picked&&(value===threshold||prior!==null&&Math.min(value,prior)<=threshold&&Math.max(value,prior)>=threshold))owner.picked=true;
      if(!owner.picked)return true;
      owner.expected=value/127;
    }else{
      if(!steps)return true;
      owner.expected=limit(target.value+steps/127,0,1);
    }
    owner.expected=target.apply(owner.expected)??owner.expected;
    return true;
  }
}
