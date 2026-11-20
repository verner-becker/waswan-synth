// SPDX-License-Identifier: GPL-3.0-only
import {action,el} from './ui-primitives.js';
import {samplerCapabilities as caps,validateInstrument} from './sampler-instrument.js';

const optionPairs = values => values.map(value => [value,value]);
const byId = (entries,id) => entries.find(entry => entry.id === id);
const groupFor = (model,region) => byId(model.groups,region.group);

export function createSamplerGroupInspector({change,run}) {
  const node=el('section','ww-sampler-group-inspector');
  const opened=new Map();
  let model,selectedId,scope='group';

  function edit(fn) {
    return run(() => {
      const copy=structuredClone(model);
      const region=byId(copy.regions,selectedId);
      if (!region) throw Error('Select a mapped region.');
      fn(copy,region);
      change(validateInstrument(copy),{regionId:selectedId});
    });
  }
  function section(title) {
    const box=el('details','ww-sampler-subsection');
    box.append(el('summary','',title));
    box.open=opened.get(title)??false;
    const fields=el('div','ww-sampler-fields');
    box.append(fields);node.append(box);
    return fields;
  }
  function input(parent,label,value,{type='text',min,max,step='any'}={}) {
    const wrap=el('label','',label),control=el('input');
    control.type=type;control.value=value??'';
    control.setAttribute('aria-label',label);
    if(type==='number')control.step=step;
    if(min!==undefined)control.min=min;
    if(max!==undefined)control.max=max;
    wrap.append(control);parent.append(wrap);return control;
  }
  function select(parent,label,pairs,value) {
    const wrap=el('label','',label),control=el('select');
    control.setAttribute('aria-label',label);
    for(const [id,text] of pairs)control.add(new Option(text,id));
    control.value=value??'';wrap.append(control);parent.append(wrap);return control;
  }
  function number(parent,label,value,min,max,step) {
    return input(parent,label,value,{type:'number',min,max,step});
  }
  function memberships(region) {
    const panel=section('Groups and velocity layers');
    const group=select(panel,'Region group',optionPairs(model.groups.map(g=>g.id)),region.group);
    group.onchange=()=>edit((_,r)=>{r.group=group.value;});
    const groupId=input(panel,'New group ID','');
    panel.append(action('Create and assign group',()=>edit((m,r)=>{
      const id=groupId.value.trim();
      m.groups.push({id,output:'main'});r.group=id;
    })));
    const layer=select(panel,'Velocity layer',[['','Local velocity range'],...optionPairs(model.layers.map(l=>l.id))],region.layer);
    layer.onchange=()=>edit((m,r)=>{
      if(layer.value){r.layer=layer.value;delete r.velocity;}
      else {r.velocity=[...byId(m.layers,r.layer).velocity];delete r.layer;}
    });
    const layerId=input(panel,'New layer ID','');
    panel.append(action('Create and assign layer',()=>edit((m,r)=>{
      const id=layerId.value.trim();
      const origin=r.layer?byId(m.layers,r.layer):{velocity:r.velocity};
      m.layers.push({...structuredClone(origin),id});r.layer=id;delete r.velocity;
    })));
  }
  function articulation(region) {
    const panel=section('Articulations and keyswitches');
    const selection=select(panel,'Region articulation',[['','Any articulation'],...optionPairs(model.articulations.map(a=>a.id))],region.articulation);
    selection.onchange=()=>edit((_,r)=>{if(selection.value)r.articulation=selection.value;else delete r.articulation;});
    const current=byId(model.articulations,region.articulation);
    const id=input(panel,'Articulation ID',current?.id);
    const family=input(panel,'Selector group',current?.selectorGroup??'default');
    const source=select(panel,'Articulation selector',[['key','Keyswitch'],['cc','MIDI CC']],current?.select.cc===undefined?'key':'cc');
    const key=number(panel,'Keyswitch note',current?.select.keyswitch??24,0,127,1);
    const cc=number(panel,'Articulation CC',current?.select.cc??1,0,127,1);
    const lo=number(panel,'CC range start',current?.select.range?.[0]??1,0,127,1);
    const hi=number(panel,'CC range end',current?.select.range?.[1]??127,0,127,1);
    const reveal=()=>{
      key.parentNode.hidden=source.value!=='key';
      for(const field of [cc,lo,hi])field.parentNode.hidden=source.value!=='cc';
    };
    source.onchange=reveal;reveal();
    panel.append(action('Apply articulation to region',()=>edit((m,r)=>{
      const selector=source.value==='key'?{keyswitch:key.valueAsNumber}:{cc:cc.valueAsNumber,range:[lo.valueAsNumber,hi.valueAsNumber]};
      const art={id:id.value.trim(),selectorGroup:family.value.trim(),select:selector};
      const existing=byId(m.articulations,art.id);
      if(existing)Object.assign(existing,art);else m.articulations.push(art);
      r.articulation=art.id;
    })));
    if(current)panel.append(action('Start in this articulation',()=>edit(m=>{
      delete m.initialArticulation;
      m.initialArticulations[current.selectorGroup]=current.id;
    })));
  }
  function roundRobin(region) {
    const panel=section('Round-robin takes');
    const set=byId(model.variations,region.variation?.set);
    const sets=select(panel,'Variation set',[['','No variation'],...optionPairs(model.variations.map(v=>v.id))],set?.id);
    sets.onchange=()=>edit((m,r)=>{
      const selected=byId(m.variations,sets.value);
      if(selected)r.variation={set:selected.id,member:selected.order[0]};else delete r.variation;
    });
    if(set){
      const member=select(panel,'Region take',optionPairs(set.order),region.variation.member);
      member.onchange=()=>edit((_,r)=>{r.variation.member=member.value;});
    }
    const id=input(panel,'Take set ID',set?.id);
    const order=input(panel,'Take order (comma separated)',set?.order.join(', ')??'A, B');
    const mode=select(panel,'Take selection',optionPairs(caps.variationModes),set?.mode??'sequential');
    const seed=number(panel,'Variation seed',set?.seed??0,0,4294967295,1);
    const repeat=select(panel,'Repeat last random take',[['no','Avoid repeat'],['yes','Allow repeat']],set?.avoidRepeat?'no':'yes');
    panel.append(action('Apply take set to region',()=>edit((m,r)=>{
      const orderIds=order.value.split(',').map(x=>x.trim());
      const value={id:id.value.trim(),order:orderIds,mode:mode.value,seed:seed.valueAsNumber,avoidRepeat:repeat.value==='no'};
      const existing=byId(m.variations,value.id);
      if(existing)Object.assign(existing,value);else m.variations.push(value);
      r.variation={set:value.id,member:orderIds.includes(r.variation?.member)?r.variation.member:orderIds[0]};
    })));
  }
  function liveSound(region) {
    const panel=section('Instrument Live Processing');
    const selectScope=select(panel,'Edit live parameters',[['group','Group · '+region.group],['instrument','Whole instrument']],scope);
    selectScope.onchange=()=>{scope=selectScope.value;draw();};
    const owner=(m,r)=>scope==='group'?groupFor(m,r):m;
    const entry=owner(model,region);
    const general=[['gainDb','Live gain (dB)',-144,48],['pan','Live panorama',-1,1],['cents','Live tuning (cents)',-9600,9600]];
    for(const [key,label,min,max] of general){
      const ctl=number(panel,label,entry[key]??0,min,max);
      ctl.onchange=()=>edit((m,r)=>{owner(m,r)[key]=ctl.valueAsNumber;});
    }
    if(scope==='group'){
      const choke=input(panel,'Choke group',entry.choke);
      choke.onchange=()=>edit((m,r)=>{const g=owner(m,r);if(choke.value.trim())g.choke=choke.value.trim();else delete g.choke;});
      const retrigger=select(panel,'Retrigger behavior',optionPairs(caps.retriggerModes),entry.retrigger??'layer');
      retrigger.onchange=()=>edit((m,r)=>{owner(m,r).retrigger=retrigger.value;});
    }
    const filter=select(panel,'Filter type',[['','Inherit / default'],...optionPairs(caps.filterTypes)],entry.filter?.type);
    const hz=number(panel,'Filter cutoff (Hz)',entry.filter?.cutoffHz??5000,10,19845);
    const q=number(panel,'Filter resonance',entry.filter?.resonance??0,0,1);
    function applyFilter(){return edit((m,r)=>{
      if(filter.value)owner(m,r).filter={type:filter.value,cutoffHz:hz.valueAsNumber,resonance:q.valueAsNumber};
      else delete owner(m,r).filter;
    });}
    filter.onchange=hz.onchange=q.onchange=applyFilter;
    hz.disabled=q.disabled=!filter.value;
    const lfo=select(panel,'LFO shape',[['','Inherit / default'],...optionPairs(caps.lfoShapes)],entry.lfo?.shape);
    const rate=number(panel,'LFO rate (Hz)',entry.lfo?.rateHz??1,.01,40);
    rate.disabled=!lfo.value;
    lfo.onchange=rate.onchange=()=>edit((m,r)=>{
      if(lfo.value)owner(m,r).lfo={shape:lfo.value,rateHz:rate.valueAsNumber};else delete owner(m,r).lfo;
    });
    const envPanel=section('Envelopes · '+(scope==='group'?'group':'instrument'));
    for(const [key,name] of [['envelope','Amplitude'],['filterEnvelope','Filter'],['auxEnvelope','Auxiliary']]){
      const fields=el('fieldset','ww-sampler-fields');fields.append(el('legend','',name+' envelope'));envPanel.append(fields);
      const settings={};
      for(const [field,label,defaultValue,max] of [['attackMs','attack (ms)',0,60000],['decayMs','decay (ms)',0,60000],['sustain','sustain',1,1],['releaseMs','release (ms)',5,60000]]){
        settings[field]=number(fields,name+' '+label,entry[key]?.[field]??defaultValue,0,max);
      }
      fields.onchange=()=>edit((m,r)=>{owner(m,r)[key]=Object.fromEntries(Object.entries(settings).map(([k,ctl])=>[k,ctl.valueAsNumber]));});
      if(entry[key])fields.append(action('Clear '+name.toLowerCase()+' envelope',()=>edit((m,r)=>{delete owner(m,r)[key];})));
    }
    const routes=section('Modulation · '+(scope==='group'?'group':'instrument'));
    function routeFields(route,index) {
      const row=el('div','ww-sampler-fields');routes.append(row);
      const label=index<0?'New modulation':'Modulation '+(index+1);
      const source=select(row,label+' source',optionPairs([...caps.modulationSources,'CC']),
        typeof route?.source==='object'?'CC':route?.source??'wheel');
      const cc=number(row,label+' CC',route?.source?.cc??1,0,127,1);
      cc.parentNode.hidden=source.value!=='CC';
      source.onchange=()=>{cc.parentNode.hidden=source.value!=='CC';};
      const destination=select(row,label+' destination',optionPairs(caps.modulationDestinations),route?.destination??'cutoffOctaves');
      const amount=number(row,label+' depth',route?.depth??1);
      const polarity=select(row,label+' polarity',optionPairs(['unipolar','bipolar']),route?.polarity??'unipolar');
      row.append(action(index<0?'Add modulation':'Update modulation '+(index+1),()=>edit((m,r)=>{
        const mod=owner(m,r).modulation??=[];
        const next={source:source.value==='CC'?{cc:cc.valueAsNumber}:source.value,destination:destination.value,depth:amount.valueAsNumber,polarity:polarity.value};
        if(index<0)mod.push(next);else mod[index]=next;
      })));
      if(index>=0)row.append(action('Remove modulation '+(index+1),()=>edit((m,r)=>{owner(m,r).modulation.splice(index,1);})));
    }
    (entry.modulation??[]).forEach(routeFields);routeFields(null,-1);
  }
  function draw() {
    for (const box of node.querySelectorAll('details')) opened.set(box.querySelector('summary').textContent,box.open);
    node.replaceChildren();
    const region=model&&byId(model.regions,selectedId);
    node.hidden=!region;
    if(!region)return;
    memberships(region);articulation(region);roundRobin(region);liveSound(region);
  }
  return {node,sync(next,id) {
    if(model===next&&selectedId===id)return;
    model=next;selectedId=id;draw();
  }};
}
