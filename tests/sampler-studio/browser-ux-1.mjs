// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, open, rm, writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {wavHeader} from '../../web/studio-format.js';
import {startSynth} from '../browser-foundation-controls.mjs';

const rate = 44100, frames = 420 * rate;
const start = 300 * rate, length = 3 * rate;
const evidence = '.local/validation/sampler-ux-1';
await mkdir(evidence, {recursive:true});
const dir = await mkdtemp(join(tmpdir(), 'waswan-sampler-ux-'));
const path = join(dir, 'Long stereo take.wav');
const url = process.env.SAMPLER_BROWSER_URL || 'http://localhost:8737/simulator/';

async function fixture() {
  const output = await open(path, 'wx');
  try {
    await output.write(new Uint8Array(wavHeader(frames)));
    await output.truncate(44 + frames * 4);
    const region = Buffer.alloc(length * 4);
    for (let i = 0; i < length; i++) {
      region.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * i * 220 / rate)), i * 4);
      region.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * i * 330 / rate)), i * 4 + 2);
    }
    await output.write(region, 0, region.length, 44 + start * 4);
  } finally { await output.close(); }
}
async function hashFile() {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
let page;
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome'});
try {
  await fixture();
  const hash = await hashFile();
  page = await browser.newPage({viewport:{width:1366,height:864}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.audit = {contexts:0, hosts:0, sampleFrames:[], commands:[]};
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('UX library', {create:true});
    audit.source = {id:'ux-midi',name:'UX MIDI',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess = async () => ({inputs:new Map([[audit.source.id,audit.source]])});
    const Context = AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) { super(...args); audit.contexts++; audit.context = this; }
    };
    const Worklet = AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'obervave-smk37') return;
        audit.hosts++;
        audit.node = this;
        const send = this.port.postMessage.bind(this.port);
        this.port.postMessage = (message,...rest) => {
          audit.commands.push(message.t);
          if (message.t === 'daw-sampler-begin') {
            audit.sampleFrames.push(...message.packed.dependencies.map(s => s.frames));
          }
          send(message,...rest);
        };
        this.port.addEventListener('message', ({data}) => {
          if (data.t === 'frame') audit.frame = data;
        });
      }
    };
  });
  const studio = page.locator('[data-view="sampler"]');
  const button = name => studio.getByRole('button',{name,exact:true});
  const field = name => studio.getByLabel(name,{exact:true});
  const nav = () => page.locator('[data-workspace="sampler"]').first().click();
  const set = async (name, value) => {
    const input = field(name);
    await input.fill(String(value));
    await input.press('Tab');
    const actual = await input.inputValue();
    if (name.endsWith('(ms)')) assert(Math.abs(Number(actual)-value) <= 1000/rate, name);
    else assert.equal(actual,String(value),name);
  };
  await page.goto(url);
  await startSynth(page,{connect:true});
  await nav();
  await button('Choose Samples folder…').click();
  await page.waitForFunction(() => document.querySelector('.ww-sampler-status')?.textContent.startsWith('Samples folder ready'));
  await field('Import WAV').setInputFiles(path);
  await page.waitForFunction(() => document.querySelector('.ww-sampler-status')?.textContent.startsWith('Original imported') && !document.querySelector('.ww-sampler-studio').hasAttribute('aria-busy'));
  // The only native picker double is the storage destination. Input is a real disk file.
  await set('Start frame', start);
  await set('End frame', start + length);
  await button('Preview selection').click();
  await page.screenshot({path:join(evidence,'long-selection.png')});
  assert.deepEqual(await page.evaluate(() => audit.sampleFrames), []);
  await button('Create Sample from Selection').click();
  await button('Back to source take').waitFor();
  await set('Working name','WASWAN extracted tone');
  await set('Fade in (ms)',25);
  await set('Fade out (ms)',80);
  await set('Pitch shift (semitones)',3);
  await button('Save Working').click();
  await button('Render Version').click();
  await button('Promote to Official').click();
  const inspectPublished = async () => {
    const root = await showDirectoryPicker();
    const {search,load,readLibrary} = await import('./sampler-library.js');
    const found = (await search(root,{kind:'instrument',text:'WASWAN extracted tone'})).items[0];
    if (!found) return;
    const library = await readLibrary(root);
    return load(root,{type:'sampler',libraryId:library.id,instrumentId:found.id,revision:found.revision,path:found.path});
  };
  await page.waitForFunction(() => document.querySelector('.ww-sampler-status')?.textContent.startsWith('Official r1 published'));
  const model = await page.evaluate(inspectPublished);
  assert.equal(model.revision,1);
  const sample = model.samples.find(s => s.id === model.regions[0].sample);
  assert.equal(sample.frames,length);
  assert.equal(sample.channels,2);
  assert.notEqual(hash,sample.sha256);
  const decoded = await page.evaluate(async sample => {
    const root = await showDirectoryPicker();
    const {readSampleFile,inspectSample,search} = await import('./sampler-library.js');
    const {decodeWav} = await import('./sampler-wav.js');
    const librarySources = (await search(root,{kind:'sample'})).items;
    const imported = librarySources.find(entry => entry.path.startsWith('Samples/Originals/'));
    const source = await inspectSample(root,imported.path,{verify:true});
    const {pcm,channels} = await decodeWav(await readSampleFile(root,sample));
    function frequency(channel) {
      let rises = 0;
      for (let i = 44101; i <= 88200; i++) {
        if (pcm[(i-1)*channels+channel] <= 0 && pcm[i*channels+channel] > 0) rises++;
      }
      return rises;
    }
    return {frequencies:[frequency(0),frequency(1)],first:pcm[0],last:pcm.at(-1),originalHash:source.sha256};
  },sample);
  assert.equal(decoded.originalHash,hash);
  for (const [i,base] of [220,330].entries()) assert(Math.abs(decoded.frequencies[i]-base*2**(3/12)) < 3);
  assert(Math.abs(decoded.first) < 20 && Math.abs(decoded.last) < 20);
  await studio.getByRole('combobox',{name:/Keyboard source/}).selectOption('official');
  await button('Play on Synth keyboard').click();
  await page.waitForFunction(() => audit.commands.includes('daw-sampler-live'));
  await page.evaluate(() => {
    audit.meter = audit.context.createAnalyser();
    audit.node.connect(audit.meter);
    audit.source.onmidimessage({data:[0x90,60,104],timeStamp:performance.now()});
  });
  await page.waitForFunction(() => {
    const pcm = new Float32Array(2048);
    audit.meter.getFloatTimeDomainData(pcm);
    return pcm.some(x => Math.abs(x) > .005);
  });
  const before = await page.evaluate(() => audit.commands.length);
  await page.locator('[data-workspace="perf"]').first().click();
  await nav();
  assert.deepEqual(await page.evaluate(i => audit.commands.slice(i).filter(t =>
    ['daw-sampler-live','panic','note','store','daw-stop'].includes(t)), before), []);
  await page.evaluate(() => audit.source.onmidimessage({data:[0x80,60,0],timeStamp:performance.now()}));
  await page.screenshot({path:join(evidence,'playable-excerpt.png')});
  await page.locator('[data-workspace="daw"]').first().click();
  await page.getByRole('button',{name:'Add MIDI track',exact:true}).click();
  await nav();
  await button('Assign Official to selected DAW track').click();
  await page.waitForFunction(() => /assigned|using|adopted/i.test(document.querySelector('.ww-sampler-status').textContent));
  await button('Save Working').click();
  await page.waitForFunction(() => document.querySelector('.ww-sampler-status').textContent.startsWith('Working Copy saved'));
  const observed = await page.evaluate(() => ({contexts:audit.contexts,hosts:audit.hosts,sampleFrames:audit.sampleFrames}));
  assert.equal(observed.contexts,1);
  assert.equal(observed.hosts,1);
  assert(observed.sampleFrames.length && observed.sampleFrames.every(n => n <= length));
  await page.reload();
  await nav();
  await button('WASWAN extracted tone').first().click();
  await page.waitForFunction(() => document.querySelector('.ww-sampler-status').textContent.startsWith('Working Copy reopened'));
  assert.equal(await field('Working name').inputValue(),'WASWAN extracted tone');
  assert.equal(await hashFile(),hash);
  assert.deepEqual(errors,[]);
  const report = {originalFrames:frames,sourceSha256:hash,excerptFrames:sample.frames,channels:sample.channels,
    revision:model.revision,decoded,browser:browser.version(),midi:'simulated Web MIDI input',...observed};
  await writeFile(join(evidence,'chrome.json'),JSON.stringify(report,null,2));
  console.log('PASS UX-1 seven-minute WAV to playable instrument',report);
} catch (error) {
  if (page) {
    await page.screenshot({path:join(evidence,'failure.png')});
    console.error(await page.locator('.ww-sampler-status').allTextContents());
  }
  throw error;
} finally {
  await browser.close();
  await rm(dir,{recursive:true,force:true});
}
