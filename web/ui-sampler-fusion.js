// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {prepareSampler} from './sampler.js';
import {readSampleFile} from './sampler-library.js';
import * as fusion from './sampler-fusion.js';
import {createFusionInput} from './sampler-fusion-input.js';

function control(parent,text,input){
  const label=el('label','',text);input.setAttribute('aria-label',text);label.append(input);parent.append(label);return input;
}
function number(parent,text,value,min,max,step=1){
  const node=el('input');Object.assign(node,{type:'number',value,min,max,step});return control(parent,text,node);
}
function select(parent,text,options){
  const node=el('select');node.append(...options.map(([value,label])=>new Option(label,value)));return control(parent,text,node);
}
const engine=instrument=>instrument.type==='sampler'?'Sampler':instrument.type==='mellotron'?'Mellotron':
  instrument.patch?.[80]?(instrument.patch[83]?'Analog + FM':'FM'):instrument.type==='drumx'?'DRUM-X':instrument.type==='super'?'Super':'Analog';
const soundName=instrument=>instrument.path?.split('/').at(-1)||instrument.tape?.banks?.join(' + ')||
  String.fromCharCode(...(instrument.patch?.slice(63,73)??[])).trim();

export class SamplerFusion {
  constructor(studio,daw){
    this.studio=studio;this.daw=daw;this.sources=[];this.node=el('div','ww-sampler-fusion');
    this.message=el('p','ww-sampler-status','Add source snapshots, then listen on the Synth keyboard.');
    this.message.setAttribute('role','status');
    this.input=createFusionInput({onError:error=>this.report(error.message||String(error))});
    studio.bridge.midi.fusionInput=this.input;
    this.config=el('fieldset','ww-sampler-fusion-content');
    const sourceTools=el('div','ww-sampler-fields');
    this.part=select(sourceTools,'Fusion Synth part',['A','B','C','D'].map((name,i)=>[i,'Part '+name]));
    const button=(name,fn)=>action(name,()=>studio.run(async()=>{
      try{return await fn();}catch(error){this.report(error.message);throw error;}
    }));
    this.addPart=button('Add Synth part',async()=>{
      const at=Number(this.part.value),instrument=await daw.player.currentTone(at);
      this.add({instrument,name:'Part '+'ABCD'[at]+' · '+(soundName(instrument)||engine(instrument))});
    });
    this.addTrack=button('Add selected DAW track',()=>{
      const track=daw.selectedTrack();
      if(track?.type!=='midi'||!track.instrument)throw Error('Select a MIDI track with an instrument in the DAW.');
      this.add({...track,name:track.name,trackId:track.id});
    });
    this.addOfficial=button('Add Official sampler',()=>this.addRef(studio.draft.baseRef));
    sourceTools.append(this.addPart,this.addTrack,this.addOfficial);
    this.list=el('div','ww-sampler-fusion-list');this.list.setAttribute('role','group');this.list.setAttribute('aria-label','Fusion sources');
    this.masterFx=el('input');this.masterFx.type='checkbox';
    const fx=el('div','ww-sampler-actions');control(fx,'Include DAW master FX',this.masterFx);
    this.listen=button('Listen to Fusion',()=>this.listenSources());
    this.stop=button('Release Fusion keyboard',()=>this.release());
    fx.append(this.listen,this.stop);
    const captureTools=el('div','ww-sampler-fields');
    this.title=control(captureTools,'Fusion name',el('input'));this.title.value='New Fusion';this.title.maxLength=120;
    this.mode=select(captureTools,'Fusion capture mode',[['single','Single Sample'],['texture','Sustained Texture']]);
    this.note=number(captureTools,'Capture note (MIDI)',60,0,127);
    this.velocity=number(captureTools,'Capture velocity',100,1,127);
    this.duration=number(captureTools,'Note duration (s)',1,.001,120,.001);
    this.sustain=number(captureTools,'Pedal hold (s)',0,0,120,.001);
    this.releaseTime=number(captureTools,'Release window (s)',.3,0,120,.001);
    this.tail=select(captureTools,'FX tail (s)',[0,2,4,8].map(n=>[n,String(n)]));
    this.phraseTools=el('div','ww-sampler-actions');
    this.phraseName=el('span','ww-muted','Sustained note');
    this.takePhrase=button('Use selected DAW MIDI clip',()=>{
      const clip=this.daw.clip();
      if(clip?.type!=='midi'||!clip.notes.length)throw Error('Select a DAW MIDI clip with notes, then use it for this texture.');
      this.phrase={clip:structuredClone(clip),bpm:this.daw.snapshot.bpm};
      this.sync();
    });
    this.clearPhrase=action('Use sustained note',()=>{this.phrase=null;this.sync();});
    this.phraseTools.append(this.takePhrase,this.clearPhrase,this.phraseName);
    this.mode.onchange=()=>{this.duration.value=this.mode.value==='texture'?5:1;this.sync();};
    this.capture=action('Capture Fusion WAV',()=>this.captureSources());
    this.config.append(sourceTools,this.list,fx,captureTools,this.phraseTools,this.capture);
    this.cancel=action('Cancel Fusion capture',()=>this.controller?.abort(new DOMException('Capture cancelled.','AbortError')));
    this.progress=el('progress');this.progress.max=1;this.progress.setAttribute('aria-label','Fusion capture progress');
    const feedback=el('div','ww-sampler-actions');feedback.append(this.progress,this.cancel);
    this.node.append(this.config,feedback,this.message);this.sync();
  }
  report(text){this.message.textContent=text;this.studio.status.textContent=text;}
  readyToAdd(){
    if(this.lease)throw Error('Release the Fusion keyboard before changing source instruments.');
    if(this.sources.length>=8)throw Error('Choose up to eight Fusion sources.');
  }
  add({name,instrument,volume=1,pan=0,fx=[],trackId}){
    this.readyToAdd();
    this.sources.push({id:crypto.randomUUID(),name,instrument:structuredClone(instrument),volume,pan,transpose:0,
      key:[0,127],velocity:[1,127],fx:structuredClone(fx),includeFx:!!fx.length,trackId});
    this.paint();this.report('Source added · '+name);
  }
  async addRef(ref){
    this.readyToAdd();
    this.add({instrument:await prepareSampler(this.daw.player,this.studio.root,ref),
      name:ref.path.split('/').at(-1)+' · r'+ref.revision});
  }
  snapshots(){
    return this.sources.map(({includeFx,fx,...source})=>({...structuredClone(source),fx:includeFx?structuredClone(fx):[]}));
  }
  effects(){return this.masterFx.checked?structuredClone(this.daw.snapshot.master.fx):[];}
  paint(){
    this.list.replaceChildren();
    for(const source of this.sources){
      const row=el('fieldset','ww-sampler-fusion-source');
      row.append(el('legend','',source.name+' · '+engine(source.instrument)));
      const fields=el('div','ww-sampler-fields');
      const makeNumber=(label,value,min,max,step,apply)=>{
        const field=number(fields,label,value,min,max,step);
        field.setAttribute('aria-label',source.name+' '+label);
        field.onchange=()=>this.adjust(source,()=>{
          if(!field.value||!field.checkValidity())throw Error('Choose a valid value for '+label+'.');
          apply(field.valueAsNumber);
        });
      };
      makeNumber('Level',source.volume,0,2,.01,v=>{source.volume=v;});
      makeNumber('Pan',source.pan,-1,1,.01,v=>{source.pan=v;});
      makeNumber('Transpose',source.transpose,-48,48,1,v=>{source.transpose=v;});
      for(const [key,lo,hi] of [['key',0,127],['velocity',1,127]]){
        const label=key==='key'?'key':'velocity';
        makeNumber('Low '+label,source[key][0],lo,source[key][1],1,v=>{source[key]=[v,source[key][1]];});
        makeNumber('High '+label,source[key][1],source[key][0],hi,1,v=>{source[key]=[source[key][0],v];});
      }
      if(source.fx.length){
        const check=el('input');check.type='checkbox';check.checked=source.includeFx;
        control(fields,'Include source FX · '+source.fx.map(f=>f.type).join(', '),check);
        check.onchange=()=>this.adjust(source,()=>{source.includeFx=check.checked;});
      }
      const remove=action('Remove source',()=>{this.sources=this.sources.filter(item=>item!==source);this.paint();});
      remove.setAttribute('aria-label','Remove '+source.name);remove.disabled=!!this.lease;
      fields.append(remove);row.append(fields);this.list.append(row);
    }
    this.sync();
  }
  adjust(source,change){
    void this.studio.run(async()=>{
      const previous=structuredClone(source);
      try{change();if(this.lease)await this.lease.setSources(this.snapshots());}
      catch(error){Object.assign(source,previous);this.report(error.message);throw error;}
      finally{this.paint();}
    });
  }
  async listenSources(){
    this.studio.audition.stop();
    const lease=await fusion.openFusionMonitor(this.daw,this.snapshots(),{masterFx:this.effects(),onError:e=>this.report(e.message)});
    this.lease=lease;this.input.bind(lease);
    this.report('Fusion owns the Synth keyboard · '+this.sources.map(s=>s.name).join(' + '));
    this.paint();
    void lease.closed.then(()=>{
      this.input.unbind(lease);
      if(this.lease===lease){this.lease=null;this.paint();}
    });
  }
  async release(){
    const lease=this.lease;if(!lease)return;
    this.input.unbind(lease);await lease.close();this.lease=null;
    this.paint();this.report('Fusion keyboard released.');
  }
  async captureSources(){
    const s=this.studio;
    if(s.busy||this.controller)return;
    await s.run(async()=>{
      if(!s.library)throw Error('Choose a Samples folder for Fusion captures.');
      if(s.draft&&s.dirty&&!await s.preserveWorking())return;
      const invalid=[...this.config.querySelectorAll('input,select')].find(field=>!field.checkValidity());
      if(invalid){invalid.reportValidity();throw Error('Check the capture settings.');}
      const token=new AbortController();this.controller=token;this.sync();this.progress.value=0;
      try{
        await this.release();s.audition.stop();
        this.report('Capturing the source mix…');
        const result=await fusion.captureFusion(this.daw,s.root,this.snapshots(),{name:this.title.value.trim(),mode:this.mode.value,
          phrase:this.mode.value==='texture'?this.phrase:undefined,notes:[this.note.valueAsNumber],velocities:[this.velocity.valueAsNumber],repeats:1,duration:this.duration.valueAsNumber,
          sustain:this.sustain.valueAsNumber,release:this.releaseTime.valueAsNumber,tail:Number(this.tail.value),masterFx:this.effects(),signal:token.signal,
          onProgress:({completed,total,stage,progress})=>{this.progress.value=((completed||0)+(progress||0))/Math.max(1,total);this.message.textContent='Fusion · '+stage+' · '+completed+' / '+total;}
        });
        await s.adopt(result.draft,await readSampleFile(s.root,result.draft.source),{dirty:true});
        await s.browser.page();this.report('Fusion captured · '+result.takes.length+' take(s) · '+result.report.frames+' frames · sources idle. The Working Copy plays the captured audio.');
      }catch(error){this.report(error.name==='AbortError'?'Fusion capture cancelled.':error.message);throw error;}
      finally{this.controller=null;this.sync();}
    },this.node);
  }
  reset(){this.sources=[];this.paint();}
  sync(){
    const pending=!!this.controller,n=this.sources.length,live=!!this.lease;
    this.config.disabled=pending;this.cancel.hidden=this.progress.hidden=!pending;
    this.addPart.disabled=this.addTrack.disabled=live||n>=8;this.addOfficial.disabled=live||n>=8||!this.studio.draft?.baseRef;
    this.masterFx.disabled=live;this.listen.disabled=live||n<2;this.stop.disabled=!live;
    this.capture.disabled=!this.studio.library||n<2;
    const texture=this.mode.value==='texture',phrase=texture&&this.phrase;
    this.phraseTools.hidden=!texture;this.clearPhrase.hidden=!phrase;
    this.phraseName.textContent=phrase?phrase.clip.name+' · '+phrase.clip.notes.length+' notes · '+phrase.bpm+' BPM':'Sustained note';
    this.duration.disabled=this.velocity.disabled=this.sustain.disabled=!!phrase;
  }
}
