// SPDX-License-Identifier: GPL-3.0-only
import {RATE,PPQ,LIMITS,uuid,makeTrack} from './daw-project.js';
import {readSmf} from './daw-smf.js';
import {extendProject} from './daw-clip-edit.js';
import {wavHeader} from './studio-format.js';
import {ImmutableAudioStore} from './daw-assets.js';
export class DawImporter {
  constructor(workspace){this.w=workspace;this.busy=false;}
  cancel(){this.cancelled=true;this.w.status.textContent='Import cancelled; waiting for decoder/storage to release resources';this.cancelWorker?.();this.cancelProbe?.();}
  async choose(){const [handle]=await showOpenFilePicker({multiple:false,types:[{description:'Audio or MIDI',accept:{'audio/*':['.wav','.mp3','.mid','.midi']}}]});return this.import(await handle.getFile());}
  async import(file,{atBeat=this.w.cursor*this.w.snapshot.bpm/(RATE*60),trackId=this.w.selected}={}){
    if(this.busy||this.w.player.playing||this.w.recorder.busy)throw Error('Stop playback and recording before import');this.busy=true;this.cancelled=false;this.w.refreshControls();const controller=this.w.controller,project=controller.snapshot(),revision=controller.revision;let store;
    try{
      if(!(file instanceof Blob)||!file.size||file.size>256*1024*1024)throw Error('Import file limit: 256 MiB');if(!Number.isFinite(atBeat)||atBeat<0)throw Error('Choose a valid import position');this.w.status.textContent='Reading '+(file.name||'media');const extension=(file.name||'').split('.').at(-1).toLowerCase();let commands,assets=new Map(),selected,warnings=[];
      if(['mid','midi'].includes(extension)){const result=readSmf(await file.arrayBuffer(),{bpm:project.bpm,atTick:Math.round(atBeat*PPQ),name:(file.name||'Imported MIDI').slice(0,60)});if(project.tracks.length+result.tracks.length>LIMITS.tracks)throw Error('Not enough track capacity for MIDI track/channel structure');commands=[...result.tracks.map(payload=>({type:'track.create',payload})),...result.clips.map(payload=>({type:'clip.add',payload}))];selected=result.clips[0];warnings=result.warnings;}
      else{
        if(!['wav','mp3'].includes(extension))throw Error('Choose a WAV, MP3 or Standard MIDI File');const existing=project.tracks.find(t=>t.id===trackId),track=existing?.type==='audio'?existing:makeTrack('audio',(file.name||'Audio').slice(0,80));if(track!==existing&&project.tracks.length>=32)throw Error('Track budget reached');if(project.assets.length>=32)throw Error('Audio source budget reached');
        const framesInFile=(file.size-44)/4,header=new Uint8Array(await file.slice(0,44).arrayBuffer()),expected=Number.isSafeInteger(framesInFile)&&framesInFile>0&&framesInFile<=LIMITS.sourceFrames?new Uint8Array(wavHeader(framesInFile)):null,canonical=expected&&header.length===44&&header.every((v,i)=>v===expected[i]);
        const available=LIMITS.totalFrames-project.assets.reduce((n,a)=>n+a.frames,0);let decoded,frames;
        if(canonical)frames=framesInFile;else{if(extension==='wav')await this.inspectWave(file);const duration=await this.probe(file);if(duration*RATE>Math.min(LIMITS.sourceFrames,available)+RATE)throw Error('Audio duration exceeds the project budget');this.w.status.textContent='Decoding '+file.name+' · cancelling preserves the project';let context=this.w.bridge.getAudio().context;context??=new OfflineAudioContext(2,1,RATE);decoded=await context.decodeAudioData(await file.arrayBuffer());if(decoded.numberOfChannels<1||decoded.numberOfChannels>2)throw Error('Audio import supports mono or stereo; choose a mono/stereo source');if(decoded.sampleRate!==RATE)throw Error('Audio decoder did not produce 44.1 kHz');frames=decoded.length;}
        if(this.cancelled)throw new DOMException('Import cancelled','AbortError');if(frames<1||frames>LIMITS.sourceFrames||frames>available)throw Error('Decoded audio exceeds the 20-minute source / 30-minute project budget');
        const id=uuid();
        store=await ImmutableAudioStore.create();
        this.w.status.textContent='Converting '+file.name+' to project audio';
        let blob;
        if(canonical)blob=await store.copy(file);
        else{
          const left=decoded.getChannelData(0),right=decoded.numberOfChannels===1?left.slice():decoded.getChannelData(1);
          await this.write({dir:store.dir,left,right});
          blob=await(await store.dir.getFileHandle('audio.wav')).getFile();
        }
        if(this.cancelled)throw new DOMException('Import cancelled','AbortError');
        const meta={id,name:(file.name||'Imported audio').slice(0,120),sampleRate:RATE,channels:2,frames,bytes:blob.size};assets.set(id,blob);selected={id:uuid(),type:'audio',trackId:track.id,name:meta.name,assetId:id,position:{unit:'seconds',value:atBeat*60/project.bpm},offset:0,frames:meta.frames,gain:1,pan:0,fadeIn:0,fadeOut:0};commands=[...(track!==existing?[{type:'track.create',payload:track}]:[]),{type:'asset.add',payload:meta},{type:'clip.add',payload:selected}];
      }
      if(this.cancelled)throw new DOMException('Import cancelled','AbortError');if(controller!==this.w.controller||controller.revision!==revision)throw Error('Project changed during import; no clips were inserted');commands=extendProject(project,commands);
      // Unassigned SMF instruments intentionally remain unassigned, so validate
      // the domain without trying to render those notes yet.
      controller.transaction(commands,assets);
      if(store){const retained=store;this.w.assetRetention.hold(assets,()=>retained.dispose());store=null;}
      this.w.selected=selected.trackId;this.w.selectedClip=selected.id;this.w.refresh();this.w.status.textContent='Imported '+file.name+(warnings.length?' · '+warnings.join(' · '):'');return selected;
    }catch(error){await store?.dispose().catch(()=>{});throw error;}
    finally{this.busy=false;this.worker=null;this.w.refreshControls();this.w.assetRetention.schedule();}
  }
  async inspectWave(file){const prefix=new Uint8Array(await file.slice(0,12).arrayBuffer()),tag=(a,at)=>String.fromCharCode(...a.subarray(at,at+4));if(!['RIFF','RF64'].includes(tag(prefix,0))||tag(prefix,8)!=='WAVE')throw Error('Choose a RIFF/RF64 WAV file');let at=12;for(let chunks=0;chunks<4096&&at+8<=file.size;chunks++){const bytes=new Uint8Array(await file.slice(at,at+8).arrayBuffer()),size=new DataView(bytes.buffer).getUint32(4,true);if(tag(bytes,0)==='fmt '){if(size<16||at+8+size>file.size)throw Error('Invalid WAV format chunk');const fmt=new DataView(await file.slice(at+8,at+24).arrayBuffer()),channels=fmt.getUint16(2,true);if(channels<1||channels>2)throw Error('Audio import supports mono or stereo; choose a mono/stereo WAV');return;}if(at+8+size>file.size)throw Error('Truncated WAV chunk');at+=8+size+(size&1);}throw Error('WAV format chunk could not be found');}
  probe(file){return new Promise((resolve,reject)=>{const audio=new Audio(),url=URL.createObjectURL(file);let closed=false;const done=(error)=>{if(closed)return;closed=true;clearTimeout(timer);audio.onloadedmetadata=audio.onerror=null;audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);this.cancelProbe=null;error?reject(error):resolve(duration);};let duration;const timer=setTimeout(()=>done(Error('Audio metadata could not be read')),10000);this.cancelProbe=()=>done(new DOMException('Import cancelled','AbortError'));audio.preload='metadata';audio.onloadedmetadata=()=>{duration=audio.duration;done(Number.isFinite(duration)&&duration>0?null:Error('Cannot determine this audio file duration'));};audio.onerror=()=>done(Error('Chrome cannot decode this audio file'));audio.src=url;});}
  write(data){return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./daw-import-worker.js',import.meta.url),{type:'module'});this.worker=worker;const finish=()=>{clearTimeout(timer);worker.terminate();this.cancelWorker=null;},timer=setTimeout(()=>{finish();reject(Error('Audio conversion timed out'));},60000);this.cancelWorker=()=>{finish();reject(new DOMException('Import cancelled','AbortError'));};worker.onmessage=({data:m})=>{if(m.t==='progress')this.w.status.textContent='Converting audio · '+Math.round(m.value*100)+'%';if(m.t==='done'){finish();resolve();}if(m.t==='error'){finish();reject(Error(m.message));}};worker.onerror=()=>{finish();reject(Error('Audio import worker failed'));};worker.postMessage(data,[data.left.buffer,data.right.buffer]);});}
}
