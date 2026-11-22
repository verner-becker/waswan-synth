// SPDX-License-Identifier: GPL-3.0-only
const LIMIT=256,MAX_MS=120000;

export class LabPhrase {
  constructor({channel,capture,chordAt}) {
    Object.assign(this,{channel,capture,chordAt,attacks:0,index:0,held:new Map(),pedals:new Map(),
      up:0,down:0,same:0,space:0,patterns:new Set(),repeats:0,chordNotes:0,chordAttacks:0,notes:[]});
  }

  resume(channel) {
    this.channel=channel;
    this.held.clear();
    this.pedals.clear();
    this.restFrom=null;
    this.previous=null;
    this.interval=null;
  }

  input(event) {
    const {type,channel,pitch,velocity,at}=event;
    if(this.channel!==null&&this.channel!==channel)return null;
    if(type==='reset')return {kind:'reset'};
    if(type==='pedal'){this.pedals.set(channel,event.down);return null;}
    if(type==='off'){
      const start=this.held.get(pitch);
      this.held.delete(pitch);
      if(start&&at!==null&&!this.held.size)this.restFrom=at;
      if(this.capture&&start?.at!=null&&at!==null&&at>start.at&&at-this.origin<=MAX_MS&&this.notes.length<LIMIT)
        this.notes.push({midi:pitch,at:start.at-this.origin,duration:at-start.at,velocity:start.velocity});
      return null;
    }
    this.channel??=channel;
    this.origin??=at;
    this.attacks++;
    this.min=Math.min(this.min??pitch,pitch);
    this.max=Math.max(this.max??pitch,pitch);
    this.soft=Math.min(this.soft??velocity,velocity);
    this.loud=Math.max(this.loud??velocity,velocity);
    if(this.restFrom!=null&&at!==null&&at-this.restFrom>=250)this.space++;
    this.restFrom=null;
    if(this.previous!=null){
      const step=pitch-this.previous;
      if(step>0)this.up++;
      else if(step<0)this.down++;
      else this.same++;
      if(this.interval!=null){
        const pair=this.interval+','+step;
        if(this.patterns.has(pair))this.repeats++;
        else if(this.patterns.size<LIMIT)this.patterns.add(pair);
      }
      this.interval=step;
    }
    this.previous=pitch;
    this.held.set(pitch,{at,velocity});
    const chord=this.chordAt(at);
    if(!chord)return {kind:'phrase',pitch};
    const structural=chord.classes.includes(pitch%12);
    this.chordAttacks++;
    if(structural)this.chordNotes++;
    return {kind:'phrase',pitch,chord:chord.label,structural};
  }

  result(bpm) {
    const {attacks,min,max,soft,loud,up,down,same,space,repeats,chordNotes,chordAttacks}=this;
    const tick=ms=>Math.round(ms*bpm*480/60000);
    const limit=480*128;
    const notes=[...this.notes].sort((a,b)=>a.at-b.at).flatMap(({midi,at,duration,velocity})=>{
      const startTick=tick(at),end=Math.min(limit,Math.max(startTick+1,tick(at+duration)));
      return end>startTick?[{midi,velocity,startTick,durationTick:end-startTick}]:[];
    });
    return {attacks,min,max,soft,loud,up,down,same,space,repeats,chordNotes,chordAttacks,notes,bpm};
  }
}
