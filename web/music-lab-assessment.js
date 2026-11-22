// SPDX-License-Identifier: GPL-3.0-only
export function labMidiEvent({data,timeStamp}) {
  if(data?.length!==3)return null;
  const [status,pitch,value]=data;
  if(!Number.isInteger(status)||status<128||status>=240||
    ![pitch,value].every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=127))return null;
  const channel=status&15,kind=status&240;
  const at=Number.isFinite(timeStamp)&&timeStamp>=0?timeStamp:null;
  if(kind===144&&value>0)return {type:'on',channel,pitch,at};
  if(kind===128||kind===144)return {type:'off',channel,pitch,at};
  if(kind===176&&pitch===64)return {type:'pedal',channel,down:value>=64,at};
  if(kind===176&&[120,123].includes(pitch))return {type:'reset',channel,at};
  return null;
}

export class LabAssessment {
  constructor(groups,{channel,bpm,ppq,chordWindowMs}) {
    Object.assign(this,{groups,channel,bpm,ppq,chordWindowMs,index:0,attacks:0,extras:0,retries:0,
      held:new Map(),pedals:new Map(),holdTotal:0,holdSamples:0,windowUnavailable:false});
  }

  resume(channel) {
    this.channel=channel;
    this.held.clear();
    this.pedals.clear();
    this.lastAt=null;
    this.chordRejected=false;
  }

  get complete() {
    return this.index===this.groups.length&&![...this.held.values()].some(note=>note.reference!==undefined);
  }

  input(event) {
    const {type,channel,pitch}=event;
    if(this.channel!==null&&this.channel!==channel)return null;
    if(type==='reset'){
      this.resume(this.channel);
      return {kind:'reset'};
    }
    if(type==='pedal'){
      this.pedals.set(channel,event.down);
      return {kind:'pedal'};
    }
    if(type==='off'&&this.channel===null)return null;
    this.channel??=channel;
    const at=event.at!==null&&(this.lastAt==null||event.at>=this.lastAt)?event.at:null;
    if(at!==null)this.lastAt=at;
    if(type==='off'){
      const held=this.held.get(pitch);
      if(!held)return null;
      this.held.delete(pitch);
      if(this.held.size===0)this.chordRejected=false;
      if(held.reference===undefined||held.at===null||at===null)return {kind:'release'};
      const ms=at-held.at;
      this.holdTotal+=ms;
      this.holdSamples++;
      return {kind:'release',pitch,ms,reference:held.reference};
    }

    const group=this.groups[this.index];
    if(!group){
      const prior=this.held.get(pitch);
      if(prior?.reference!==undefined)prior.at=null;
      return null;
    }
    // A repeated attack replaces an unfinished hold without inventing a release time.
    this.attacks++;
    this.held.set(pitch,{at});
    const target=group.notes;
    const note=target.find(note=>note.pitch.midi===pitch);
    if(!note){
      if(group.held?.some(note=>note.pitch.midi===pitch)){
        this.held.get(pitch).anchor=true;
        return {kind:'anchor',pitch};
      }
      this.extras++;
      if(target.length>1)this.chordRejected=true;
      return {kind:'extra',pitch};
    }
    const missing=group.held?.find(note=>{
      const held=this.held.get(note.pitch.midi);
      return !held||held.reference===undefined&&!held.anchor;
    });
    if(missing)return {kind:'anchor-missing',pitch,anchor:missing.pitch.midi};
    const chord=target.length>1;
    if(chord){
      if(this.chordRejected)return {kind:'retry',pitch};
      const keys=target.map(note=>this.held.get(note.pitch.midi));
      if(keys.some(key=>!key||key.reference!==undefined))return {kind:'partial',pitch};
      const attacks=keys.map(key=>key.at);
      if(attacks.some(value=>value===null))this.windowUnavailable=true;
      else if(Math.max(...attacks)-Math.min(...attacks)>this.chordWindowMs){
        this.chordRejected=true;
        this.retries++;
        return {kind:'wide',pitch};
      }
    }
    for(const item of target)this.held.get(item.pitch.midi).reference=item.durationTick*60000/(this.ppq*this.bpm);
    this.index++;
    return {kind:'match',pitch,chord};
  }

  summary() {
    const expected=this.groups.length;
    return {expected,matched:this.index,missing:expected-this.index,extras:this.extras,retries:this.retries,
      holdSamples:this.holdSamples,holdMeanMs:this.holdSamples?Math.round(this.holdTotal/this.holdSamples):null,
      windowUnavailable:this.windowUnavailable};
  }
}
