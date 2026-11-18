// SPDX-License-Identifier: GPL-3.0-only
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=process.env.DAW_VALIDATION_ROOT||'.local/validation/ux-stage-5';
fs.mkdirSync(root,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1920,height:937}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.addInitScript(()=>{
    window.audit={contexts:0,commands:[]};
    const AC=AudioContext,AWN=AudioWorkletNode;
    window.AudioContext=class extends AC{constructor(...args){super(...args);audit.contexts++;}};
    window.AudioWorkletNode=class extends AWN{constructor(...args){
      super(...args);
      if(args[1]!=='obervave-smk37')return;
      audit.node=this;
      const post=this.port.postMessage.bind(this.port);
      this.port.postMessage=(message,...rest)=>{audit.commands.push(message);return post(message,...rest);};
      this.port.addEventListener('message',({data})=>{if(data.t==='frame')audit.frame=data;});
    }};
  });
  const port=message=>page.evaluate(message=>audit.node.port.postMessage(message),message);
  await page.goto('http://localhost:8737/simulator/?legacy=1');
  const button=name=>page.getByRole('button',{name,exact:true});
  const setup=page.locator('.ww-instrument-setup');
  const field=name=>setup.getByLabel(name,{exact:true});
  const group=name=>setup.locator('summary').and(setup.getByText(name,{exact:true}));
  const set=async(name,value)=>{await field(name).fill(String(value));await field(name).press('Tab');};

  await button('Start audio').click();
  assert.equal(await page.locator('.instrument,.ww-legacy-toggle,#screen').count(),0);
  await page.locator('.ww-midi-setup .ww-midi-continue').click();
  await page.waitForFunction(()=>audit.frame?.setup?.settings?.length===16);
  await port({t:'midi',st:144,d1:65,d2:90});
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.note===65&&v.gate));
  await page.evaluate(()=>{audit.commands=[];});
  await button('Instrument setup').click();
  await page.waitForFunction(()=>audit.frame.polyphony.slots.some(v=>v.note===65&&v.gate));
  assert(!await page.evaluate(()=>audit.commands.some(m=>['midi','panic','key','btn','enc'].includes(m.t))));
  await port({t:'midi',st:128,d1:65,d2:0});

  await field('Active part').selectOption('1');
  await page.waitForFunction(()=>audit.frame.track===1);
  const partB=setup.getByRole('group',{name:'Part B',exact:true});
  for(const [index,name] of ['Chorus send','Delay send','Reverb send','Drive send'].entries()){
    const input=partB.getByLabel(name,{exact:true});
    await input.fill(String(41+index));await input.press('Tab');
  }
  await page.waitForFunction(()=>audit.frame.studioMixer[1].slice(2,6).join()==='41,42,43,44');

  await group('Globals and hardware faders').click();
  await set('Instrument tempo (BPM)',112);
  await field('Fader response').selectOption('1');
  await field('Instrument click').selectOption('2');
  await button('Switch hardware fader bank · A').click();
  await page.waitForFunction(()=>audit.frame.setup.settings[0]===112&&audit.frame.setup.settings[1]===2&&audit.frame.setup.settings[5]&&audit.frame.leds&2);
  await group('Globals and hardware faders').click();

  await group('Patterns, favorites and instrument sequencer').click();
  await button('Save selected part to favorite').click();
  await page.waitForFunction(()=>audit.frame.used&1);
  await button('Load favorite').click();
  await page.waitForFunction(()=>audit.frame.favourite===1);
  await field('Pattern slot').selectOption('15');
  await button('Save pattern to slot').click();
  await page.waitForFunction(()=>audit.frame.patternsUsed>>15&1);
  await button('Load pattern').click();
  await page.waitForFunction(()=>audit.frame.pattern===16&&!audit.frame.patternPending);
  await group('Instrument sequencer').click();
  await field('Pad bank').selectOption('1');
  await page.waitForFunction(()=>audit.frame.bank===1&&audit.frame.setup.sequence);
  await field('Sequencer view').selectOption('1');
  await page.waitForFunction(()=>audit.frame.setup.sequence.view===1);
  assert(await setup.locator('.ww-native-parameter:not([hidden])').count());
  await button('Play / stop instrument pattern').click();
  await page.waitForFunction(()=>audit.frame.instrument.playing);
  await button('Play / stop instrument pattern').click();
  await page.waitForFunction(()=>!audit.frame.instrument.playing);
  await button('Record instrument pattern').click();
  await page.waitForFunction(()=>audit.frame.setup.sequence.record);
  await button('Record instrument pattern').click();
  await page.waitForFunction(()=>!audit.frame.setup.sequence.record);
  await field('Pad bank').selectOption('0');
  await page.waitForFunction(()=>audit.frame.bank===0);
  await group('Patterns, favorites and instrument sequencer').click();

  await group('Split / Layer').click();
  await field('Keyboard configuration').selectOption('1');
  await field('Mode').selectOption('2');
  await set('First level %',71);
  await button('Apply keyboard configuration').click();
  await page.waitForFunction(()=>audit.frame.setup.keyboard[1][0]===2&&audit.frame.setup.keyboard[1][4]===71);
  await button('Play this keyboard row').click();
  await page.waitForFunction(()=>audit.frame.keyboardRow===1&&audit.frame.keyboardActive);
  await group('Split / Layer').click();

  await page.locator('[data-workspace="tones"]').click();
  await page.locator('.ww-tone-editor [data-param="0"] select').selectOption({value:'4'});
  await page.waitForFunction(()=>audit.frame.setup.super[0]<128);
  await page.locator('[data-workspace="perf"]').click();
  await button('Instrument setup').click();
  await group('DRUM-X and SUPER oscillator').click();
  await set('SUPER mix',79);
  await page.waitForFunction(()=>audit.frame.setup.super[1]===79);
  await field('Engine').selectOption('1');
  await page.waitForFunction(()=>audit.frame.engines[audit.frame.track]===2);
  await field('Drum kit').selectOption('1');
  await page.waitForFunction(()=>audit.frame.setup.drum?.kit===1);
  await set('Sound pitch (semitones)',2);
  await page.waitForFunction(()=>audit.frame.setup.drum.sounds[0][2]===66);
  await button('Use drum pads').click();
  await page.waitForFunction(()=>audit.frame.bank===4);
  await page.locator('#pads [data-pad="0"]').press('Enter');
  assert(await page.evaluate(()=>audit.commands.some(m=>m.t==='pad'&&m.p===0&&m.v>0)));
  await field('Preset name').fill('KIT TEST');
  await set('Preset program',99);
  await button('Save drum preset').click();
  await page.waitForFunction(()=>audit.frame.programs[audit.frame.track]===99&&audit.frame.presetSave===3);
  await group('DRUM-X and SUPER oscillator').click();

  await group('Native MIDI controller mode').click();
  await button('Enter MIDI controller mode').click();
  await page.waitForFunction(()=>audit.frame.midiMode&&audit.frame.setup.controller);
  await field('Main channel').selectOption({value:'3'});
  await page.waitForFunction(()=>audit.frame.setup.controller.settings[0]===4);
  await field('Map control').selectOption('0');
  await field('Message type').selectOption('1');
  await set('Note / CC number',23);
  await button('Apply MIDI map entry').click();
  await page.waitForFunction(()=>audit.frame.setup.controller.entries[0][2]===23);
  await button('Save MIDI map').click();
  await page.waitForFunction(()=>!audit.frame.setup.controller.settings[2]);
  await button('Return to Synth').click();
  await page.waitForFunction(()=>!audit.frame.midiMode);
  assert.equal(await page.evaluate(()=>audit.contexts),1);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`${root}/instrument-setup.png`,fullPage:true});
  const report={result:'PASS',oneContext:true,notesAcrossNavigation:true,mixer:true,globals:true,faderModeAndBank:true,
    patternsAndFavorites:true,instrumentSequencer:true,splitLayer:true,superMix:true,drumKitPadsAndPreset:true,nativeControllerMap:true,physicalValidation:false,errors};
  fs.writeFileSync(`${root}/browser-instrument-setup.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{await browser.close();}
