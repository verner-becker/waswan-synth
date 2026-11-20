// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {createInstrument} from './sampler-instrument.js';
import {createKit,kitFromSlices} from './sampler-kit.js';
import {suggestMapping} from './sampler-analysis.js';
import {importOriginal,inspectSample,readSampleFile} from './sampler-library.js';
import {renderDerivative,runOffline} from './sampler-offline.js';
import {createWorking} from './sampler-working.js';

const filename=sample=>sample.path.split('/').at(-1);
function input(parent,title,type,options={}){
  const label=el('label','',title),node=el('input');
  Object.assign(node,{type,...options});node.setAttribute('aria-label',title);label.append(node);parent.append(label);return node;
}

export class SamplerBuilder {
  constructor(studio){
    this.studio=studio;this.items=[];this.node=el('div','ww-sampler-builder');
    const inputs=el('div','ww-sampler-fields');this.name=input(inputs,'Builder name','text',{value:'Untitled instrument',maxLength:128});
    const files=el('input');files.type='file';files.accept='.wav,audio/wav';files.multiple=true;files.hidden=true;files.setAttribute('aria-label','Import builder WAVs');
    files.onchange=()=>{const batch=[...files.files];files.value='';if(batch.length)void studio.run(()=>this.importFiles(batch));};
    this.import=action('Import recordings…',()=>files.click());
    this.current=studio.button('Add current sample',()=>this.addCurrent());
    this.analyze=studio.button('Suggest recording roots',()=>this.analyzeRoots());
    const toolbar=el('div','ww-sampler-actions');toolbar.append(this.import,files,this.current,this.analyze);
    this.rows=el('ul','ww-sampler-recordings');this.rows.setAttribute('aria-label','Builder recordings');
    const build=el('div','ww-sampler-actions');
    this.melodic=studio.button('Build multisample instrument',()=>this.build('instrument'));this.melodic.classList.add('ww-primary');
    this.kit=studio.button('Build kit from files',()=>this.build('kit'));
    this.extend=studio.button('Add recordings to current map',()=>this.build('extend'));
    build.append(this.melodic,this.kit,this.extend);
    const slices=el('details','ww-sampler-slices');slices.append(el('summary','','Kit from a sliced recording'));
    const sliceFields=el('div','ww-sampler-fields');
    this.markers=input(sliceFields,'Slice markers (frames)','text',{placeholder:'e.g. 22050, 44100'});
    this.padNote=input(sliceFields,'First kit note','number',{min:0,max:127,step:1,value:36});
    this.equal=studio.button('Set 16 equal slices',()=>this.equalSlices());
    this.transients=studio.button('Suggest transient slices',()=>this.transientSlices());
    this.sliced=studio.button('Build kit from slices',()=>this.build('slices'));
    slices.append(sliceFields,this.equal,this.transients,this.sliced);
    this.node.append(inputs,toolbar,this.rows,build,slices);
  }
  reset(){this.items=[];this.markers.value='';this.paint();}
  add(sample){
    if(!this.items.some(item=>item.sample.id===sample.id))this.items.push({sample});
    this.paint();
  }
  async importFiles(files){
    const s=this.studio;if(!s.library)throw Error('Choose a Samples folder first.');
    for(const file of files){
      const source=await importOriginal(s.root,file,'Samples/Originals/'+file.name);
      this.add(source);
    }
    await s.browser.page();s.status.textContent=this.items.length+' recordings in the builder.';
  }
  async fromLibrary(path){
    this.add(await inspectSample(this.studio.root,path));
    this.studio.sections.get('Instrument Builder').open=true;
    this.studio.status.textContent='Added to builder · '+path;
  }
  addCurrent(){
    const d=this.studio.draft;
    if(!d.rendered&&!d.instrument&&(d.recipe.some(op=>!op.bypass)||d.selection[0]!==0||d.selection[1]!==d.source.frames))
      throw Error('Render the edited sample before adding it to the builder.');
    const selected=d.instrument?.regions.find(r=>r.id===this.studio.regionId);
    this.add(selected?d.instrument.samples.find(s=>s.id===selected.sample):d.rendered||d.source);
    this.studio.status.textContent='Current sample added to builder.';
  }
  async analyzeRoots(){
    const s=this.studio;
    for(const item of this.items){
      if(item.root!==undefined)continue;
      const file=await readSampleFile(s.root,item.sample);
      const {start,end}=this.analysisRange(item.sample);
      const {wav}=await runOffline(file,{type:'edit',recipe:[{type:'trim',start,end}]});
      item.pitch=(await runOffline(wav,{type:'analyze'})).pitch;
    }
    this.paint();s.status.textContent='Root suggestions ready. Review each MIDI note before building.';
  }
  analysisRange(sample){
    const count=Math.min(sample.frames,sample.sampleRate*2),start=Math.floor((sample.frames-count)/2);
    return {start,end:start+count};
  }
  paint(){
    const suggestions=this.items.length?suggestMapping(this.items):[];
    this.rows.replaceChildren();
    this.items.forEach((item,index)=>{
      const row=el('li'),name=filename(item.sample),suggested=suggestions[index];
      const heading=el('span','',name);heading.title=item.sample.path;
      const root=input(row,'Root','number',{min:0,max:127,step:1,value:suggested.root??''});
      const velocity=input(row,'Velocity','number',{min:1,max:127,step:1,value:suggested.velocity??''});
      root.setAttribute('aria-label','Mapping root for '+name);velocity.setAttribute('aria-label','Mapping velocity for '+name);
      const manual=(field,key)=>{field.onchange=()=>void this.studio.run(()=>{
        if(!field.checkValidity())throw Error('Choose a MIDI value inside the indicated range.');
        if(field.value==='')delete item[key];else item[key]=field.valueAsNumber;
        this.paint();
      });};manual(root,'root');manual(velocity,'velocity');
      const details=suggested.root===null?'Set root manually':(item.root!==undefined?'Manual':suggested.origin==='analysis'?'Pitch analysis':'File name')+' · keys '+suggested.key.join('–')+
        (suggested.layer?' · velocity '+suggested.layer.join('–'):'');
      row.prepend(heading);row.append(el('small','ww-muted',details),action('Remove recording',()=>{this.items.splice(index,1);this.paint();}));
      this.rows.append(row);
    });
    if(!this.items.length)this.rows.append(el('li','ww-muted','Add a WAV from disk, the sample editor or the library.'));
    this.sync();
  }
  sync(){
    const s=this.studio,n=this.items.length;
    this.import.disabled=!s.library;this.current.disabled=!s.draft;this.analyze.disabled=this.melodic.disabled=!n;
    this.kit.disabled=n<1||n>16;this.extend.disabled=!n||s.draft?.instrument?.kind!=='instrument';
    this.sliced.disabled=this.transients.disabled=this.equal.disabled=n!==1;
  }
  equalSlices(){
    const length=this.items[0].sample.frames;
    const count=Math.min(16,length);
    this.markers.value=Array.from({length:count-1},(_,i)=>Math.floor(length*(i+1)/count)).join(', ');
  }
  async transientSlices(){
    const file=await readSampleFile(this.studio.root,this.items[0].sample);
    const {transients}=await runOffline(file,{type:'analyze'});
    this.markers.value=transients.filter(frame=>frame>0).slice(0,15).join(', ');
    this.studio.status.textContent='Review up to 15 onset markers before building the kit.';
  }
  async compatible(sample){
    if(sample.sampleRate===44100)return sample;
    const recipe=[{type:'rate',sampleRate:44100}],path='Samples/Processed/'+sample.id+'/44100.wav';
    return (await renderDerivative(this.studio.root,sample,recipe,path)).sample;
  }
  async build(kind){
    const s=this.studio,name=this.name.value.trim();
    if(!name)throw Error('Name the instrument before building.');
    const inputs=this.items;
    const proposals=suggestMapping(inputs);
    if(['extend','instrument'].includes(kind)&&proposals.some(p=>p.root===null))throw Error('Set a root note for each recording or run Suggest recording roots.');
    const first=this.padNote.valueAsNumber;
    if(['kit','slices'].includes(kind)&&(!Number.isInteger(first)||first<0||first>127))throw Error('Choose the first pad note from 0 through 127.');
    if(kind!=='extend'&&s.draft&&s.dirty&&!await s.preserveWorking())return;
    const samples=[];
    for(const {sample} of inputs)samples.push(await this.compatible(sample));
    let model;
    if(kind==='slices'){
      const scale=samples[0].sampleRate/inputs[0].sample.sampleRate;
      const markers=this.markers.value.trim()?this.markers.value.split(',').map(value=>{
        const frame=Number(value.trim());if(!value.trim()||!Number.isSafeInteger(frame))throw Error('Enter slice markers as integer frames separated by commas.');
        return Math.round(frame*scale);
      }):[];
      model=kitFromSlices(samples[0],markers,{name,firstNote:first});
    }else if(kind==='kit'){
      model=createKit({name,samples,pads:samples.map((sample,i)=>({
        index:i+1,note:first+i,label:inputs[i].sample.name,recordings:[{sample:sample.id}]
      }))});
    }else{
      const previous=kind==='extend'?s.draft.instrument:null,group=previous?.groups[0].id??'main';
      const regions=proposals.map((p,i)=>({id:crypto.randomUUID(),sample:samples[i].id,group,root:p.root,key:p.key,velocity:p.layer??[1,127]}));
      const assets=new Map([...(previous?.samples??[]),...samples].map(sample=>[sample.id,sample]));
      model=createInstrument({...previous,name:previous?.name||name,samples:[...assets.values()],regions:[...(previous?.regions??[]),...regions]});
      if(previous){s.changeInstrument(model,{regionId:regions[0].id});s.sections.get('Mapping Editor').open=true;s.status.textContent='Recordings added to the map.';return;}
    }
    const draft=createWorking({libraryId:s.library.id,name,source:samples[0],instrument:model,rootNote:model.regions[0].root});
    await s.adopt(draft,await readSampleFile(s.root,samples[0]),{dirty:true});
    const mapping=s.sections.get('Mapping Editor');mapping.open=true;mapping.querySelector('summary').focus();
    s.status.textContent='Working '+model.kind+' ready · '+model.regions.length+' regions. Review the mapping or play it on the Synth keyboard.';
  }
}
