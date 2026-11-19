// SPDX-License-Identifier: GPL-3.0-only
import {pairFrames,maxRegions,tapeControls,validTape,validTapeSettings} from './mellotron-settings.js';

export class TapeRuntime {
  constructor(x){this.x=x;this.routes=new Map();this.live=x.waswan_daw_capacity();}
  config(route,settings){
    this.x.waswan_mel_config(route,Number(!!settings),...tapeControls.map(([key,,,,def])=>settings?.[key]??def));
  }
  command(m){
    const x=this.x;
    if(!x.waswan_mel_begin)throw Error('Build the 256-voice host to play tapes.');
    if(m.t==='daw-tape-begin'){
      this.pending={token:m.request,base:x.waswan_mel_begin(),frames:0,written:0};
      if(!this.pending.base)throw Error('Insufficient memory for the tape library');
      if(!Array.isArray(m.regions)||m.regions.length>maxRegions)throw Error('Invalid tape regions');
      for(const r of m.regions){
        if(![r.bank,r.root,r.frames].every(Number.isInteger)||!x.waswan_mel_region(r.bank,r.root,r.frames))throw Error('Invalid tape region or capacity');
        this.pending.frames+=r.frames;
      }
      return m.request;
    }
    if(m.t==='daw-tape-live'){
      if(m.enabled&&!this.id)throw Error('Load both tape banks first.');
      if(!validTapeSettings(m.settings))throw Error('Invalid tape controls');
      if(!!m.enabled!==!!this.liveOn && x.waswan_mel_busy(this.live))throw Error('Release Part A keys and sustain before switching instruments.');
      if(m.enabled && x.sim_engine(0)!==0)throw Error('Select an Analog sound on Part A first.');
      this.config(this.live,m.enabled&&m.settings);this.liveOn=m.enabled;
      return true;
    }
    const p=this.pending;
    if(!p||m.token!==p.token)throw Error('Tape load expired');
    if(m.t==='daw-tape-chunk'){
      const pcm=m.pcm;
      if(!(pcm instanceof Int16Array)||pcm.length>32768||p.written!==m.offset||p.written+pcm.length>p.frames||p.frames>pairFrames)throw Error('Invalid tape data');
      new Int16Array(x.memory.buffer,p.base+2*p.written,pcm.length).set(pcm);
      p.written+=pcm.length;
      return true;
    }
    if(m.t!=='daw-tape-commit'||p.written!==p.frames||!validTape(m.tape))throw Error('Incomplete tape pair');
    if(x.sim_engine(0)!==0)throw Error('Select an Analog sound on Part A first.');
    if(x.waswan_mel_busy(this.live)||!x.waswan_mel_commit())throw Error('Release keys and sustain, then load both banks again.');
    this.id=m.tape.id;this.routes.clear();this.liveOn=true;
    this.config(this.live,m.tape.settings);this.pending=null;
    return true;
  }
  prepare(slots,project){
    const next=new Map();
    for(const slot of slots){
      if(slot.type!=='mellotron')continue;
      if(!validTape(slot.tape)||slot.tape.id!==this.id)
        throw Error('Load these Mellotron banks in Performance: '+(slot.tape?.banks||[]).join(' + '));
      next.set(slot.part,{binding:project+'/'+slot.trackId,tape:slot.tape});
    }
    for(const part of new Set([...this.routes.keys(),...next.keys()])){
      if(JSON.stringify(this.routes.get(part))!==JSON.stringify(next.get(part))&&this.x.waswan_mel_busy(part))
        throw Error('Release sounding tape notes before changing this track.');
    }
    return next;
  }
  apply(next){
    for(const part of new Set([...this.routes.keys(),...next.keys()])){
      const binding=next.get(part);
      if(this.routes.get(part)?.binding!==binding?.binding)this.x.waswan_mel_reset_keys(part);
      this.config(part,binding?.tape.settings);
    }
    this.routes=next;
  }
}
