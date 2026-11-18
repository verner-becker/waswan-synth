// SPDX-License-Identifier: GPL-3.0-only
// External MIDI only. The original keyboard/pad handlers and profile mappings stay intact.
export class DawMidiRouter {
  constructor({controller,target,command,protect=()=>false,onRelease=()=>{},onChange=()=>{}}){Object.assign(this,{controller,target,command,protectPlayback:protect,onRelease,onChange});this.enabled=false;this.held=new Map();this.silent=new Set();this.suppressed=new Set();this.parts=Array.from({length:16},()=>new Set());this.pedals=Array(16).fill(false);this.bends=Array(16).fill(0);this.mods=Array(16).fill(0);}
  protect(){return this.enabled||this.held.size>0||this.protectPlayback();}
  emit(type,data){this.command(type,data);}
  entryOff(key,entry){this.held.delete(key);this.emit('daw-live-note',{part:entry.part,channel:key>>7,note:key&127,velocity:0});this.controller.onNote(key&127,[...this.held.keys()].some(k=>(k&127)===(key&127))||[...this.controller.notes.values()].includes(key&127));}
  legacyRelease(channel=null){
    const controller=this.controller;
    for(const [key,note] of controller.notes)if(channel===null||key>>7===channel){controller.send({t:'midi',st:0x80|(key>>7),d1:note,d2:0});controller.notes.delete(key);this.suppressed.add(key);controller.onNote(note,[...controller.notes.values()].includes(note)||[...this.held.keys()].some(k=>(k&127)===note));}
    for(let ch=0;ch<16;ch++)if(channel===null||channel===ch)controller.send({t:'midi',st:0xb0|ch,d1:64,d2:0});
  }
  enable(){this.legacyRelease();this.enabled=true;}
  disable(){this.enabled=false;const pitches=new Set([...this.held.keys()].map(key=>key&127));for(const key of this.held.keys())this.suppressed.add(key);for(const key of this.silent)this.suppressed.add(key);this.held.clear();this.silent.clear();for(const set of this.parts)set.clear();for(const note of pitches)this.controller.onNote(note,[...this.controller.notes.values()].includes(note));}
  dropTrack(trackId){for(const [key,entry] of this.held)if(entry.trackId===trackId){this.entryOff(key,entry);this.suppressed.add(key);}}
  releaseChannel(channel){
    for(const [key,entry] of this.held)if(key>>7===channel){this.held.delete(key);this.suppressed.add(key);this.controller.onNote(key&127,[...this.held.keys()].some(k=>(k&127)===(key&127))||[...this.controller.notes.values()].includes(key&127));}
    for(const key of this.silent)if(key>>7===channel){this.silent.delete(key);this.suppressed.add(key);}
    for(const part of this.parts[channel])this.emit('daw-live-stop-part',{part,channel});this.parts[channel].clear();this.legacyRelease(channel);
  }
  release(){for(let channel=0;channel<16;channel++){this.releaseChannel(channel);this.controller.send({t:'midi',st:0xe0|channel,d1:0,d2:64});}this.controller.send({t:'wheel',w:1,v:620});this.controller.onWheel?.('pitch',8192);this.controller.onWheel?.('mod',620);this.pedals.fill(false);this.bends.fill(0);this.mods.fill(0);this.onRelease();this.onChange();}
  dropPart(part){for(const [key,entry] of this.held)if(entry.part===part){this.held.delete(key);this.suppressed.add(key);this.controller.onNote(key&127,[...this.held.keys()].some(k=>(k&127)===(key&127))||[...this.controller.notes.values()].includes(key&127));}for(const set of this.parts)set.delete(part);this.emit('daw-live-stop-part',{part,channel:0,allChannels:true});}
  route(data){
    if(!data||data.length!==3||!Array.from(data).every(Number.isInteger))return false;
    const [status,note,value]=data,kind=status&240,channel=status&15,key=channel*128+note;
    if(status<128||status>=240||note<0||note>127||value<0||value>127)return false;
    const target=this.enabled?this.target():null,claims=!!target&&(target.channel===null||target.channel===undefined||target.channel===channel);
    if(kind===128||kind===144){
      const down=kind===144&&value>0,previous=this.held.get(key);
      if(previous){this.entryOff(key,previous);if(!down){this.onChange();return true;}}
      if(!down){if(this.silent.delete(key)||this.suppressed.delete(key))return true;return false;}
      this.suppressed.delete(key);this.silent.delete(key);if(!claims)return false;
      if(!target.audible){this.silent.add(key);return true;}
      const entry={trackId:target.trackId,part:target.part,velocity:value};this.held.set(key,entry);this.parts[channel].add(entry.part);
      this.emit('daw-live-expression',{part:entry.part,channel,bend:this.bends[channel],modulation:this.mods[channel]});this.emit('daw-live-pedal',{part:entry.part,channel,down:this.pedals[channel]?1:0});this.emit('daw-live-note',{part:entry.part,channel,note,velocity:value});this.controller.onNote(note,true);this.onChange();return true;
    }
    if(kind===176&&note===64){this.pedals[channel]=value>=64;const parts=new Set(this.parts[channel]);if(claims&&Number.isInteger(target.part))parts.add(target.part);for(const part of parts)this.emit('daw-live-pedal',{part,channel,down:value>=64?1:0});this.onChange();return claims;}
    if(kind===224||kind===176&&note===1){
      if(kind===224)this.bends[channel]=(note|(value<<7))-8192;else this.mods[channel]=value;
      const parts=new Set(this.parts[channel]);if(claims&&Number.isInteger(target.part))parts.add(target.part);for(const part of parts)this.emit('daw-live-expression',{part,channel,bend:this.bends[channel],modulation:this.mods[channel]});return claims;
    }
    if(kind===176&&[120,123].includes(note)&&this.protect()){this.releaseChannel(channel);return true;}
    return false;
  }
}
