// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';

const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome'});
try {
  const page = await browser.newPage({viewport:{width:1150,height:860}});
  await page.goto(new URL('sampler-wav.js',process.env.SAMPLER_BROWSER_URL || 'http://localhost:8737/simulator/').href);
  await page.setContent('<link rel="stylesheet" href="ui-foundation.css"><link rel="stylesheet" href="ui-sampler-mapping.css"><main class="ww-page ww-shell ww-sampler-studio"></main>');
  await page.evaluate(async () => {
    const {createInstrument} = await import('./sampler-instrument.js');
    const {createSamplerMapping} = await import('./ui-sampler-mapping.js');
    const sample = id => ({id,path:'Samples/'+id+'.wav',sha256:(id==='soft'?'0':'1').repeat(64),sampleRate:44100,channels:1,frames:2000});
    const region = {group:'main',sample:'soft',root:60,key:[48,72],layer:'piano'};
    window.model = createInstrument({name:'Map test',samples:[sample('soft'),sample('forte')],
      layers:[{id:'piano',velocity:[16,96],fadeOut:[64,80]}],
      variations:[{id:'rr',mode:'sequential',order:['a','b']}],regions:[
        {...region,id:'a',variation:{set:'rr',member:'a'}},
        {...region,id:'b',variation:{set:'rr',member:'b'}},
        {...region,id:'tail',trigger:'release',sample:'forte'}
      ]});
    window.errors = [];
    window.edits = 0;
    window.selected = 'a';
    const grid = createSamplerMapping({change:(next,options) => {
      window.edits++; window.model=next; selected=options?.regionId ?? selected; grid.sync(model,selected);
    },select:id=>{selected=id;grid.sync(model,id);},run:fn=>{try{fn();}catch(e){errors.push(e.message);}}});
    document.querySelector('main').append(grid.node);
    grid.sync(model,selected);
  });
  const button = name => page.getByRole('button',{name,exact:true});
  const field = name => page.getByLabel(name,{exact:true});
  const set = async(name,value) => { await field(name).fill(String(value)); await field(name).press('Tab'); };
  await set('Probe velocity',72);
  await button('Explain note').click();
  const voices = page.locator('.ww-sampler-map-probe li');
  assert.match(await voices.first().textContent(),/attack.* · a · weight 0.707/);
  assert.match(await voices.last().textContent(),/release.* · tail · weight 0.707/);
  await button('Explain note').click();
  assert.match(await voices.first().textContent(),/attack.* · b · weight 0.707/);
  const box = await page.locator('.ww-sampler-keymap').boundingBox();
  const x = key => box.x + 30 + (key + .5) * (box.width - 42) / 128;
  const y = vel => box.y + 8 + (127 - vel + .5) * (box.height - 46) / 127;
  await page.mouse.move(x(60),y(56)); await page.mouse.down();
  await page.mouse.move(x(65),y(60)); await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>model.regions[0].key),[53,77]);
  assert.deepEqual(await page.evaluate(()=>model.layers[0].velocity),[20,100]);
  assert.deepEqual(await page.evaluate(()=>model.layers[0].fadeOut),[68,84]);
  const right = box.x + 30 + 78 * (box.width-42)/128 - 2;
  await page.mouse.move(right,y(54)); await page.mouse.down();
  await page.mouse.move(right+4*(box.width-42)/128,y(54)); await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>model.regions[0].key),[53,81]);
  assert.equal(await page.evaluate(()=>edits),2);
  await set('Region root (MIDI)',63);
  await set('Low key',55);
  await field('Region sample').selectOption('forte');
  await field('Region playback').selectOption('oneShot');
  await field('Region trigger').selectOption('release');
  await button('Duplicate region').click();
  const copied = await page.evaluate(()=>model.regions.find(r=>r.id===selected));
  assert(copied.id !== 'a' && copied.sample==='forte' && copied.root===63 && copied.trigger==='release' && copied.mode==='oneShot');
  await button('Remove region').click();
  assert.equal(await page.evaluate(()=>model.regions.length),3);
  await field('Selected region').selectOption('a');
  await page.getByText('Key and velocity crossfades',{exact:true}).click();
  await field('Key fade in').check();
  await set('Key fade in end',67);
  assert.deepEqual(await page.evaluate(()=>model.regions[0].keyFadeIn),[55,67]);
  await set('Low key',100);
  assert.equal(await field('Low key').inputValue(),'55');
  assert.equal(await page.evaluate(()=>errors.length),1);
  await button('Reset probe').click();
  await set('Probe note (MIDI)',1);
  await button('Explain note').click();
  await page.getByText('C♯-1 · velocity 72 · No matching region').waitFor();
  await mkdir('.local/validation/sampler-ux-3',{recursive:true});
  await page.screenshot({path:'.local/validation/sampler-ux-3/mapping-inspector.png'});
  console.log('PASS region move/resize (one edit per gesture), shared layer and fade translation, root, sample/mode/trigger editing, duplication/removal, RR, crossfade, release, note outside map');
} finally { await browser.close(); }
