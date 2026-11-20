// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {metrics} from '../../web/dsp-stats.js';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {startSynth} from '../browser-foundation-controls.mjs';
import {clickDawFile} from '../daw-browser-controls.mjs';

const evidence = process.env.SAMPLER_VALIDATION_ROOT || '.local/validation/sampler-studio-1';
const url = process.env.SAMPLER_BROWSER_URL || 'http://localhost:8737/simulator/';
const rate = 44100;
const frequencies = [233, 547];
const pitches = [60, 67, 72];
const frames = 17640;
const binWindow = 2048;

function fixture() {
  const inner = Buffer.alloc(44 + frames * 4);
  inner.write('RIFF');
  inner.writeUInt32LE(inner.length - 8, 4);
  inner.write('WAVEfmt ', 8);
  inner.writeUInt32LE(16, 16);
  inner.writeUInt16LE(1, 20);
  inner.writeUInt16LE(2, 22);
  inner.writeUInt32LE(rate, 24);
  inner.writeUInt32LE(rate * 4, 28);
  inner.writeUInt16LE(4, 32);
  inner.writeUInt16LE(16, 34);
  inner.write('data', 36);
  inner.writeUInt32LE(frames * 4, 40);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < 2; channel++) {
      const level = Math.round(8000 * Math.sin(2 * Math.PI * frequencies[channel] * frame / rate));
      inner.writeInt16LE(level, 44 + frame * 4 + channel * 2);
    }
  }
  return inner;
}

function waveform(name, data) {
  const bytes = Buffer.from(data, 'base64');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(20), 1);
  assert.equal(bytes.readUInt16LE(22), 2);
  assert.equal(bytes.readUInt32LE(24), rate);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.toString('ascii', 36, 40), 'data');
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
  fs.writeFileSync(`${evidence}/${name}.wav`, bytes);
  return new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) / 2);
}

function amplitude(pcm, channel, start, hz) {
  let real = 0, imaginary = 0;
  for (let i = 0; i < binWindow; i++) {
    const angle = 2 * Math.PI * hz * i / rate;
    const sample = pcm[2 * (start + i) + channel] * (1 - Math.cos(2 * Math.PI * i / binWindow));
    real += sample * Math.cos(angle);
    imaginary += sample * Math.sin(angle);
  }
  return 2 * Math.hypot(real, imaginary) / binWindow;
}

function checkStereo(pcm, start, pitch, label) {
  assert(start + binWindow <= pcm.length / 2, `${label}: missing frames`);
  const ratio = 2 ** ((pitch - 60) / 12);
  return frequencies.map((frequency, channel) => {
    const wanted = amplitude(pcm, channel, start, frequency * ratio);
    const leakage = amplitude(pcm, 1 - channel, start, frequency * ratio);
    assert(wanted > 300, `${label}: channel ${channel} at note ${pitch} has amplitude ${wanted}`);
    assert(leakage < wanted * .03, `${label}: channel ${channel} at note ${pitch} leaks ${leakage}`);
    return wanted;
  });
}

function checkPhrase(pcm, name) {
  return pitches.map((pitch, index) => {
    const start = Math.round((.25 + index * .5) * rate);
    const duration = Math.ceil(frames / 2 ** ((pitch - 60) / 12));
    assert(pcm.slice((start - 512) * 2, (start - 16) * 2).every(v => v === 0), `${name}: sound before note ${pitch}`);
    const levels = checkStereo(pcm, start + 2048, pitch, name);
    checkStereo(pcm, start + duration - 3072, pitch, name);
    assert(pcm.slice((start + duration + 512) * 2, (start + duration + 1024) * 2).every(v => v === 0),
      `${name}: sound after note ${pitch}`);
    return levels;
  });
}

fs.mkdirSync(evidence, {recursive:true});
const source = fixture();
fs.writeFileSync(`${evidence}/stereo-source.wav`, source);
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1560,height:1100}}), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.audit = {contexts:0, hosts:0, directoryPicks:0, dsp:[], workletErrors:[]};
    audit.source = {id:'sampler-test',name:'Sampler test keyboard',state:'connected',async open(){},async close(){}};
    navigator.requestMIDIAccess = async () => ({inputs:new Map([[audit.source.id,audit.source]])});
    const Context = AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args) { super(...args); audit.contexts++; }
    };
    const Worklet = AudioWorkletNode;
    window.AudioWorkletNode = class extends Worklet {
      constructor(...args) {
        super(...args);
        if (args[1] !== 'obervave-smk37') return;
        audit.hosts++;
        audit.node = this;
        this.port.addEventListener('message', ({data}) => {
          if (data.t === 'frame') audit.frame = data;
          if (data.t === 'dsp-window' && data.session === 'sampler-chrome') audit.dsp.push(data);
          if (data.t === 'dsp-window' && audit.loadSession && data.session === audit.loadSession && !data.final) audit.loadWindows.push(data);
          if (data.t === 'error') audit.workletErrors.push(data.message);
        });
      }
    };
    // The encoder and writer run normally. Only the native save destination is replaced.
    window.showSaveFilePicker = async () => ({
      name:'sampler-probe.wav',
      async createWritable() {
        const chunks = [];
        return new WritableStream({write:chunk => chunks.push(chunk), close:() => { audit.wav = new Blob(chunks); }});
      }
    });
    window.showOpenFilePicker = async () => {
      const storage = await navigator.storage.getDirectory();
      return [await storage.getFileHandle('sampler-roundtrip.wsproj')];
    };
    window.showDirectoryPicker = async ({id}) => {
      audit.directoryPicks++;
      if (id !== 'waswan-samples' || !audit.root) throw Error('Unexpected browser fixture directory request');
      return audit.root;
    };
    audit.base64 = blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  });
  await page.goto(new URL('?workspace=daw', url).href);
  await startSynth(page);
  const daw = page.locator('.ww-daw');
  const button = name => daw.getByRole('button',{name,exact:true});
  const {ref,loadRef} = await page.evaluate(async encoded => {
    const {DawMix} = await import('./ui-daw-mix.js');
    const refresh = DawMix.prototype.refresh;
    DawMix.prototype.refresh = function(...args) { audit.w = this.w; return refresh.apply(this, args); };
    const {initializeLibrary, importOriginal, publish} = await import('./sampler-library.js');
    const {createInstrument} = await import('./sampler-instrument.js');
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    // Isolated native directory handles serve as a test double for the Chrome picker.
    audit.root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Sampler fixtures', {create:true});
    await initializeLibrary(audit.root, {id:'browser-library',name:'Browser library'});
    const sample = await importOriginal(audit.root, new File([bytes], 'stereo.wav'), 'Samples/Originals/stereo.wav', {id:'stereo'});
    const instrument = createInstrument({id:'stereo',name:'Stereo probe',samples:[sample],regions:[{
      id:'stereo-region',group:'main',sample:'stereo',key:[0,127],root:60,velocity:[1,127],trigger:'attack',mode:'one-shot'
    }]});
    const ref = await publish(audit.root, instrument, {path:'Instruments/Stereo',expectedRevision:0});
    const load = createInstrument({id:'load',name:'Sustained stereo load',samples:[sample],gainDb:-45,regions:[0,1].map(index => ({
      id:`load-region-${index}`,group:'main',sample:'stereo',key:[0,127],root:60,velocity:[1,127],trigger:'attack',mode:'gate',
      loop:{start:0,end:sample.frames}
    }))});
    const loadRef = await publish(audit.root, load, {path:'Instruments/Load',expectedRevision:0});
    return {ref,loadRef};
  }, source.toString('base64'));

  await page.locator('[data-workspace="perf"]').first().click();
  await page.getByRole('button',{name:'Instrument setup',exact:true}).click();
  const folders = page.locator('.ww-library-folders');
  await folders.locator('summary').click();
  const samples = folders.getByRole('group',{name:/^Samples/});
  await samples.getByRole('button',{name:'Choose folder…'}).click();
  await samples.getByText('Sampler fixtures',{exact:true}).waitFor();
  assert.equal(await page.evaluate(() => audit.directoryPicks), 1);
  const partA = page.locator('.ww-instrument-setup').getByRole('group',{name:'Part A',exact:true});
  for (const name of ['Pan','Chorus send','Delay send','Reverb send','Drive send']) {
    const field = partA.getByLabel(name,{exact:true});
    await field.fill('0');
    await field.press('Tab');
  }
  await page.waitForFunction(() => audit.frame.studioMixer[0].slice(1,6).every(value => value === 0));
  await page.locator('[data-workspace="daw"]').first().click();

  await button('Add audio track').click();
  await page.waitForFunction(() => audit.w?.selectedTrack()?.type === 'audio');
  await page.evaluate(async ref => {
    const {prepareSampler, setLiveSampler} = await import('./sampler.js');
    const w = audit.w;
    audit.instrument = await prepareSampler(w.player, audit.root, ref);
    await setLiveSampler(w.player, audit.instrument);
    w.controller.command('track.update',{id:w.selected,changes:{arm:true}});
    Object.assign(w.recorder.settings,{countIn:0,deviceId:'waswan:internal-synth',click:false});
    const {node,gain} = w.bridge.getAudio();
    audit.originalGain = gain.gain.value;
    gain.gain.value = 0;
    node.port.postMessage({t:'voice-mode',part:0,mode:0});
    node.port.postMessage({t:'dsp-control',action:'start',session:'sampler-chrome'});
  }, ref);
  await button('Record DAW').click();
  await page.waitForFunction(() => audit.w.recorder.state === 'recording');
  await page.evaluate(() => audit.node.port.postMessage({t:'midi',st:144,d1:60,d2:100}));
  await page.waitForFunction(() => audit.frame.polyphony.slots.some(v => v.active && v.note === 60));
  await page.waitForFunction(() => audit.frame.polyphony.slots.every(v => !v.active));
  await page.evaluate(() => audit.node.port.postMessage({t:'midi',st:128,d1:60,d2:0}));
  await button('Stop DAW').click();
  await page.waitForFunction(() => !audit.w.recorder.busy);
  const capture = waveform('internal-capture', await page.evaluate(async () => {
    const w = audit.w, clip = w.snapshot.clips.find(c => c.type === 'audio');
    if (!clip) throw Error(w.status.textContent);
    return audit.base64(w.controller.assets.get(clip.assetId));
  }));
  let firstFrame = 0;
  while (firstFrame < capture.length / 2 && Math.abs(capture[firstFrame * 2]) < 100) firstFrame++;
  assert(firstFrame > 0, 'internal capture should contain leading silence');
  const captured = checkStereo(capture, firstFrame + 2048, 60, 'internal capture');

  await page.evaluate(async loadRef => {
    const {prepareSampler, setLiveSampler} = await import('./sampler.js');
    const instrument = await prepareSampler(audit.w.player, audit.root, loadRef);
    await setLiveSampler(audit.w.player, instrument);
  }, loadRef);
  const sustainedLoad = [];
  for (const count of [12, 128]) {
    const session = `sampler-load-${count}`;
    await page.evaluate(({count,session}) => {
      audit.loadSession = session;
      audit.loadWindows = [];
      for (let pitch = 0; pitch < count; pitch++) audit.node.port.postMessage({t:'midi',st:144,d1:pitch,d2:100});
    }, {count,session});
    await page.waitForFunction(count => audit.frame.polyphony.slots.filter(v => v.gate).length === count * 2, count);
    const system = await browser.newBrowserCDPSession();
    const rendererCpu = async () => (await system.send('SystemInfo.getProcessInfo')).processInfo
      .filter(process => process.type === 'renderer').reduce((seconds, process) => seconds + process.cpuTime, 0);
    const cpuStart = await rendererCpu(), wallStart = performance.now();
    await page.evaluate(() => audit.node.port.postMessage({t:'dsp-control',action:'start',session:audit.loadSession}));
    await page.waitForFunction(() => audit.loadWindows.length >= 2);
    const elapsedMs = performance.now() - wallStart;
    const cpuSeconds = await rendererCpu() - cpuStart;
    await system.detach();
    const windows = await page.evaluate(() => {
      audit.node.port.postMessage({t:'dsp-control',action:'stop'});
      audit.node.port.postMessage({t:'panic'});
      return audit.loadWindows;
    });
    assert(windows.every(window => window.voices.gate === count * 2 && window.voices.capacity === 256));
    sustainedLoad.push({notes:count,rendererCpuSeconds:cpuSeconds,elapsedMs,
      windows:windows.map(window => ({measurement:window.measurement,voices:window.voices,...metrics(window.stats)}))});
    await page.waitForFunction(() => audit.frame.polyphony.slots.every(v => !v.active));
  }

  const saved = await page.evaluate(async notes => {
    const {emptyProject, makeTrack, uuid} = await import('./daw-project.js');
    const {projectBlob} = await import('./daw-format.js');
    const {setLiveSampler} = await import('./sampler.js');
    const w = audit.w;
    await setLiveSampler(w.player, null);
    w.bridge.getAudio().gain.gain.value = audit.originalGain;
    const project = emptyProject();
    project.name = 'Stereo sampler DAW round trip';
    project.length = 3840;
    project.transport = {loop:false,start:0,end:project.length};
    const track = makeTrack('midi', 'Stereo sampler'), control = makeTrack('audio', 'Silent control');
    track.monitor = 'in';
    project.tracks.push(track, control);
    project.clips.push({id:uuid(),trackId:track.id,type:'midi',name:'Root, fifth, octave',position:{unit:'ticks',value:0},
      length:project.length,loopLength:project.length,loop:false,
      notes:notes.map((pitch, index) => ({id:uuid(),pitch,velocity:100,start:480 + index * 960,duration:840}))});
    await w.adopt({project,assets:new Map(),dispose:async () => {},warnings:[]});
    w.controller.command('track.update',{id:track.id,changes:{instrument:audit.instrument}});
    w.controller.command('track.move',{id:track.id,index:1});
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('sampler-roundtrip.wsproj', {create:true});
    const writer = await handle.createWritable();
    await (await projectBlob(w.controller.snapshot(), new Map())).stream().pipeTo(writer);
    audit.node.port.postMessage({t:'dsp-control',action:'stop'});
    return {track:track.id,control:control.id};
  }, pitches);
  await page.waitForFunction(() => audit.dsp.at(-1)?.final);
  const capturePage = await page.evaluate(() => ({contexts:audit.contexts,hosts:audit.hosts,dsp:audit.dsp,workletErrors:audit.workletErrors}));
  await page.reload();
  await startSynth(page, {connect:true});
  await page.evaluate(async ({track,control}) => {
    const {DawWorkspace} = await import('./ui-daw.js');
    const adopt = DawWorkspace.prototype.adopt;
    DawWorkspace.prototype.adopt = function(...args) { audit.w = this; return adopt.apply(this, args); };
    Object.assign(audit,{track,control});
    audit.node.port.postMessage({t:'dsp-control',action:'start',session:'sampler-chrome'});
  }, saved);
  await clickDawFile(daw, 'Open DAW project');
  await page.waitForFunction(() => audit.w?.snapshot.tracks.some(t => t.id === audit.track));
  const instrument = await page.evaluate(() => audit.w.snapshot.tracks.find(t => t.id === audit.track).instrument);
  assert.equal(instrument.type, 'sampler');
  for (const field of ['libraryId','instrumentId','revision','path']) assert.equal(instrument[field], ref[field], field);

  await page.evaluate(async () => {
    const w = audit.w;
    await w.player.graph();
    const context = w.player.context;
    const splitter = context.createChannelSplitter(2);
    w.player.bus.connect(splitter);
    audit.mix = [0,1].map(channel => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      splitter.connect(analyser, channel);
      return analyser;
    });
    audit.synth = context.createAnalyser();
    audit.node.connect(audit.synth, 0);
  });
  async function hearDaw(pitch, name) {
    const heard = await page.waitForFunction(() => {
      const channels = audit.mix.map(analyser => {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        return samples;
      });
      if (!channels.every(samples => samples.subarray(0,1024).some(v => Math.abs(v) > .001))) return false;
      const synth = new Float32Array(audit.synth.fftSize);
      audit.synth.getFloatTimeDomainData(synth);
      return {synthSilent:synth.every(v => v === 0),pcm:Array.from({length:8192}, (_, index) => channels[index % 2][index >> 1] * 32768)};
    });
    const {pcm,synthSilent} = await heard.jsonValue();
    assert(synthSilent, `${name}: sampler also reached Synth output`);
    return checkStereo(pcm, 1024, pitch, name);
  }

  await button('Play DAW').click();
  await page.waitForFunction(() => audit.frame.polyphony.slots.some(v => v.active && v.sequenced && v.note === 60));
  const playback = await hearDaw(60, 'DAW playback');
  await button('Stop DAW').click();
  await page.waitForFunction(() => !audit.w.player.playing);

  await daw.getByRole('button',{name:'Select Stereo sampler',exact:true}).click();
  await button('Show Track inspector').click();
  await button('Enable DAW MIDI input').click();
  await page.waitForFunction(() => audit.w.monitor.ready && typeof audit.source.onmidimessage === 'function');
  await page.evaluate(() => audit.source.onmidimessage({data:[144,67,100],timeStamp:performance.now()}));
  await page.waitForFunction(() => audit.frame.polyphony.slots.some(v => v.active && v.monitorChannel === 0 && v.note === 67));
  const monitored = await hearDaw(67, 'DAW MIDI monitor');
  await page.evaluate(() => audit.source.onmidimessage({data:[128,67,0],timeStamp:performance.now()}));
  await button('Disable DAW MIDI input').click();
  await page.waitForFunction(() => !audit.w.monitor.token);

  async function render(scope, name, track) {
    const encoded = await page.evaluate(async ({scope,track}) => {
      audit.wav = null;
      await audit.w.audioExport.exporter.choose({scope,trackId:audit[track],format:'wav',tail:0});
      return audit.base64(audit.wav);
    }, {scope,track});
    return waveform(name, encoded);
  }

  const master = checkPhrase(await render('mix', 'sampler-master'), 'master');
  const stem = checkPhrase(await render('track', 'sampler-stem', 'track'), 'stem');
  for (let note = 0; note < pitches.length; note++) {
    for (let channel = 0; channel < 2; channel++) {
      const ratio = master[note][channel] / stem[note][channel];
      assert(Math.abs(ratio - 1) < .03, `Master/stem ratio ${ratio} for note ${pitches[note]} channel ${channel}`);
    }
  }
  assert((await render('track', 'silent-control', 'control')).every(v => v === 0), 'sampler leaked into control track');
  await page.evaluate(() => audit.w.controller.command('track.update',{id:audit.track,changes:{mute:true}}));
  assert((await render('mix', 'muted-master')).every(v => v === 0), 'muted sampler leaked into master');
  await page.evaluate(() => {
    audit.w.controller.command('track.update',{id:audit.track,changes:{mute:false}});
    audit.w.controller.command('track.update',{id:audit.control,changes:{solo:true}});
  });
  assert((await render('mix', 'solo-control')).every(v => v === 0), 'sampler leaked through control solo');
  await page.evaluate(() => audit.node.port.postMessage({t:'dsp-control',action:'stop'}));
  await page.waitForFunction(() => audit.dsp.at(-1)?.final);
  // DSP statistics and the polyphony panel publish on independent clocks.
  // Observe the settled voice frame after the final export releases its notes.
  await page.waitForFunction(() => audit.frame.polyphony.slots.every(voice => !voice.active), null, {timeout:5000})
    .catch(async error => {
      const active = await page.evaluate(() => audit.frame.polyphony.slots.filter(voice => voice.active));
      throw Error('Active voices after export: '+JSON.stringify(active),{cause:error});
    });
  const observed = await page.evaluate(() => ({contexts:audit.contexts,hosts:audit.hosts,
    directoryPicks:audit.directoryPicks,workletErrors:audit.workletErrors,dsp:audit.dsp,
    voices:audit.frame.polyphony.slots.filter(v => v.active).length}));
  assert.equal(capturePage.contexts, 1);
  assert.equal(capturePage.hosts, 1);
  assert.equal(observed.contexts, 1);
  assert.equal(observed.hosts, 1);
  assert.equal(observed.directoryPicks, 0);
  assert.equal(observed.voices, 0);
  assert.deepEqual([...errors,...capturePage.workletErrors,...observed.workletErrors], []);
  for (const observation of [capturePage, observed]) {
    observation.dsp = observation.dsp.map(window => ({measurement:window.measurement,voices:window.voices,...metrics(window.stats)}));
  }
  const report = {result:'PASS',chrome:await browser.version(),ref,captured,master,stem,playback,monitored,sustainedLoad,
    routingSilence:{control:true,mute:true,solo:true},directoryHandle:'OPFS',coldProjectReopen:true,hardware:false,capturePage,...observed};
  fs.writeFileSync(`${evidence}/browser.json`, JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,sustainedLoad:sustainedLoad.map(run => ({...run,windows:run.windows.length})),
    capturePage:{...capturePage,dsp:capturePage.dsp.length},dsp:observed.dsp.length}));
} finally {
  await browser.close();
}
