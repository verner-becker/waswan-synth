// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {ContextMidiProfiles,MIDI_CONTEXTS} from './daw-context-midi.js';

const options=(input,values,prior=input.value)=>{
  input.replaceChildren(...values.map(([id,label])=>new Option(label,id)));
  if(values.some(([id])=>id===prior))input.value=prior;
};
function field(name,input){
  const label=el('label','',name+' ');
  label.append(input);
  return label;
}
export function midiPanelContext(panel){
  return {clip:'instrument',mixer:'mixer',effects:'mixer',automation:'mixer',transport:'transport'}[panel]||'performance';
}
export class DawMidiProfilesPanel {
  constructor(workspace){
    this.w=workspace;
    const midi=workspace.bridge.midi;
    let storage;
    try{storage=localStorage;}catch{}
    this.profile=new ContextMidiProfiles(storage,target=>this.target(target));
    midi.contextProfiles=this.profile;
    this.panel=el('details','ww-daw-midi-profiles');
    this.enabled=el('input');this.enabled.type='checkbox';
    this.follow=el('input');this.follow.type='checkbox';
    this.context=el('select');
    this.device=el('output');
    this.name=el('input');this.name.maxLength=80;this.name.placeholder='Profile name';
    this.source=el('select');
    this.targetSelect=el('select');
    this.mode=el('select');
    options(this.context,Object.entries(MIDI_CONTEXTS).map(([id,c])=>[id,c.label]));
    options(this.mode,[['absolute','Absolute with pickup'],['offset','Relative (65 / 63)'],['twos','Relative (1 / 127)']]);
    const run=fn=>()=>{try{fn();}catch(error){this.status.textContent=error.message;}};
    this.enabled.onchange=()=>{this.profile.configure({enabled:this.enabled.checked});midi.refresh();};
    this.follow.onchange=()=>this.profile.configure({follow:this.follow.checked});
    this.context.onchange=()=>{const value=this.context.value;this.profile.configure({follow:false});this.profile.setContext(value);};
    this.create=action('Create profile for this device',run(()=>this.profile.create(this.name.value)));
    this.clone=action('Clone profile for this device',run(()=>this.profile.create(this.name.value,this.source.value)));
    this.associate=action('Associate profile with this device',run(()=>this.profile.associate(this.source.value)));
    this.rename=action('Rename active profile',run(()=>this.profile.rename(this.name.value)));
    this.learn=action('Learn context control',()=>{midi.profile.reset();this.profile.learn(this.targetSelect.value,this.mode.value);});
    this.cancel=action('Cancel learning',()=>this.profile.cancel());
    this.bindings=el('ul');
    this.status=el('p','ww-muted');this.status.setAttribute('role','status');
    this.panel.append(el('summary','','MIDI controller profiles'),field('Enable contextual profiles',this.enabled),field('Follow focused workspace or panel',this.follow),field('MIDI context',this.context),this.device,
      field('Profile name',this.name),field('Existing controller profile',this.source),this.create,this.clone,this.associate,this.rename,
      field('Context control',this.targetSelect),field('Control message',this.mode),this.learn,this.cancel,this.bindings,this.status);
    this.source.onchange=()=>this.buttons();
    this.profile.onChange=()=>this.refresh();
    this.profile.selectDevice(midi.input,midi.ports());
    this.refresh();
  }
  buttons(){
    const p=this.profile,hasDevice=!!p.device,associated=p.active?.device.id===p.device?.id;
    this.create.disabled=!hasDevice||associated;
    this.clone.disabled=this.create.disabled||!this.source.value;
    this.associate.disabled=!hasDevice||!this.source.value||associated;
    this.rename.disabled=!p.active;
    this.learn.disabled=!p.enabled||!p.active;
    this.cancel.disabled=!p.learning;
  }
  refresh(){
    const p=this.profile,active=p.active;
    this.enabled.checked=p.enabled;this.follow.checked=p.follow;this.context.value=p.context;
    options(this.source,[['','Choose profile'],...p.profiles.map(v=>[v.id,v.name])]);
    options(this.targetSelect,MIDI_CONTEXTS[p.context].targets);
    this.device.textContent=p.device?.name||'Select a connected input in MIDI Settings';
    this.status.textContent=p.learning?'Move one physical control to learn its CC. Sustain stays on the pedal.':
      p.persistenceError?'The browser could not save the profiles.':
      active?active.name+' · '+MIDI_CONTEXTS[p.context].label:
      p.device?'Create a profile or associate an existing one with this device.':'Connect a MIDI controller to begin.';
    this.bindings.replaceChildren();
    for(const b of active?.bindings[p.context]||[]){
      const label=MIDI_CONTEXTS[p.context].targets.find(([id])=>id===b.target)?.[1];
      const item=el('li','',label+' · ch '+(b.channel+1)+' · CC '+b.cc+' ');
      const remove=action('Remove',()=>p.remove(b.target));
      remove.setAttribute('aria-label','Remove '+label+' mapping');item.append(remove);this.bindings.append(item);
    }
    this.buttons();
  }
  focus(context){this.profile.setContext(context,{automatic:true});}
  target(name){
    const w=this.w,p=w.snapshot,track=w.selectedTrack();
    if(!w.running||w.audioExport?.exporter.busy)return null;
    const [kind,key]=name.split(':');
    if(kind==='synth'){
      const id=Number(key),instrument=w.frame?.instrument,control=instrument?.controls[id];
      if(!control?.available||!control.max)return null;
      return {midi:message=>w.bridge.send({t:'ui-control',source:'midi',behavior:'fine',scope:instrument.scope,id,...message})};
    }
    if(kind==='transport'){
      const button={play:w.player.playing||w.player.starting?w.stop:w.play,record:w.record,loop:w.layout.loop,click:w.click}[key];
      return button?{scope:p.id,trigger:true,apply:()=>button.click()}:null;
    }
    if(w.busy||w.recorder?.busy||w.importer?.busy||w.audition?.busy)return null;
    const source=kind==='master'?p.master:track;
    if(!source||kind==='track'&&w.player.playing&&p.automation.some(l=>l.trackId===source.id&&l.target===key&&l.enabled&&l.points.length))return null;
    const low=key==='pan'?-1:0;
    return {scope:p.id+'/'+(source.id||'master'),value:(source[key]-low)/2,apply:value=>{
      const next=Math.round((low+value*2)*1000)/1000;
      if(next===source[key])return (next-low)/2;
      if(kind==='master')w.edit('master.update',{volume:next});
      else w.edit('track.update',{id:source.id,changes:{[key]:next}});
      clearTimeout(this.gesture);
      const controller=w.controller;
      this.gesture=setTimeout(()=>controller.endCoalescing(),450);
      return (next-low)/2;
    }};
  }
}
