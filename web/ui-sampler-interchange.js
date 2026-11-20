// SPDX-License-Identifier: GPL-3.0-only
import {el} from './ui-primitives.js';
import {collect,dependencies,findCandidates,inspect,inspectSample,prepareInstrument,relinkMatches,updateSampleMetadata} from './sampler-library.js';
import {inspectSfzImport,importSfz,planSfzExport,exportSfz} from './sampler-sfz.js';
import {planTapeBank,renderTapeBank,exportTapeBank} from './sampler-tape-export.js';
import {exportName} from './sampler-export-files.js';
import {permissionDenied} from './sampler-filesystem.js';
import {workingFromRef,promoteWorking} from './sampler-working.js';
import {stageWorkingSampler} from './sampler.js';

function section(title) {
  const node=el('details','ww-sampler-subsection');
  node.append(el('summary','',title));
  return node;
}
function field(parent,name,tag='input') {
  const label=el('label','',name), control=el(tag);
  control.setAttribute('aria-label',name);
  label.append(control);parent.append(label);return control;
}
function choice(select,options) {
  select.replaceChildren();
  for (const [value,label] of options) select.add(new Option(label,value));
}
const list = text => text.split(',').map(v=>v.trim()).filter(Boolean);
const show = issue => [issue.severity,issue.code,issue.message,issue.root!=null?'MIDI '+issue.root:'',
  issue.regionId,issue.path,issue.line?'line '+issue.line:'',issue.fields?.join(', ')].filter(Boolean).join(' · ');

export function createSamplerInterchange(studio) {
  const node=el('div','ww-sampler-interchange'),identity=el('p','ww-muted');
  const meta=section('Sample metadata'),repair=section('Dependencies and portable copy'),exchange=section('SFZ and Mellotron');
  node.append(identity,meta,repair,exchange);
  const button=(label,work)=>studio.button(label,work);
  const picker=async(id,mode)=>{
    try {return await node.ownerDocument.defaultView.showDirectoryPicker({id,mode});}
    catch(error){if(permissionDenied(error))throw Error('Folder access was denied. Choose the folder again and grant '+mode+' access.');throw error;}
  };
  const notice=message=>{studio.status.textContent=message;};
  let entry,libraryId,draftId,baseRevision,sample,model,ref,importFolder,review;
  const metaFields=el('div','ww-sampler-fields');
  const title=field(metaFields,'Sample title'),tags=field(metaFields,'Sample tags (comma separated)');
  const license=field(metaFields,'Sample license'),sourceInfo=el('pre','ww-sampler-provenance');
  const origin=section('Source and processing recipe');origin.append(sourceInfo);
  const properties=el('p','ww-muted');
  const readSample=async()=>{
    if(ref){
      model=(await inspect(studio.root,ref)).instrument;
      title.value=model.name;tags.value=model.tags.join(', ');license.parentElement.hidden=true;
      properties.textContent=model.kind+' · '+model.regions.length+' regions · r'+ref.revision;
      sourceInfo.textContent='';origin.hidden=true;selectors(model);
      metaFields.hidden=false;saveMeta.disabled=false;notice('Official metadata · '+ref.path);return;
    }
    sample=await inspectSample(studio.root,entry.path,{verify:true});
    license.parentElement.hidden=false;
    title.value=sample.name;tags.value=sample.tags.join(', ');license.value=typeof sample.license==='string'?sample.license:'';
    license.disabled=typeof sample.license==='object'&&sample.license!==null;
    properties.textContent=sample.channels+' ch · '+sample.sampleRate+' Hz · '+sample.frames+' frames · '+sample.sha256;
    sourceInfo.textContent=JSON.stringify({source:sample.source,recipe:sample.recipe,provenance:sample.provenance,
      ...(license.disabled?{license:sample.license}:{})},null,2);
    origin.hidden=sourceInfo.textContent==='{}';
    metaFields.hidden=false;saveMeta.disabled=false;notice('Verified sample · '+sample.path);
  };
  const saveMeta=button('Save sample metadata',async()=>{
    if(ref){
      const pinned=ref,draft=await workingFromRef(studio.root,pinned);
      const instrument={...model,name:title.value.trim(),tags:list(tags.value)};
      const updated=await promoteWorking(studio.root,{...draft,name:instrument.name,instrument},{player:studio.player});
      select({kind:instrument.kind,id:updated.instrumentId,path:updated.path,revision:updated.revision,displayName:instrument.name});
      await studio.browser.page();notice('Official metadata published · r'+updated.revision);return;
    }
    if(!sample)return;
    sample=await updateSampleMetadata(studio.root,sample.path,{name:title.value.trim(),tags:list(tags.value),
      ...(!license.disabled?{license:license.value.trim()}:{})},{expectedSha256:sample.sha256});
    await studio.browser.page();notice('Sample metadata saved · '+sample.path);
  });
  const inspectMeta=button('Inspect sample metadata',readSample);
  meta.append(inspectMeta,properties,metaFields,origin,saveMeta);
  const files=el('ul','ww-sampler-file-report');
  async function diagnose() {
    const pinned=ref;
    if(!pinned)throw Error('Choose an Official instrument first.');
    files.replaceChildren();
    const report=await dependencies(studio.root,pinned);
    const replacements=new Map();
    const apply=button('Relink selected WAVs',async()=>{
      const matches=new Map([...replacements].map(([id,field])=>[id,field.value]));
      const updated=await relinkMatches(studio.root,pinned,matches,{expectedRevision:pinned.revision});
      select({kind:updated.path.startsWith('Kits/')?'kit':'instrument',path:updated.path,id:updated.instrumentId,revision:updated.revision});
      await diagnose();await studio.browser.page();notice('Relinked in Official r'+updated.revision+' · '+updated.path);
    });
    apply.disabled=true;
    for(const item of report.items){
      const row=el('li');
      row.append(el('span','',item.path+' · '+item.status+(item.message?' · '+item.message:'')));
      if(['missing-sample','digest-mismatch'].includes(item.status)){
        const options=el('select'),label='Replacement for '+item.id;
        options.setAttribute('aria-label',label);
        replacements.set(item.id,options);options.hidden=true;
        row.append(button('Find matching WAVs',async()=>{
          const result=await findCandidates(studio.root,item);
          choice(options,[['','Choose a verified WAV'],...result.candidates.map(c=>[c.path,c.path])]);
          options.hidden=!result.candidates.length;apply.disabled=true;
          notice(result.candidates.length+' matching WAVs · '+item.path);
        }),options);
        options.onchange=()=>{apply.disabled=[...replacements.values()].some(f=>!f.value);};
      }
      files.append(row);
    }
    if(replacements.size){const row=el('li');row.append(apply);files.append(row);}
    notice(report.items.filter(i=>i.status==='ok').length+' of '+report.items.length+' dependencies verified.');
  }
  repair.append(button('Check dependencies',diagnose),files,button('Collect portable instrument…',async()=>{
    const destination=await picker('sampler-collect','readwrite');
    const copied=await collect(studio.root,ref,destination);
    notice('Portable copy verified · '+destination.name+' / '+copied.path+' · r'+copied.revision);
  }));

  const controls=el('div','ww-sampler-fields');
  const format=field(controls,'Interchange operation','select');
  choice(format,[['sfz','Export SFZ'],['tapes','Export Mellotron tapes'],['import','Import SFZ']]);
  const folderName=field(controls,'Instrument or export folder name');
  const mapFile=field(controls,'Source SFZ map','select');
  const sourceButton=button('Choose SFZ source folder…',async()=>{
    const folder=await picker('sampler-sfz-source','read');
    const maps=[];
    for await(const item of folder.values())if(item.kind==='file'&&/\.sfz$/iu.test(item.name))maps.push(item.name);
    maps.sort((a,b)=>a.localeCompare(b));
    importFolder=folder;choice(mapFile,maps.map(name=>[name,name]));
    if(maps.length)folderName.value=maps[0].replace(/\.sfz$/iu,'');
    invalidate();notice(maps.length?maps.length+' SFZ maps in '+folder.name:'Choose the folder directly containing the .sfz map.');
  });
  const tapeFields=el('div','ww-sampler-fields');
  const roots=field(tapeFields,'Tape MIDI roots (comma separated)'),velocity=field(tapeFields,'Tape velocity');
  velocity.type='number';velocity.min='1';velocity.max='127';velocity.value='';
  const seconds=field(tapeFields,'Maximum tape seconds');seconds.type='number';seconds.min='0.0001';seconds.max='8';seconds.step='any';seconds.value='8';
  const choices=el('div','ww-sampler-fields'),rootChoices=el('div','ww-sampler-fields');
  const diagnostics=el('ul','ww-sampler-file-report');
  let arts=new Map(),variants=new Map(),regions=new Map();
  const decision=el('label',''),accept=el('input');accept.type='checkbox';decision.append(accept,' Accept the reported conversion losses');
  const commit=button('Write reviewed conversion…',async()=>{
    if(!review || (review.loss&&!accept.checked))throw Error('Review the conversion and confirm any losses.');
    const current=review,acceptLosses=accept.checked;
    if(current.type==='import'){
      studio.player.requests();
      // Recheck the same file handle/content, even if another application replaced it.
      const now=await (await importFolder.getFileHandle(mapFile.value)).getFile();
      if(now.size>2*1024*1024||await now.text()!==current.text)throw Error('The SFZ map changed. Review it again.');
      const imported=await importSfz(studio.root,importFolder,current.text,{id:current.id,path:'Instruments/'+current.name,
        name:current.name,expectedRevision:0,acceptLosses,beforePublish:async instrument=>
          stageWorkingSampler(studio.player,await prepareInstrument(studio.root,instrument),{checkOnly:true})});
      select({kind:'instrument',id:imported.ref.instrumentId,path:imported.ref.path,revision:imported.ref.revision});
      await studio.browser.page();notice('SFZ imported · '+imported.ref.path+' · r'+imported.ref.revision);
    }else{
      const dest=await picker(current.type==='tapes'?'sampler-tapes-export':'sampler-sfz-export','readwrite');
      if(current.type==='tapes')await exportTapeBank(studio.root,current.ref,current.mapping,dest,{name:current.name,acceptLosses});
      else await exportSfz(studio.root,current.ref,dest,{folder:current.name,acceptLosses,...current.mapping});
      notice('Export verified · '+dest.name+' / '+current.name);
    }
    invalidate();
  });
  function invalidate(){
    review=null;commit.disabled=true;accept.checked=false;decision.hidden=true;diagnostics.replaceChildren();
  }
  accept.onchange=()=>{commit.disabled=!review||(review.loss&&!accept.checked);};
  function selectors(next) {
    choices.replaceChildren();arts=new Map();variants=new Map();regions=new Map();rootChoices.replaceChildren();
    function add(id,items,label,target){
      const input=field(choices,label,'select');
      choice(input,[['','Choose…'],...items.map(id=>[id,id])]);
      input.onchange=invalidate;target.set(id,input);
    }
    for(const group of new Set(next.articulations.map(a=>a.selectorGroup))){
      add(group,next.articulations.filter(a=>a.selectorGroup===group).map(a=>a.id),'Export articulation · '+group,arts);
    }
    for(const set of next.variations)add(set.id,set.order,'Export take · '+set.id,variants);
  }
  const values = map=>Object.fromEntries([...map].filter(([,field])=>field.value).map(([id,field])=>[id,field.value]));
  async function plan(){
    invalidate();
    const type=format.value,name=folderName.value.trim();
    exportName(name);
    let result,mapping,text;
    if(type==='import'){
      if(!importFolder||!mapFile.value)throw Error('Choose the folder containing an SFZ map.');
      const file=await (await importFolder.getFileHandle(mapFile.value)).getFile();
      if(file.size>2*1024*1024)throw Error('The SFZ text exceeds the 2 MiB map limit.');
      text=await file.text();result=await inspectSfzImport(importFolder,text);
    }else{
      if(!ref)throw Error('Choose an Official instrument first.');
      if(!model){model=(await inspect(studio.root,ref)).instrument;selectors(model);}
      mapping={articulations:values(arts),variants:values(variants)};
      if(type==='tapes'){
        if (roots.value.trim()) {
          const notes=list(roots.value).map(v=>/^\d+$/.test(v)?Number(v):NaN);
          mapping.roots=notes;
        }
        if(velocity.value)mapping.velocity=velocity.valueAsNumber;
        mapping.seconds=seconds.valueAsNumber;mapping.regions=values(regions);
        result=planTapeBank(model,mapping);
        if(result.ok) result=await renderTapeBank(studio.root,ref,mapping);
        for(const d of result.diagnostics.filter(d=>d.code==='ambiguous-root')){
          if(regions.has(d.root))continue;
          const select=field(rootChoices,'Tape region · MIDI '+d.root,'select');
          choice(select,[['','Choose a region'],...d.candidates.map(id=>[id,id])]);
          select.onchange=invalidate;regions.set(d.root,select);
        }
      }else result=planSfzExport(model,mapping);
    }
    const seen=new Set();
    for(const issue of result.diagnostics){const line=show(issue);if(!seen.has(line))diagnostics.append(el('li','',line));seen.add(line);}
    const total=type==='tapes'?result.entries.length:type==='sfz'?result.samples.length:result.regions.length;
    if(!result.diagnostics.length)diagnostics.append(el('li','','No conversion losses reported.'));
    notice('Conversion review · '+total+' '+(type==='import'?'regions':type==='tapes'?'tapes':'WAVs')+(result.ok?'':' · resolve the listed errors.'));
    if(result.ok){
      const loss=result.diagnostics.some(d=>d.severity==='loss');
      review={type,name,text,mapping,ref,loss,...(type==='import'?{id:crypto.randomUUID()}:{})};
      decision.hidden=!loss;commit.disabled=loss;
    }
  }
  const inspectPlan=button('Review conversion',plan);
  exchange.append(controls,sourceButton,tapeFields,choices,rootChoices,inspectPlan,diagnostics,decision,commit);
  for(const input of [folderName,mapFile,roots,velocity,seconds])input.oninput=invalidate;
  mapFile.onchange=()=>{folderName.value=mapFile.value.replace(/\.sfz$/i,'');invalidate();};
  function display(){
    const importing=format.value==='import',tapes=format.value==='tapes';
    sourceButton.hidden=!importing;mapFile.parentNode.hidden=!importing;tapeFields.hidden=!tapes;
    choices.hidden=importing;rootChoices.hidden=!tapes;
    inspectPlan.disabled=importing?!mapFile.value:!ref;
  }
  format.onchange=()=>{invalidate();display();};
  function select(item){
    if(libraryId!==studio.library?.id){importFolder=null;mapFile.replaceChildren();}
    libraryId=studio.library?.id;draftId=studio.draft?.id;baseRevision=studio.draft?.baseRef?.revision;entry=item;model=null;sample=null;
    const isOfficial=['instrument','kit'].includes(item?.kind);
    ref=isOfficial?{type:'sampler',libraryId,instrumentId:item.id,path:item.path,revision:item.revision}:item?.ref??null;
    identity.textContent=entry?(ref?'Official r'+ref.revision+' · '+ref.path:entry.path):'Choose a library entry.';
    meta.hidden=item?.kind!=='sample'&&!ref;repair.hidden=!ref;exchange.hidden=!studio.library;
    meta.querySelector('summary').textContent=ref?'Official metadata':'Sample metadata';
    inspectMeta.textContent=ref?'Inspect Official metadata':'Inspect sample metadata';
    saveMeta.textContent=ref?'Publish metadata revision':'Save sample metadata';
    title.setAttribute('aria-label',ref?'Official title':'Sample title');title.parentNode.firstChild.nodeValue=title.getAttribute('aria-label');
    tags.setAttribute('aria-label',ref?'Official tags (comma separated)':'Sample tags (comma separated)');
    tags.parentNode.firstChild.nodeValue=tags.getAttribute('aria-label');
    metaFields.hidden=true;origin.hidden=true;saveMeta.disabled=true;properties.textContent=sourceInfo.textContent='';
    files.replaceChildren();selectors({articulations:[],variations:[]});invalidate();
    if(ref)folderName.value=(item.displayName||ref.path.split('/').at(-1));
    display();
  }
  function sync(){
    const d=studio.draft;
    if(studio.library?.id!==libraryId||d?.id!==draftId||baseRevision!==d?.baseRef?.revision||(!entry&&d)){
      const base=d?.baseRef;
      select(base?{kind:d.instrument?.kind??'instrument',id:base.instrumentId,path:base.path,revision:base.revision}
        :d?{kind:'sample',path:d.source.path}:null);
    }
    display();
  }
  select(null);
  return {node,select,sync};
}
