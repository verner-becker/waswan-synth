// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';

const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome'});
const evidence = '.local/validation/sampler-ux-3';
await mkdir(evidence,{recursive:true});
try {
  const page = await browser.newPage({viewport:{width:1280,height:960}});
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('sampler-instrument.js',process.env.SAMPLER_BROWSER_URL||'http://localhost:8737/simulator/').href);
  await page.setContent('<main></main>');
  await page.evaluate(async()=>{
    const {createInstrument} = await import('./sampler-instrument.js');
    const {createSamplerGroupInspector} = await import('./ui-sampler-groups.js');
    const sample = {id:'tap',path:'Samples/Originals/tap.wav',sha256:'1'.repeat(64),channels:1,sampleRate:44100,frames:8192};
    window.model = createInstrument({name:'Inspector',samples:[sample],
      regions:['first','second'].map(id=>({id,sample:sample.id,group:'main',root:60,velocity:[55,110]}))});
    window.selected = 'first';
    window.messages = [];
    const inspector = createSamplerGroupInspector({run:async fn=>{
      try {await fn();} catch(e) {messages.push(e.message);}
    },change:(next,{regionId})=>{
      window.model=next;
      inspector.sync(model,regionId);
    }});
    const region = document.createElement('select');
    region.setAttribute('aria-label','Test selected region');
    for (const item of model.regions)region.add(new Option(item.id,item.id));
    region.onchange=()=>{window.selected=region.value;inspector.sync(model,selected);};
    document.querySelector('main').append(region,inspector.node);
    inspector.sync(model,selected);
  });
  const f = label=>page.getByLabel(label,{exact:true});
  const button = name=>page.getByRole('button',{name,exact:true});
  const open = async name=>{
    const summary=page.getByText(name,{exact:true}).and(page.locator('summary'));
    const visible=await summary.evaluate(s=>s.closest('details').open);
    if (!visible) await summary.click();
  };
  const value = async(name,v)=>{
    const field=f(name);
    await field.fill(String(v));
    await field.press('Tab');
  };
  await open('Groups and velocity layers');
  await f('New group ID').fill('felt');
  await button('Create and assign group').click();
  await f('New layer ID').fill('medium');
  await button('Create and assign layer').click();
  await open('Round-robin takes');
  await f('Take set ID').fill('pair');
  await button('Apply take set to region').click();
  await open('Articulations and keyswitches');
  await f('Articulation ID').fill('touch');
  await f('Selector group').fill('playing');
  await f('Articulation selector').selectOption('cc');
  await f('Articulation CC').fill('70');
  await f('CC range start').fill('33');
  await f('CC range end').fill('90');
  await button('Apply articulation to region').click();

  await f('Test selected region').selectOption('second');
  await open('Groups and velocity layers');
  await f('Region group').selectOption('felt');
  await f('Velocity layer').selectOption('medium');
  await open('Round-robin takes');
  await f('Variation set').selectOption('pair');
  await f('Region take').selectOption('B');
  await open('Articulations and keyswitches');
  await f('Region articulation').selectOption('touch');
  await open('Instrument Live Processing');
  await value('Choke group','taps');
  await f('Retrigger behavior').selectOption('cut');
  await f('Filter type').selectOption('bandpass');
  await value('Filter cutoff (Hz)',990);
  await value('Filter resonance',.4);
  await f('LFO shape').selectOption('triangle');
  await value('LFO rate (Hz)',3.5);
  await open('Envelopes · group');
  await value('Amplitude attack (ms)',14);
  await value('Amplitude decay (ms)',92);
  await value('Amplitude sustain',.7);
  await value('Amplitude release (ms)',130);
  await open('Modulation · group');
  await f('New modulation source').selectOption('CC');
  await f('New modulation CC').fill('74');
  await f('New modulation destination').selectOption('cutoffOctaves');
  await f('New modulation depth').fill('2');
  await button('Add modulation').click();

  const result=await page.evaluate(async()=>{
    const {compile,explainNote}=await import('./sampler-instrument.js');
    const {packSampler}=await import('./sampler-runtime.js');
    const plan=compile(model), packed=packSampler(model);
    const note = {type:'noteOn',note:60,velocity:72};
    const before=explainNote(plan,note);
    const enabled=explainNote(plan,{type:'cc',controller:70,value:64},before.state);
    const a=explainNote(plan,note,enabled.state),b=explainNote(plan,note,a.state);
    return {group:model.groups.find(g=>g.id==='felt'),art:model.articulations[0],set:model.variations[0],
      region:model.regions.map(r=>({layer:r.layer,member:r.variation.member})),layer:model.layers[0],
      sound:[before.voices,a.voices,b.voices].map(v=>v.map(x=>x.regionId)),
      outside:explainNote(plan,{...note,velocity:115},enabled.state).voices.length,
      pack:packed.regions.map(r=>({choke:r.choke,routes:r.routes.length,retrigger:r.retrigger})),messages};
  });
  assert.deepEqual(result.messages,[]);
  assert.deepEqual(result.sound,[[],['first'],['second']]);
  assert.equal(result.outside,0);
  assert.deepEqual(result.region,[{layer:'medium',member:'A'},{layer:'medium',member:'B'}]);
  assert.deepEqual(result.layer.velocity,[55,110]);
  assert.deepEqual(result.set.order,['A','B']);
  assert.deepEqual(result.art.select,{cc:70,range:[33,90]});
  assert.equal(result.group.choke,'taps');
  assert.deepEqual(result.group.filter,{type:'bandpass',cutoffHz:990,resonance:.4});
  assert.deepEqual(result.group.lfo,{shape:'triangle',rateHz:3.5});
  assert.deepEqual(result.group.envelope,{attackMs:14,decayMs:92,sustain:.7,releaseMs:130});
  assert.deepEqual(result.group.modulation,[{source:{cc:74},destination:'cutoffOctaves',depth:2,polarity:'unipolar'}]);
  assert.deepEqual(result.pack,[{choke:1,routes:1,retrigger:true},{choke:1,routes:1,retrigger:true}]);
  assert.deepEqual(errors,[]);
  await writeFile(evidence+'/group-inspector.json',JSON.stringify(result,null,2));
  console.log('PASS group inspector gestures compile to choke, two alternating takes, CC-selected velocity layer, filter, ADSR, LFO and modulation');
} finally {await browser.close();}
