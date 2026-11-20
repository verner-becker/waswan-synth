// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function renderBuilderPhrase(page) {
  const evidence='.local/validation/sampler-ux-3';
  await mkdir(evidence,{recursive:true});
  const rendered=await page.evaluate(async()=>{
    const w=window.audit.workspace;
    const track=w.selectedTrack();
    if(track?.instrument?.type!=='sampler')throw Error('The selected track needs the published sampler map.');
    const {PPQ,uuid}=await import('./daw-project.js');
    const length=4*PPQ;
    const notes=[60,60,72,72].map((pitch,i)=>({id:uuid(),pitch,velocity:i%2?100:35,start:i*PPQ+96,duration:PPQ/2}));
    w.controller.command('clip.add',{id:uuid(),type:'midi',trackId:track.id,name:'Builder acceptance phrase',
      position:{unit:'ticks',value:0},length,loopLength:length,loop:false,notes});
    w.controller.command('project.update',{length,transport:{start:0,end:length,loop:false}});
    const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('builder-exports',{create:true});
    const originalPicker=window.showSaveFilePicker;
    window.showSaveFilePicker=async({suggestedName})=>root.getFileHandle(suggestedName,{create:true});
    async function record(scope) {
      const {name}=await w.audioExport.exporter.choose({scope,trackId:track.id,format:'wav',tail:0});
      const wav=await (await root.getFileHandle(name)).getFile();
      return new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);
        reader.onerror=()=>reject(reader.error);reader.readAsDataURL(wav);
      });
    }
    try {
      const master=await record('mix'),stem=await record('track');
      w.controller.command('track.update',{id:track.id,changes:{mute:true}});
      try {return {master,stem,muted:await record('mix'),bpm:w.snapshot.bpm};}
      finally {w.controller.command('track.update',{id:track.id,changes:{mute:track.mute}});}
    } finally {window.showSaveFilePicker=originalPicker;}
  });
  const levels={};
  for(const key of ['master','stem','muted']){
    const wav=Buffer.from(rendered[key],'base64');
    assert.equal(wav.toString('ascii',0,4),'RIFF');
    assert.equal(wav.readUInt16LE(22),2);
    const rate=wav.readUInt32LE(24),beat=rate*60/rendered.bpm;
    const peaks=[0,0,0,0];
    let max=0;
    for(let i=44;i<wav.length;i+=4){
      const peak=Math.max(Math.abs(wav.readInt16LE(i)),Math.abs(wav.readInt16LE(i+2)));
      max=Math.max(max,peak);
      const pos=(i-44)/(4*beat),index=Math.floor(pos);
      if(index<4&&pos-index>.1&&pos-index<.58)peaks[index]=Math.max(peaks[index],peak);
    }
    if(key==='muted')assert.equal(max,0,'Muted sampler track leaked to the master');
    else {
      assert(peaks.every(p=>p>20),'A note in the exported phrase was silent: '+peaks);
      const hz=[0,1,2,3].map(i=>{
        const start=Math.ceil((i+.15)*beat),end=Math.floor((i+.50)*beat);
        let crossings=0;
        for(let frame=start;frame<end;frame++) {
          const offset=44+frame*4;
          if(wav.readInt16LE(offset-4)<=0 && wav.readInt16LE(offset)>0)crossings++;
        }
        return Math.round(rate*crossings/(end-start));
      });
      hz.forEach((tone,i)=>assert(Math.abs(tone-[220,330,440,660][i])<7,'Published layer mismatch: '+hz));
      levels[key+'Hz']=hz;
      await writeFile(join(evidence,key+'.wav'),wav);
    }
    levels[key]=peaks;
  }
  for(let i=0;i<4;i++)assert(Math.abs(levels.master[i]/levels.stem[i]-1)<.15,'Master and stem differ on note '+i);
  await writeFile(join(evidence,'phrase.json'),JSON.stringify(levels,null,2));
  console.log('PASS published visual instrument in DAW master and stem',levels);
}
