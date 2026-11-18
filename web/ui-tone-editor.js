// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel,RotaryKnob} from './ui-primitives.js';
const GROUPS=[['Oscillators',[0,1,2,3,4,5,6,7,8,9,10,11]],['Filter',[12,13,14,15,16,17,18,19,51]],
  ['Envelopes',[20,21,22,23,24,25,26,27]],['Modulation',[28,29,30,31,32,33,34,35,36,37,46]],
  ['Voice',[38,39,40,41,42,43,44,45]],['Arpeggiator',[47,48,49,50]],['Shared effects',[52,53,54,55,56,57,58,59,60,61,62]]];
const LABELS={0:'OSC1 wave',1:'OSC1 pulse width / detune',2:'OSC1 level',3:'Noise level',4:'OSC2 wave',5:'OSC2 pulse width',6:'OSC2 level',7:'OSC2 semitones',8:'OSC1 → OSC2 sync',9:'OSC2 → OSC1 FM',10:'Filter env → OSC2 pitch',11:'OSC2 fine',14:'Filter envelope amount',18:'Velocity → filter',19:'Velocity → amp',
  20:'Filter attack',21:'Filter decay',22:'Filter sustain',23:'Filter release',24:'Amp attack',25:'Amp decay',26:'Amp sustain',27:'Amp release',
  32:'LFO → pitch',33:'LFO → PWM',34:'LFO → filter',35:'LFO → amp',36:'LFO pitch destination',37:'LFO PWM destination',39:'Unison voices',40:'Unison / dual detune',44:'Bend range',46:'Mod depth (legacy)',
  52:'Chorus rate',53:'Chorus depth',54:'Chorus return',55:'Delay time',56:'Delay feedback',57:'Delay tone',58:'Delay return',59:'Reverb size',60:'Reverb damping',61:'Reverb pre-delay',62:'Reverb return'};
export class ToneEditor {
  constructor(send,onGroupChange){
    this.send=send;this.onGroupChange=onGroupChange;this.request=0;this.controls=new Map();this.groups=[];
    this.node=Panel('Tone Editor','ANALOG · original parameters');this.node.classList.add('ww-tone-editor');
    this.heading=el('p','','Start audio to inspect the selected tone.');
    this.save=action('Save',()=>this.openSave(false),'ww-primary');this.saveAs=action('Save as…',()=>this.openSave(true));this.save.disabled=this.saveAs.disabled=true;
    const bar=el('div','ww-editor-toolbar');bar.append(this.heading,this.save,this.saveAs);this.node.append(bar);
    this.status=el('p','ww-muted','Edits apply immediately. Saving remains explicit.');this.status.setAttribute('role','status');this.node.append(this.status);
    this.unavailable=el('p','ww-muted');this.node.append(this.unavailable);
    this.nav=el('nav','ww-editor-tabs');this.nav.setAttribute('aria-label','Tone parameter groups');this.node.append(this.nav);
    this.hint=el('p','ww-muted','Drag knobs vertically · Shift for fine adjustment · arrow keys for one step');this.hint.id='ww-tones-help';this.node.append(this.hint);
    this.content=el('div');this.node.append(this.content);
    this.dialog=el('dialog','ww-map-dialog ww-editor-save');this.dialog.setAttribute('aria-labelledby','ww-editor-save-title');
    this.form=el('form');const title=el('h2','','Save tone');title.id='ww-editor-save-title';
    const nameLabel=el('label','','Tone name');this.name=el('input');this.name.name='toneName';this.name.required=true;this.name.maxLength=10;this.name.pattern='(?:[ A-Z0-9]|-){1,10}';this.name.setAttribute('aria-label','Tone name');this.name.autocomplete='off';this.name.oninput=()=>{this.name.value=this.name.value.toUpperCase();this.refreshReview();};nameLabel.append(this.name);
    const slotLabel=el('label','','Destination program');this.slot=el('select');this.slot.setAttribute('aria-label','Destination program');this.slot.onchange=()=>{this.intent.targetToken=this.frame.editor.targets[Number(this.slot.value)-1];this.refreshReview();};slotLabel.append(this.slot);
    this.review=el('p');this.saveError=el('p','ww-muted');this.saveError.setAttribute('role','alert');
    const cancel=action('Cancel',()=>{this.intent=null;this.dialog.close();});cancel.autofocus=true;
    this.confirm=el('button','ww-primary','Confirm overwrite');this.confirm.type='submit';
    this.form.append(title,nameLabel,el('small','ww-muted','1–10 characters: A–Z, 0–9, space or hyphen.'),slotLabel,this.review,this.saveError,cancel,this.confirm);this.dialog.append(this.form);document.body.append(this.dialog);
    this.form.onsubmit=e=>{e.preventDefault();this.commit();};this.dialog.addEventListener('cancel',()=>{this.intent=null;});
  }
  build(catalog){
    this.catalog=catalog;this.controls.clear();this.groups=[];this.nav.replaceChildren();this.content.replaceChildren();
    for(const [group,ids] of GROUPS){
      const panel=el('section','ww-editor-group');panel.hidden=this.groups.length>0;const button=action(group,()=>this.selectGroup(group));button.dataset.group=group;button.setAttribute('aria-pressed',String(!this.groups.length));this.nav.append(button);panel.append(el('h3','',group));
      if(group==='Shared effects')panel.append(el('p','ww-muted','These returns are shared by all Synth parts. Use Performance for part levels and the chorus, delay and reverb sends.'));
      if(group==='Oscillators')panel.append(el('p','ww-muted','X-MOD is linear FM: OSC2 → OSC1. SUPER uses seven saws in OSC1, with a shared five-voice limit; sync/FM are bypassed. SUPER MIX remains in Legacy SMK.'));
      const grid=el('div','ww-editor-grid');panel.append(grid);
      for(const id of ids){
        const p=catalog.find(p=>p.id===id);if(!p)continue;const label=LABELS[id]??p.name;
        let control;
        if(p.options){
          const node=el('label','ww-editor-choice');node.append(el('span','ww-control-name',label));const input=el('select');input.setAttribute('aria-label',label);
          p.options.forEach((name,value)=>input.add(new Option(name,String(value))));input.onchange=()=>this.set(id,Number(input.value));node.append(input);
          control={node,update:(s,display)=>{input.disabled=!s.available;input.value=String(s.value);input.title=display;}};
        }else{
          control=RotaryKnob({name:label,min:p.min,max:p.max,onInput:value=>this.set(id,value)});control.badge.hidden=true;control.dial.setAttribute('aria-describedby',this.hint.id);
          const input=el('input','ww-editor-number');input.type='number';input.min=p.min;input.max=p.max;input.step=1;input.setAttribute('aria-label',`${label} internal value`);
          input.onchange=()=>{if(input.checkValidity())this.set(id,Number(input.value));};control.node.append(input);const original=control.update;
          control.update=(s,display,secondary)=>{original(s,display,secondary);input.disabled=!s.available;if(document.activeElement!==input)input.value=String(s.value);};
        }
        control.node.dataset.param=id;this.controls.set(id,control);grid.append(control.node);
      }
      this.groups.push({group,panel,button});this.content.append(panel);
    }
    this.selectGroup(this.selectedGroup??GROUPS[0][0]);
  }
  selectGroup(group){this.selectedGroup=group;for(const g of this.groups){g.panel.hidden=g.group!==group;g.button.setAttribute('aria-pressed',String(g.group===group));}this.onGroupChange(group);}
  set(id,value){if(this.frame?.editor?.available)this.send({t:'editor-set',id,value,scope:this.frame.instrument.scope});}
  openSave(as){
    const f=this.frame;if(!f?.editor?.available)return;
    this.intent={scope:f.instrument.scope,token:f.instrument.programToken,targetToken:f.editor.targets[f.programs[f.track]-1],source:f.programs[f.track],part:f.track};
    this.name.value=f.instrument.name;this.name.readOnly=!as;this.slot.replaceChildren();for(const p of this.library)this.slot.add(new Option(`${p.number} · ${p.name}`,String(p.number)));
    this.slot.value=String(this.intent.source);this.slot.disabled=!as;this.saveError.textContent='';this.refreshReview();this.dialog.showModal();
  }
  refreshReview(){
    if(!this.intent)return;const slot=Number(this.slot.value),target=this.library.find(p=>p.number===slot);
    const parts=this.frame.programs.flatMap((n,i)=>n===slot&&i!==this.intent.part?['ABCD'[i]]:[]);
    this.review.textContent=`Save part ${'ABCD'[this.intent.part]} as “${this.name.value}” in Program ${slot} (${target?.name}). This replaces that slot.${parts.length?` Other parts using it (${parts.join(', ')}) also update if they have no unsaved edits.`:''} Writing may wait until playback is stopped and audio is quiet. Global FX remain shared; this does not save the current pattern.`;
  }
  commit(){
    if(!this.intent||!this.form.reportValidity())return;if(!this.name.value.trim()){this.saveError.textContent='Enter a non-empty name.';return;}
    const {scope,token,targetToken}=this.intent;this.pending=++this.request;this.storeReceipt=null;this.failure=false;
    this.send({t:'editor-save',request:this.pending,scope,token,targetToken,program:Number(this.slot.value),name:this.name.value});
    this.status.textContent='Save requested…';this.intent=null;this.dialog.close();
  }
  stored(data,ok){
    let hash=2166136261;for(const byte of new Uint8Array(data))hash=Math.imul(hash^byte,16777619)>>>0;
    this.storeReceipt={hash,ok};this.updateStatus();
  }
  updateStatus(){
    const save=this.frame?.editor?.save;if(!this.pending||save?.request!==this.pending)return;
    if(save.state==='written'&&this.frame.track===save.part&&this.frame.instrument.edited){
      this.status.textContent=`Program ${save.program} was saved. Current edits have not been saved.`;return;
    }
    this.status.textContent=save.state==='rejected'?'Save not applied: the tone, destination or context changed. Open Save again.':save.state==='failed'?'Save failed in the instrument. Retry when ready.':save.state==='waiting'?'Save pending · stop playback and let notes and release tails become quiet.':
      this.storeReceipt?.hash===save.hash?(this.storeReceipt.ok?'Saved · instrument memory and browser storage updated.':'Instrument saved, but browser storage failed. Export the session in Settings to preserve it.'):'Instrument written · waiting for browser storage confirmation…';
  }
  update(f,running){
    this.frame=f;if(f.programLibrary)this.library=f.programLibrary;if(f.editorCatalog)this.build(f.editorCatalog);
    const analog=f.engines[f.track]===0,available=running&&!!f.editor?.available;
    this.heading.textContent=`Part ${'ABCD'[f.track]} · Program ${f.programs[f.track]} · ${f.instrument.name}${f.instrument.edited?' · Edited':''}`;
    this.save.disabled=this.saveAs.disabled=!available;
    this.unavailable.textContent=!analog?'DRUM-X uses different parameter meanings. Edit this engine in Legacy SMK.':!running?'Start audio to edit.':!available?'Editor temporarily unavailable during a Legacy dialog, save or context change.':'';
    this.content.hidden=this.nav.hidden=this.hint.hidden=!analog;
    for(const p of this.catalog??[]){const v=f.editor.values[p.id];const bypass=f.editor.values[0].value===4&&[8,9].includes(p.id);
      this.controls.get(p.id)?.update({value:v.value,min:p.min,max:p.max,available:available&&!bypass},v.display,`${v.value} / ${p.max} · ${bypass?'Bypassed in SUPER':p.shared?'Shared FX':'Internal steps'}`);
    }
    if(f.editor?.edit?.applied===false&&!this.pending)this.status.textContent='Edit not applied: context changed or value unavailable. Try again.';
    this.updateStatus();
  }
}
