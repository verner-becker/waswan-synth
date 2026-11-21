// SPDX-License-Identifier: GPL-3.0-only
import {action,el} from './ui-primitives.js';
import {createSamplerWaveform,createMiniWaveform} from './ui-sampler-waveform.js';
import {inspectWav} from './sampler-wav.js';
import {rangeWav} from './sampler-waveform.js';
import {importOriginal,readSampleFile} from './sampler-library.js';
import {runOffline} from './sampler-offline.js';
import {excerptLimits,previewProposal,saveProposal} from './sampler-auto-instrument.js';

const steps=['Import','Discover','Build','Play & Finish'];
const characters=['Sustained','Plucked','Texture'];
const descriptions=['Choose the recording you want to play.',
  'Listen for a useful excerpt. Other instruments in a mix will remain audible.',
  'Shape each selected excerpt into its own instrument.',
  'Try the root, an octave either side and a chord. Hold a note, then release it.'];
const seconds=(f,rate)=>(f/rate).toFixed(2)+' s';
const noteNames=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const noteName=n=>noteNames[n%12]+(Math.floor(n/12)-1)+' (MIDI '+n+')';

function choice(label,values,current,change) {
  const wrap=el('label','',label),select=el('select');
  for (const [value,text] of values) select.append(new Option(text,value));
  select.value=current;
  select.onchange=()=>change(select.value);
  wrap.append(select);
  return wrap;
}

export class AutoInstrumentWizard {
  constructor(studio,trigger) {
    this.studio=studio;
    this.trigger=trigger;
    this.step=0;
    this.character='Auto';
    this.items=[];
    this.minis=[];
    this.node=el('section','ww-auto-wizard');
    this.node.setAttribute('aria-label','Auto Instrument Wizard');
    this.heading=el('h3');this.heading.tabIndex=-1;
    this.trail=el('ol','ww-wizard-steps');
    this.trail.append(...steps.map(s=>el('li','',s)));
    this.help=el('p','ww-muted');
    this.controls=el('fieldset','ww-wizard-controls');
    this.content=el('div');
    this.wave=createSamplerWaveform({audition:studio.audition});
    this.wave.node.querySelector('.ww-wave-tools').hidden=true;
    this.wave.setCropEnabled(false);
    this.nav=el('div','ww-sampler-actions');
    this.controls.append(this.content,this.wave.node,this.nav);
    this.status=el('p','ww-sampler-status');this.status.setAttribute('role','status');
    this.cancel=action('Cancel',()=>this.close());
    this.node.append(this.trail,this.heading,this.help,this.controls,this.status,this.cancel);
    studio.body.before(this.node);studio.body.hidden=true;trigger.hidden=true;
    this.paint(true);
  }
  async run(fn,{cancelable=true}={}) {
    if (this.task) return;
    const task=new AbortController();
    this.task=task;this.controls.disabled=true;this.cancel.disabled=!cancelable;
    this.status.textContent='';
    try {await fn(task.signal);}
    catch(error){if (!task.signal.aborted) this.status.textContent=error.message || String(error);}
    finally {
      if (this.task===task) {
        this.task=null;this.controls.disabled=false;this.cancel.disabled=false;
      }
    }
  }
  button(label,fn,opts) {
    return action(label,()=>this.run(fn,opts));
  }
  close() {
    this.task?.abort();
    this.clearMinis();
    this.wave.destroy();
    if (this.listenOwner) this.studio.audition.stop();
    this.studio.body.hidden=false;this.trigger.hidden=false;this.node.remove();
    this.trigger.focus();this.studio.sync();
  }
  clearMinis() {
    this.minis.forEach(m=>m.clear());this.minis=[];
  }
  selected(){return this.items.filter(item=>item.selected);}
  usable(item) {
    if (!item.p || !item.name?.trim()) return false;
    const root=item.rootNote??item.p.pitch.root;
    return root===null ? item.p.character!=='Sustained' : Number.isInteger(root)&&root>=0&&root<=127;
  }
  async import(file,signal) {
    const studio=this.studio;
    const layout=await inspectWav(file,{anyRate:true});
    const source=await importOriginal(studio.root,file,'Samples/Originals/'+file.name);
    signal.throwIfAborted();
    await this.wave.open(file);
    signal.throwIfAborted();
    Object.assign(this,{file,layout,source,libraryId:studio.library.id,items:[],scanned:false});
    this.paint();
    this.status.textContent='Original verified · SHA-256 '+source.sha256;
  }
  async discover(signal) {
    if (!this.scanned) {
      const matches=await runOffline(this.file,{type:'discover',character:this.character},{
        signal,onProgress:value=>{this.status.textContent='Searching the recording · '+Math.round(value*100)+'%';}});
      signal.throwIfAborted();
      this.items=matches.map((m,i)=>this.item(m,i,i===0));
      this.scanned=true;
    }
    if (this.items.length) this.wave.setSelection(this.items.find(i=>i.selected)??this.items[0]);
    this.step=1;this.status.textContent='';this.paint(true);
  }
  item(range,index,selected) {
    const character=this.character==='Auto'?(range.character||'Auto'):this.character;
    return {...range,selected,character,id:crypto.randomUUID(),sustain:'Auto',
      name:this.file.name.replace(/\.wav$/iu,'').slice(0,110)+' · '+(index+1)};
  }
  async build(item,signal) {
    item.error='';
    try {
      const p=await runOffline(this.file,{type:'propose',range:{start:item.start,end:item.end},
        options:{character:item.character,sustain:item.sustain}},{signal});
      signal.throwIfAborted();
      item.p=p;item.character=p.character;
    } catch(error) {
      signal.throwIfAborted();
      item.p=null;item.error=error.message;
    }
  }
  async buildSelected(signal) {
    this.status.textContent='Preparing selected excerpts…';
    for (const item of this.selected()) if (!item.p) await this.build(item,signal);
    this.step=2;this.status.textContent='';this.paint(true);
  }
  async save(items) {
    const s=this.studio;
    if (s.library?.id!==this.libraryId) throw Error('Reopen the Samples folder used for this recording.');
    await readSampleFile(s.root,this.source);
    for (const item of items) {
      if (item.saved) continue;
      try {
        item.saved=await saveProposal(s.root,this.libraryId,this.source,item.p,item);
        item.error='';
      } catch(error) {item.error=error.message;}
    }
    this.paint();
    await s.browser.refreshWorking();
  }
  async advanced(item) {
    const s=this.studio;
    if (!s.confirmDiscard()) return;
    if (!item.saved) {
      if (!this.node.ownerDocument.defaultView.confirm('Save this Working Copy and open it in the advanced editor?')) return;
      await this.save([item]);
      if (!item.saved) return;
    }
    await s.adopt(item.saved,this.file);
    s.sections.get('Mapping Editor').open=true;
    this.close();
    s.status.textContent='Working Copy open · '+item.saved.name;
    s.sections.get('Mapping Editor').querySelector('summary').focus();
  }
  paint(focus=false) {
    this.clearMinis();
    const s=this.studio;
    [...this.trail.children].forEach((li,i)=>i===this.step?li.setAttribute('aria-current','step'):li.removeAttribute('aria-current'));
    this.heading.textContent=steps[this.step];this.help.textContent=descriptions[this.step];
    this.content.replaceChildren();this.nav.replaceChildren();
    this.wave.node.hidden=!this.file || this.step>1;
    this.cancel.textContent=this.items.some(i=>i.saved)?'Close':'Cancel';
    if (this.step===0) this.importScreen();
    if (this.step===1) this.discoverScreen();
    if (this.step===2) this.buildScreen();
    if (this.step===3) this.playScreen();
    if (this.step>0 && !this.selected().some(i=>i.saved)) {
      this.nav.prepend(action('Back',()=>{this.step--;this.status.textContent='';this.paint(true);}));
    }
    if (s.liveName && this.step<3) this.nav.append(this.button('Release Keyboard',async()=>{await s.releaseLive();this.paint();},{cancelable:false}));
    if (focus) this.heading.focus();
  }
  importScreen() {
    const s=this.studio;
    if (!s.library) {
      const allow=!!s.root;
      const button=this.button(allow?'Allow folder access':'Choose Samples folder…',async()=>{
        if (allow) await s.allowFolder();else await s.chooseFolder();
        this.paint();
      },{cancelable:false});
      this.content.append(button);
      return;
    }
    const input=el('input');input.type='file';input.accept='.wav,audio/wav';input.hidden=true;
    input.setAttribute('aria-label','Wizard WAV');
    input.onchange=()=>{const f=input.files[0];input.value='';if(f)this.run(signal=>this.import(f,signal));};
    this.content.append(action('Choose WAV…',()=>input.click()),input,
      choice('What are you looking for?',[['Auto','Auto'],['Sustained','Sustained tone / voice'],
        ['Plucked','Plucked / percussive'],['Texture','Texture / evolving']],this.character,value=>{
        this.character=value;this.scanned=false;
      }));
    if (this.source) this.content.append(el('p','ww-muted','Verified original · '+this.file.name+
      (this.layout.sampleRate===48000?' · Selected excerpts will play at 44.1 kHz.':'')));
    else this.content.append(el('p','ww-muted','RIFF WAV · PCM16 · mono or stereo · 44.1 or 48 kHz'));
    this.next=this.button('Next',signal=>this.discover(signal));
    this.next.disabled=!this.file;this.nav.append(this.next);
  }
  discoverScreen() {
    if (!this.items.length) this.content.append(el('p','','No audible candidate found. Mark a range on the waveform to try it.'));
    for (const [index,item] of this.items.entries()) {
      const row=el('div','ww-wizard-candidate'),label=el('label');
      const box=el('input');box.type='checkbox';box.checked=item.selected;
      box.onchange=()=>{item.selected=box.checked;this.next.disabled=!this.selected().length;};
      label.append(box,' Excerpt '+(index+1));
      const mini=createMiniWaveform();mini.node.setAttribute('aria-label','Excerpt '+(index+1)+' waveform');
      const wav=rangeWav(this.file,this.layout,item);
      this.minis.push(mini);void mini.show(wav).catch(e=>{this.status.textContent=e.message;});
      const timing=seconds(item.start,this.layout.sampleRate)+' – '+seconds(item.end,this.layout.sampleRate)+
        ' ('+seconds(item.end-item.start,this.layout.sampleRate)+')';
      row.append(label,mini.node,el('span','',timing),el('small','ww-muted',item.reason),
        this.button('Listen',async()=>{this.wave.setSelection(item);this.listenOwner=true;
          await this.studio.audition.play(wav,()=>{this.listenOwner=false;});}));
      this.content.append(row);
    }
    this.nav.append(this.button('Use waveform selection',()=>{
      const range=this.wave.getSelection();
      const duration=(range.end-range.start)/this.layout.sampleRate;
      if(duration<excerptLimits.minSeconds || duration>excerptLimits.maxSeconds) throw Error('Select between 60 ms and 16 seconds on the waveform.');
      const same=this.items.find(i=>i.start===range.start && i.end===range.end);
      if(same) same.selected=true;
      else this.items.push(this.item({...range,reason:'Manual waveform selection'},this.items.length,true));
      this.paint();
    }));
    this.next=this.button('Next',signal=>this.buildSelected(signal));
    this.next.disabled=!this.selected().length;this.nav.append(this.next);
  }
  summary(item) {
    const p=item.p;
    if (!p) return el('p','ww-muted',item.error);
    const e=p.envelope,root=item.rootNote??p.pitch.root;
    const pitch=item.rootNote!=null?'Root · entered '+noteName(item.rootNote):p.pitch.root!==null?
      'Estimated root · '+noteName(root)+' ('+p.pitch.cents.toFixed(1)+' cents, spread '+p.pitch.spreadCents.toFixed(1)+' cents)':
      p.character==='Sustained'?'Needs review · enter a root note':'Default · unpitched trigger on MIDI 60';
    const loop=p.loop?'Estimated forward loop · '+p.loop.start+'–'+p.loop.end+' frames · crossfade '+p.loop.crossfade:
      item.sustain==='Off' || (p.character==='Plucked' && item.sustain!=='On')?'One-shot · loop off':'No reliable sustain loop · one-shot';
    const text=el('div','ww-wizard-summary');
    text.append(el('p','',pitch),el('p','',loop),el('p','',
      'Attack '+e.attackMs+' ms ('+(p.attackEstimated?'estimated':'default')+') · Decay '+e.decayMs+' ms ('+
      (p.decayEstimated?'estimated':'default')+') · Sustain '+e.sustain+' / Release '+e.releaseMs+' ms (defaults)'),
      el('p','','Detected input peak '+(20*Math.log10(p.inputPeak)).toFixed(1)+' dBFS · Proposed gain '+p.gainDb+' dB'));
    return text;
  }
  buildScreen() {
    for (const item of this.selected()) {
      const row=el('fieldset','ww-wizard-instrument');row.append(el('legend','',item.name));
      const nameLabel=el('label','','Name'),name=el('input');name.maxLength=128;name.value=item.name;
      name.oninput=()=>{item.name=name.value;this.next.disabled=!this.selected().every(i=>this.usable(i));};
      nameLabel.append(name);
      const update=(key,value)=>this.run(async signal=>{
        item[key]=value;await this.build(item,signal);this.paint();
        this.content.querySelector('select')?.focus();
      });
      row.append(nameLabel,choice('Character',characters.map(c=>[c,c]),item.character,v=>update('character',v)),
        choice('Sustain',['Auto','On','Off'].map(c=>[c,c]),item.sustain,v=>update('sustain',v)));
      const label=el('label','','Root note (MIDI)'),root=el('input');
      root.type='number';root.min=0;root.max=127;root.step=1;
      root.value=item.rootNote??item.p?.pitch.root??'';
      let summary=this.summary(item);
      root.oninput=()=>{
        item.rootNote=root.value===''?null:root.valueAsNumber;
        const next=this.summary(item);summary.replaceWith(next);summary=next;
        this.next.disabled=!this.selected().every(i=>this.usable(i));
      };
      label.append(root);row.append(label,summary);this.content.append(row);
    }
    this.next=action('Next',()=>{this.step=3;this.paint(true);});
    this.next.disabled=!this.selected().every(i=>this.usable(i));this.nav.append(this.next);
  }
  playScreen() {
    const s=this.studio;
    this.content.append(el('p','ww-muted','Use the shared Keyboard & pads below or the SMK-37 Pro. Large transpositions can change the timbre.'));
    for (const item of this.selected()) {
      const row=el('section','ww-wizard-instrument');
      const buttons=el('div','ww-sampler-actions');
      buttons.append(this.button('Play on Keyboard',async signal=>{
        const label=item.name+' · Wizard';
        await s.playPrepared(()=>previewProposal(s.player,item.p,item,signal),label,{restorePrevious:true});
        this.status.textContent=s.route.textContent;this.paint();
      },{cancelable:false}));
      buttons.append(this.button('Edit Advanced',()=>this.advanced(item),{cancelable:false}));
      row.append(el('h4','',item.name),this.summary(item),buttons);
      if(item.saved) row.append(el('strong','ww-sampler-route','Saved Working / playable'));
      if(item.error) row.append(el('p','',item.error));
      this.content.append(row);
    }
    this.nav.append(action('Show virtual keyboard',()=>{
      const key=document.querySelector('.ww-dock #keys .key');
      if(key){window.focus();key.scrollIntoView({block:'center'});key.focus({preventScroll:true});}
    }));
    if (!this.selected().some(i=>i.saved)) this.nav.append(action('Rebuild',()=>{this.step=2;this.paint(true);}));
    if(s.liveName) this.nav.append(this.button('Release Keyboard',async()=>{await s.releaseLive();this.status.textContent=s.route.textContent;this.paint();},{cancelable:false}));
    if(this.selected().some(i=>!i.saved)) this.nav.append(this.button('Finish',()=>this.save(this.selected()),{cancelable:false}));
    else this.content.append(el('p','ww-muted','Open Edit Advanced to promote an Official revision and assign it to a DAW track.'));
  }
}
