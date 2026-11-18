// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../.tools/browser/node_modules/playwright/index.mjs';
import {clickDawFile} from './daw-browser-controls.mjs';
import {readProject as readStudio} from '../web/studio-format.js';

const evidence='.local/validation/ux-stage-6';
fs.mkdirSync(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
const errors=[];
try{
  const context=await browser.newContext({viewport:{width:1920,height:1080},acceptDownloads:true});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.addInitScript(()=>{
    window.audit={contexts:0};
    const Audio=window.AudioContext;
    window.AudioContext=class extends Audio{constructor(...args){super(...args);audit.contexts++;}};
  });
  const host=await context.newPage();
  await host.goto('http://localhost:8737/simulator/?workspace=daw');
  await host.evaluate(async()=>{
    const {DawMix}=await import('./ui-daw-mix.js'),refresh=DawMix.prototype.refresh;
    DawMix.prototype.refresh=function(...args){audit.daw=this.w;return refresh.apply(this,args);};
    const {StudioWorkspace}=await import('./ui-studio.js'),draw=StudioWorkspace.prototype.draw;
    StudioWorkspace.prototype.draw=function(...args){audit.studio=this.recorder;return draw.apply(this,args);};
    const {emptySequence}=await import('./studio-sequence.js');
    const {projectBlob,wavHeader}=await import('./studio-format.js');
    const sequence=emptySequence(120);
    sequence.notes=[{id:'source-note',part:0,note:64,velocity:85,start:0,duration:960}];
    sequence.expression=[{tick:16,data:[224,0,72]}];
    sequence.automation=[
      {id:'source-volume',target:'part:0:level',enabled:true,curve:'step',points:[{tick:0,value:50}]},
      {id:'source-cutoff',target:'part:0:cutoff',enabled:true,curve:'linear',points:[{tick:960,value:60}]}
    ];
    const session=await(await fetch('./factory-session.bin')).arrayBuffer();
    const parts=Array.from({length:4},()=>({program:1,engine:0,parameters:Array(63).fill(0),patch:Array(80).fill(0)}));
    const state={version:1,tempo:120,master:724,parts,session:btoa(Array.from(new Uint8Array(session),n=>String.fromCharCode(n)).join(''))};
    const project={format:'waswan-studio-project',version:1,name:'Studio source',frames:0,status:'complete',sampleRate:44100,channels:2,context:state,sequence,events:[]};
    const root=await navigator.storage.getDirectory();
    audit.original=await root.getFileHandle('studio-original.wsproj',{create:true});
    audit.originalBytes=projectBlob(project,new Blob([wavHeader(0)]));
    const writer=await audit.original.createWritable();await writer.write(audit.originalBytes);await writer.close();
    audit.copy=await root.getFileHandle('editable-daw.wsproj',{create:true});
    window.showOpenFilePicker=async()=>[audit.original];
    window.showSaveFilePicker=async()=>audit.copy;
  });

  const daw=host.locator('.ww-daw');
  const choose=(page,name)=>page.getByRole('dialog',{name:'Open Studio project'}).getByRole('button',{name,exact:true}).click();
  host.on('dialog',dialog=>void dialog.accept());
  await host.getByRole('button',{name:'Start audio',exact:true}).click();
  await host.locator('.ww-midi-setup .ww-midi-continue').click();
  await host.waitForFunction(()=>audit.daw);
  const projectId=await host.evaluate(()=>audit.daw.snapshot.id);
  await clickDawFile(daw,'Open DAW project');
  await host.getByRole('dialog',{name:'Open Studio project'}).waitFor();
  await host.screenshot({path:`${evidence}/studio-open-options.png`});
  await choose(host,'Cancel');
  await host.waitForFunction(()=>!audit.daw.busy);
  assert.equal(await host.evaluate(()=>audit.daw.snapshot.id),projectId);

  await clickDawFile(daw,'Open DAW project');
  await choose(host,'Open editable DAW copy');
  await host.waitForFunction(()=>!audit.daw.busy&&audit.daw.snapshot.name==='Studio source');
  assert(await host.evaluate(()=>audit.daw.controller.dirty));
  assert.deepEqual(await host.evaluate(()=>audit.daw.snapshot.automation.map(lane=>[lane.target,lane.points[0].value])),[['volume',.25]]);
  assert.equal(await host.evaluate(()=>audit.daw.snapshot.clips[0].notes[0].pitch),64);
  await clickDawFile(daw,'Studio playback compatibility');
  const compatibility=host.getByRole('dialog',{name:'Studio playback compatibility'});
  assert.match(await compatibility.innerText(),/1 automation lane.*source data/);
  assert.match(await compatibility.innerText(),/At Stop, DAW restores the base faders/);
  await compatibility.getByRole('button',{name:'Close',exact:true}).click();
  await host.evaluate(()=>{window.showSaveFilePicker=async()=>audit.original;});
  await clickDawFile(daw,'Save DAW project');
  await host.waitForFunction(()=>!audit.daw.busy&&audit.daw.status.textContent.includes('Choose a new file to keep the Studio original'));
  await host.evaluate(()=>{window.showSaveFilePicker=async()=>audit.copy;});
  await clickDawFile(daw,'Save DAW project');
  await host.waitForFunction(()=>!audit.daw.busy&&audit.daw.files.handle?.name==='editable-daw.wsproj');
  assert(await host.evaluate(async()=>await audit.originalBytes.text()===await(await audit.original.getFile()).text()));
  assert(await host.evaluate(async()=>{
    const {readProject}=await import('./daw-format.js');
    return (await readProject(await audit.copy.getFile())).project.legacy.studio.sequence.expression[0].tick===16;
  }));

  const popup=host.waitForEvent('popup');
  await host.getByRole('button',{name:'Open DAW in new tab',exact:true}).click();
  const tab=await popup,linked=tab.locator('.ww-daw');
  await linked.waitFor();
  await tab.evaluate(async()=>{
    const original=await(await navigator.storage.getDirectory()).getFileHandle('studio-original.wsproj');
    window.showOpenFilePicker=async()=>[original];
  });
  const savedDaw=await host.evaluate(()=>JSON.stringify(audit.daw.snapshot));
  await clickDawFile(linked,'Open DAW project');
  await choose(tab,'Open Studio original');
  await host.locator('.ww-sequence').getByRole('heading',{name:'Original Studio composition'}).waitFor();
  assert.equal(await host.evaluate(()=>JSON.stringify(audit.daw.snapshot)),savedDaw);
  assert.deepEqual(await host.evaluate(()=>{
    const {notes,automation,expression}=audit.studio.take.project.sequence;
    return {notes:notes.map(n=>n.id),lanes:automation.map(l=>l.id),expression:expression[0].tick,contexts:audit.contexts};
  }),
    {notes:['source-note'],lanes:['source-volume','source-cutoff'],expression:16,contexts:1});
  assert(await linked.isVisible());
  assert.equal(await tab.evaluate(()=>audit.contexts),0);
  await host.getByRole('button',{name:'Quick capture',exact:true}).click();
  const quick=host.locator('.ww-studio');
  const saveStudio=async()=>{
    const download=host.waitForEvent('download');
    await quick.getByRole('button',{name:'Save project',exact:true}).click();
    return readStudio(new Blob([fs.readFileSync(await(await download).path())]));
  };
  const firstSave=await saveStudio();
  assert.equal(firstSave.project.sequenceContext.parts[0].program,1);
  assert.equal(firstSave.project.sequenceContext.master,724);
  const automationOnly=new Uint8Array(await host.evaluate(async()=>{
    const {readProject,projectBlob,wavHeader}=await import('./studio-format.js');
    const {project,audio}=await readProject(audit.originalBytes);
    project.version=2;
    project.sequence.bpm=137;
    project.sequence.notes=[];
    project.sequenceContext={...project.context,master:531};
    const source=new Blob([wavHeader(8),new Uint8Array(32).fill(5)]);
    const meta={id:'unused-audio',name:'Unused audio',frames:8,bytes:source.size};
    project.assets=[meta];
    return Array.from(new Uint8Array(await projectBlob(project,audio,[{meta,audio:source}]).arrayBuffer()));
  }));
  await quick.getByLabel('Open Studio project').setInputFiles({name:'automation-only.wsproj',mimeType:'application/octet-stream',buffer:Buffer.from(automationOnly)});
  await host.waitForFunction(()=>audit.studio.take?.project.sequence?.bpm===137);
  await quick.getByRole('button',{name:'Record take',exact:true}).click();
  await host.waitForFunction(()=>audit.studio.state==='recording'&&audit.studio.frames>0);
  await quick.getByRole('button',{name:'Stop recording',exact:true}).click();
  await host.waitForFunction(()=>audit.studio.state==='ready');
  const recorded=await saveStudio();
  const original=await readStudio(new Blob([automationOnly]));
  assert(recorded.project.frames>0);
  assert.deepEqual(recorded.project.sequence,original.project.sequence);
  assert.deepEqual(recorded.project.sequenceContext,original.project.sequenceContext);
  assert.deepEqual(await recorded.assets[0].audio.arrayBuffer(),await original.assets[0].audio.arrayBuffer());
  assert.deepEqual(errors,[]);
  console.log('PASS Studio archive: cancel, editable copy, separate save, unchanged original and linked project, one audio host, saved tones, automation-only composition and unused source preserved');
}finally{await browser.close();}
