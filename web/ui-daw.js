// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {ProjectController} from './daw-controller.js';
import {ProjectFiles,RecoveryAutosave} from './daw-files.js';
import {emptyProject,makeTrack,uuid,PPQ,RATE,validateProject} from './daw-project.js';
import {DawPlayer} from './daw-player.js';
import {DawArrangement} from './ui-daw-arrangement.js';
import {DawMonitor} from './daw-monitor.js';
import {saveMidi} from './daw-midi-export.js';
import {DawMix} from './ui-daw-mix.js';
import {DawEditors} from './ui-daw-editors.js';
import {DawAudition} from './daw-audition.js';
import {DawClipTools} from './ui-daw-clip-tools.js';
import {DawImporter} from './daw-import.js';
import {DawRecorder} from './daw-recording.js';
import {beatFrame,frameBeat,arrangementBeats,musicalPosition,secondsPosition} from './daw-arrangement.js';
const patchName=patch=>patch?String.fromCharCode(...patch.slice(63,73)).replace(/[^\x20-\x7e]/g,'').trim()||'Saved sound':'Choose an instrument';
const db=value=>value>0?(20*Math.log10(value)).toFixed(1)+' dB':'−∞ dB';
export class DawWorkspace {
  constructor(bridge,{toggleKeyboard=()=>false}={}){
    this.bridge=bridge;this.files=new ProjectFiles();this.rows=new Map();this.programs=[];this.busy=false;this.running=false;this.selected=null;this.cursor=0;
    this.player=new DawPlayer(bridge,state=>this.transportState(state));
    this.node=Panel('DAW','Project playback · independent instruments · local files');this.node.classList.add('ww-daw');
    this.status=el('p','ww-daw-status','Start audio, add an instrument track and enter notes.');this.status.setAttribute('role','status');
    this.toolbar=el('div','ww-studio-actions');
    const button=(name,task)=>action(name,()=>this.run(task));
    this.newButton=button('New DAW project',async()=>{if(!this.confirmDiscard())return;await this.adopt({project:emptyProject(),assets:new Map(),dispose:async()=>{},warnings:[]});this.files.forget();this.refresh();});
    this.openButton=button('Open DAW project',async()=>{const loaded=await this.files.open({accept:()=>this.confirmDiscard(),deferBinding:true});if(loaded){try{await this.adopt(loaded);if(loaded.warnings.length)this.files.forget();else this.files.adoptBinding(loaded.binding);this.refresh();}catch(error){await loaded.dispose();throw error;}}});
    this.saveButton=button('Save DAW project',async()=>{await this.player.capture(this.controller);await this.files.save(this.controller);this.refresh();this.status.textContent='Project saved to '+this.files.handle.name;});
    this.saveAsButton=button('Save DAW project as',async()=>{await this.player.capture(this.controller);await this.files.save(this.controller,{saveAs:true});this.refresh();this.status.textContent='Project saved to '+this.files.handle.name;});
    this.undo=button('Undo DAW edit',()=>this.controller.command('undo'));this.redo=button('Redo DAW edit',()=>this.controller.command('redo'));
    this.recoverButton=button('Recover DAW copy',()=>this.showRecovery());
    this.toolbar.append(this.newButton,this.openButton,this.saveButton,this.saveAsButton,this.undo,this.redo,this.recoverButton);
    const transport=el('div','ww-daw-transport');this.play=button('Play DAW',()=>this.playProject());this.play.classList.add('ww-primary');
    this.stop=action('Stop DAW',()=>{void (this.audition?.busy?this.audition.release():this.recorder?.busy?this.recorder.stop():this.player.stop()).catch(error=>this.error(error));});this.position=el('output','ww-daw-position','1.1');
    this.name=this.field('DAW project name','text','Untitled',transport);this.name.onchange=()=>this.edit('project.update',{name:this.name.value});
    this.tempo=this.field('DAW tempo','number',120,transport);Object.assign(this.tempo,{min:40,max:240,step:.1});this.tempo.onchange=()=>this.edit('project.update',{bpm:Number(this.tempo.value)});
    this.length=this.field('DAW length in beats','number',16,transport);Object.assign(this.length,{min:1,max:8192,step:1});this.length.onchange=()=>{const length=Math.round(Number(this.length.value)*PPQ),t=this.snapshot.transport;this.edit('project.update',{length,...(t?.end===this.snapshot.length?{transport:{...t,start:t.start<length?t.start:0,end:length}}:{})});};
    this.dirty=el('span','ww-chip','New project');this.recoveryStatus=el('span','ww-muted','Recovery updates after edits');
    transport.prepend(this.play,this.stop,this.position);transport.append(this.dirty,this.recoveryStatus);
    const trackTools=el('div','ww-studio-actions');this.addMidi=button('Add MIDI track',async()=>{
      const t=makeTrack('midi','Instrument '+(this.controller.snapshot().tracks.filter(t=>t.type==='midi').length+1));if(this.running){const sound=await this.player.currentTone(this.frame?.track||0);t.instrument={type:sound.type,patch:sound.patch};}
      this.controller.command('track.create',t);this.selected=t.id;this.refresh();
    });
    this.keyboard=action('Show Synth keyboard',()=>{const visible=toggleKeyboard();this.keyboard.textContent=visible?'Hide Synth keyboard':'Show Synth keyboard';});trackTools.append(this.addMidi,this.keyboard);
    this.trackScroll=el('div','ww-daw-track-scroll');this.trackList=el('div','ww-daw-tracks');this.trackScroll.append(this.trackList);
    this.empty=el('p','ww-muted','No tracks yet. Add a MIDI track, choose a sound, then add notes below.');
    const editor=Panel('MIDI clip','Piano Roll and exact note values');this.editor=editor;
    const clipTools=el('div','ww-studio-actions');this.clipSelect=el('select');this.clipSelect.setAttribute('aria-label','DAW clip');this.clipSelect.onchange=()=>{this.selectedClip=this.clipSelect.value;this.selectedNote=null;this.refreshEditor();};
    this.newClip=button('Add DAW MIDI clip',()=>{const t=this.selectedTrack();if(!t||t.type!=='midi')throw Error('Select an instrument track');const p=this.controller.snapshot(),c={id:uuid(),type:'midi',trackId:t.id,name:t.name+' clip',position:{unit:'ticks',value:0},length:p.length,loopLength:p.length,loop:false,notes:[]};this.controller.command('clip.add',c);this.selectedClip=c.id;this.refreshEditor();});
    this.clipStart=this.field('DAW clip start beat','number',1,clipTools);Object.assign(this.clipStart,{min:1,step:.25});
    this.clipStart.onchange=()=>{const c=this.clip();if(c)this.edit('clip.update',{id:c.id,changes:{position:{unit:'ticks',value:Math.round((Number(this.clipStart.value)-1)*PPQ)}}});};
    clipTools.prepend(this.clipSelect,this.newClip);editor.append(clipTools);
    this.notes=el('select');this.notes.size=5;this.notes.setAttribute('aria-label','DAW notes');this.notes.onchange=()=>{this.selectedNote=this.notes.value;this.inspectNote();};editor.append(this.notes);
    const noteTools=el('div','ww-daw-note-fields');this.pitch=this.field('DAW note pitch','number',60,noteTools);Object.assign(this.pitch,{min:0,max:127,step:1});this.velocity=this.field('DAW note velocity','number',100,noteTools);Object.assign(this.velocity,{min:1,max:127,step:1});
    this.start=this.field('DAW note start beat','number',1,noteTools);Object.assign(this.start,{min:1,step:.25});this.duration=this.field('DAW note duration beats','number',1,noteTools);Object.assign(this.duration,{min:1/PPQ,step:.25});
    this.addNote=button('Add DAW note',()=>this.addNoteFromFields());this.applyNote=button('Apply DAW note',()=>{const c=this.clip();if(!c||!this.selectedNote)throw Error('Select a note');this.controller.command('note.update',{clipId:c.id,id:this.selectedNote,changes:this.noteValues()});});
    this.deleteNote=button('Delete DAW note',()=>{const c=this.clip();if(c&&this.selectedNote)this.controller.command('note.remove',{clipId:c.id,id:this.selectedNote});});noteTools.append(this.addNote,this.applyNote,this.deleteNote);editor.append(noteTools);
    const master=el('div','ww-daw-master');this.master=this.field('DAW master volume','range',1,master);Object.assign(this.master,{min:0,max:2,step:.01});this.master.oninput=()=>this.edit('master.update',{volume:Number(this.master.value)});this.masterValue=el('output','','0.0 dB');master.append(this.masterValue);
    this.node.append(this.status,this.toolbar,transport,trackTools,this.empty,this.trackScroll,editor,master,el('p','ww-muted','External MIDI and microphone recording are available. Direct clip gestures and full FX chains follow in later phases. The Synth keyboard still plays the Synth; selecting this workspace does not change MIDI mappings.'));
    this.recoveryDialog=el('dialog','ww-map-dialog');this.recoveryChoices=el('select');this.recoveryChoices.setAttribute('aria-label','DAW recovery project');
    this.recoveryConfirm=button('Recover selected DAW copy',async()=>{const loaded=await this.files.recover(this.recoveryChoices.value,{accept:()=>this.confirmDiscard(),deferBinding:true});if(loaded){try{await this.adopt(loaded);this.files.forget();this.controller.markUnsaved();this.refresh();this.recoveryDialog.close();}catch(error){await loaded.dispose();throw error;}}});
    this.recoveryDialog.append(el('h2','','Recover a project from this browser'),this.recoveryChoices,this.recoveryConfirm,action('Cancel DAW recovery',()=>this.recoveryDialog.close()));document.body.append(this.recoveryDialog);
    this.attach(new ProjectController());
    this.layout=new DawArrangement(this,{transport,trackTools,master});this.layout.render();
    this.monitor=new DawMonitor(this);this.recorder=new DawRecorder(this);this.buildInputControls();this.buildRecordingControls(transport);this.importer=new DawImporter(this);this.audition=new DawAudition(this);this.clipTools=new DawClipTools(this);this.buildImportControls();this.editors=new DawEditors(this);this.mix=new DawMix(this);
    this.node.addEventListener('pointerup',()=>this.controller.endCoalescing());
    this.node.addEventListener('keyup',event=>{if(event.target.type==='range')this.controller.endCoalescing();});
    addEventListener('beforeunload',event=>{if(this.controller.dirty||this.recorder.busy){event.preventDefault();event.returnValue='';}});
    this.node.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||!event.ctrlKey&&!event.metaKey)return;const key=event.key.toLowerCase();if(key==='s'){event.preventDefault();this.saveButton.click();}if(key==='z'){event.preventDefault();(event.shiftKey?this.redo:this.undo).click();}});
  }
  field(name,type,value,parent){const label=el('label','',name+' '),input=el('input');input.type=type;input.value=value;input.setAttribute('aria-label',name);label.append(input);parent.append(label);return input;}
  buildInputControls(){
    this.inputToggle=action('Enable DAW MIDI input',()=>this.run(()=>this.monitor.enabled?this.monitor.disable():this.monitor.enable()));this.toolbar.append(this.inputToggle);this.inputToggle.title='Explicitly route external MIDI to the selected DAW instrument. Workspace navigation does not change this routing.';
    this.inputPanel=Panel('Input','Selected track');this.inputMode=el('select');this.inputMode.setAttribute('aria-label','DAW track monitor');for(const value of ['in','auto','off'])this.inputMode.add(new Option('Monitor '+value,value));this.inputMode.onchange=()=>this.edit('track.update',{id:this.selected,changes:{monitor:this.inputMode.value}});
    this.inputChannel=el('select');this.inputChannel.setAttribute('aria-label','DAW MIDI input channel');this.inputChannel.add(new Option('All MIDI channels','all'));for(let ch=0;ch<16;ch++)this.inputChannel.add(new Option('MIDI channel '+(ch+1),ch));this.inputChannel.onchange=()=>{this.monitor.channel=this.inputChannel.value==='all'?null:Number(this.inputChannel.value);this.monitor.updateMix();};
    this.inputStatus=el('p','ww-muted','DAW MIDI input is off. The original Synth input is unchanged.');this.inputPanel.append(this.inputMode,this.inputChannel,this.inputStatus,el('p','ww-muted','In: always hear input. Auto: hear input while stopped or recording. Off: playback remains audible. Input routing stays active across workspaces.'));this.layout.browser.insertBefore(this.inputPanel,this.layout.preset.nextSibling);this.refreshControls();
  }
  buildImportControls(){this.importButton=action('Import WAV / MP3 / MIDI',()=>this.run(()=>this.importer.choose()));this.cancelImport=action('Cancel DAW import',()=>this.importer.cancel());this.midiExport=action('Export MIDI composition',()=>this.run(async()=>{const name=await saveMidi(this.controller.snapshot());this.status.textContent='MIDI exported to '+name+' · choose instruments in the destination app; mix/FX remain in the WS project';}));this.midiSelectionExport=action('Export selected MIDI clips',()=>this.run(async()=>{const name=await saveMidi(this.controller.snapshot(),new Set(this.clipTools.selected));this.status.textContent='MIDI selection exported to '+name;}));this.clipTools.bar.append(this.midiSelectionExport);this.toolbar.append(this.importButton,this.cancelImport,this.midiExport);this.layout.viewport.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});this.layout.viewport.addEventListener('drop',e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();e.stopPropagation();if(e.dataTransfer.files.length!==1){this.error(Error('Drop one media file at a time'));return;}const beat=this.layout.beatAt(e,this.layout.ruler),atBeat=this.layout.snap?Math.round(beat/this.layout.grid)*this.layout.grid:beat,trackId=e.target.closest('.ww-daw-arrangement-row')?.dataset.trackId;void this.run(()=>this.importer.import(e.dataTransfer.files[0],{atBeat,trackId}));});this.refreshControls();}
  armTrack(id){if(this.recorder.busy||this.player.playing)return;const track=this.snapshot.tracks.find(t=>t.id===id),arm=!track?.arm;this.controller.command('batch',{commands:this.snapshot.tracks.filter(t=>t.arm||t.id===id).map(t=>({type:'track.update',payload:{id:t.id,changes:{arm:t.id===id&&arm}}}))});this.selected=id;this.refresh();}
  buildRecordingControls(transport){
    this.record=action('Record DAW',()=>this.run(()=>this.recorder.start()));this.record.classList.add('ww-daw-record');this.record.setAttribute('aria-label','Record DAW');this.record.textContent='Record';this.arm=action('Arm selected DAW track',()=>this.armTrack(this.selected));transport.prepend(this.record);
    this.countIn=el('select');this.countIn.setAttribute('aria-label','DAW count-in bars');for(const bars of [0,1,2,4])this.countIn.add(new Option(bars?'Count-in '+bars+' bar'+(bars===1?'':'s'):'No count-in',bars));this.countIn.value=this.recorder.settings.countIn;this.countIn.onchange=()=>{this.recorder.settings.countIn=Number(this.countIn.value);this.recorder.preferences();};
    this.click=this.field('DAW metronome','checkbox','',transport);this.click.parentElement.firstChild.textContent='Click';this.click.checked=!!this.recorder.settings.click;this.click.onchange=()=>{this.recorder.settings.click=this.click.checked;this.player.clickSettings={enabled:this.click.checked,level:.4};this.recorder.preferences();};this.player.clickSettings={enabled:this.click.checked,level:.4};transport.append(this.countIn);
    this.midiOffset=this.field('DAW MIDI offset ms','number',0,this.inputPanel);this.audioOffset=this.field('DAW audio offset ms','number',0,this.inputPanel);for(const [input,kind] of [[this.midiOffset,'midi'],[this.audioOffset,'audio']]){Object.assign(input,{min:-2000,max:2000,step:1});input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value)||Math.abs(value)>2000){this.error(Error('Offset range: −2000 to 2000 ms'));return;}this.recorder.setOffset(kind,value);};}
    this.audioDevice=el('select');this.audioDevice.setAttribute('aria-label','DAW audio input device');this.audioDevice.add(new Option('Default audio input','default'));if(this.recorder.settings.deviceId!=='default')this.audioDevice.add(new Option('Saved audio input',this.recorder.settings.deviceId));this.audioDevice.value=this.recorder.settings.deviceId;this.audioDevice.onchange=()=>{this.recorder.releaseAudio();this.recorder.settings.deviceId=this.audioDevice.value;this.recorder.preferences();this.refreshControls();};
    this.audioInput=action('Enable DAW audio input',()=>this.run(async()=>{if(this.recorder.audioTrackId===this.selected){this.recorder.releaseAudio();this.monitor.updateMix();}else{await this.recorder.enableAudio();await this.refreshAudioDevices();}}));
    this.replaceTake=this.field('Replace selected DAW clip','checkbox','',this.inputPanel);this.replaceTake.checked=this.recorder.settings.replaceSelected!==false;this.replaceTake.onchange=()=>{this.recorder.settings.replaceSelected=this.replaceTake.checked;this.recorder.preferences();};
    this.inputPanel.append(this.arm,this.audioDevice,this.audioInput,el('p','ww-muted','One armed track records. With Replace selected clip on, the selected clip on that track is replaced in full after validation. Turn it off to make a new clip at the cursor. With Loop on, Record makes one pass through Range in/out. Positive offset moves the take earlier. The Synth keyboard is not recorded.'));
    this.takeRecovery=action('Recover interrupted take',()=>this.run(async()=>{const takes=await this.recorder.list();this.takeChoices.replaceChildren(...takes.map(t=>new Option(t.name+' · '+new Date(t.created).toLocaleString()+' · '+t.status,t.id)));this.takeConfirm.disabled=!takes.length;if(!takes.length)this.takeChoices.replaceChildren(new Option('No recoverable take checkpoints',''));this.takeDialog.showModal();}));this.toolbar.append(this.takeRecovery);
    this.takeDialog=el('dialog','ww-map-dialog');this.takeChoices=el('select');this.takeChoices.setAttribute('aria-label','DAW interrupted take');this.takeConfirm=action('Recover selected take checkpoint',()=>this.run(async()=>{if(!this.confirmDiscard())return;await this.recorder.recover(this.takeChoices.value);this.takeDialog.close();}));this.takeDialog.append(el('h2','','Recover a take and its original project snapshot'),this.takeChoices,this.takeConfirm,action('Cancel take recovery',()=>this.takeDialog.close()));document.body.append(this.takeDialog);this.refreshControls();
  }
  async refreshAudioDevices(){const devices=await navigator.mediaDevices.enumerateDevices();this.audioDevice.replaceChildren(new Option('Default audio input','default'),...devices.filter(d=>d.kind==='audioinput'&&d.deviceId!=='default').map((d,i)=>new Option(d.label||'Audio input '+(i+1),d.deviceId)));this.audioDevice.value=this.recorder.settings.deviceId;if(!this.audioDevice.value)this.audioDevice.value='default';}
  error(error){this.status.textContent=error.name==='AbortError'?'File operation cancelled':error.message;}
  async run(task){if(this.busy)return;this.busy=true;this.refreshControls();try{await task();}catch(error){this.error(error);this.layout?.render();}finally{this.busy=false;this.refreshControls();}}
  edit(type,payload){if(this.recorder?.busy||this.importer?.busy||this.audition?.busy){this.error(Error('Finish recording before editing the project'));return;}try{const keys=Object.keys(payload.changes||payload),mergeKey=keys.length===1&&['volume','pan'].includes(keys[0])?type+':'+(payload.id||'master')+':'+keys[0]:undefined;this.controller.command(type,payload,{mergeKey});}catch(error){this.error(error);this.refresh();}}
  confirmDiscard(){return !this.controller.dirty||confirm('Discard unsaved DAW changes? Save a project file first to keep them.');}
  attach(controller){
    this.unsubscribe?.();this.controller=controller;this.snapshot=controller.snapshot();this.cursor=0;this.selected=this.snapshot.tracks[0]?.id||null;this.selectedClip=null;this.selectedNote=null;this.clearClipSelection=false;if(this.clipTools)this.clipTools.selected.clear();
    this.unsubscribe=controller.subscribe(event=>{this.refresh(event);try{this.player.updateMix(this.snapshot);}catch(error){this.error(error);}});
    this.auto=new RecoveryAutosave(controller,this.files,{onStatus:s=>{this.recoveryStatus.textContent=s.state==='saved'?'Recovery copy updated':s.state==='saving'?'Updating recovery copy':'Recovery failed: '+s.message;}});this.refresh();
  }
  async adopt(loaded){
    if(this.recorder?.busy)throw Error('Finish recording before opening another project');await this.audition?.release();this.recorder?.releaseAudio();const next=new ProjectController(loaded.project,loaded.assets);await this.monitor?.disable();await this.player.stop(true);await this.player.reset();await this.auto.close();const old=this.loaded;this.loaded=loaded;this.attach(next);this.status.textContent=loaded.warnings?.join(' ')||'Project ready';if(old)try{await old.dispose();}catch(error){this.status.textContent+=' · Previous import cache cleanup failed: '+error.message;}
  }
  selectedTrack(){return this.snapshot.tracks.find(t=>t.id===this.selected);}
  playProject(){
    if(this.audition?.busy||this.importer?.busy||this.recorder?.busy)throw Error('Finish the current recording, import or piano audition before Play');const p=this.snapshot,transport=p.transport||{loop:false,start:0,end:p.length},end=beatFrame(arrangementBeats(p),p),loopStart=beatFrame(transport.start/PPQ,p),loopEnd=beatFrame(transport.end/PPQ,p);let fromFrame=this.cursor||0;
    if(transport.loop&&(fromFrame<loopStart||fromFrame>=loopEnd))fromFrame=loopStart;else if(!transport.loop&&fromFrame>=end)fromFrame=0;
    return this.player.start(this.controller,{fromFrame,loop:transport.loop,loopStart,loopEnd});
  }
  seek(frame){if(this.recorder?.busy||this.importer?.busy||this.audition?.busy)return;return this.run(async()=>{if(!Number.isSafeInteger(frame)||frame<0)throw Error('Invalid seek position');const resume=this.player.playing;await this.player.capture(this.controller);if(resume)await this.player.stop();this.cursor=Math.min(frame,Math.max(0,beatFrame(arrangementBeats(this.snapshot),this.snapshot)-1));this.paintPosition();if(resume)await this.playProject();});}
  changeTransport(changes){if(this.recorder?.busy||this.importer?.busy||this.audition?.busy)return;return this.run(async()=>{const p=this.controller.snapshot(),transport={...(p.transport||{loop:false,start:0,end:p.length}),...changes};validateProject({...p,transport});if(transport.loop&&(beatFrame((transport.end-transport.start)/PPQ,p)<128||beatFrame(transport.end/PPQ,p)>RATE*1200))throw Error('Choose a loop of at least 128 frames within the 20-minute playback range');const resume=this.player.playing;await this.player.capture(this.controller);if(resume)await this.player.stop();this.controller.command('project.update',{transport});if(resume)await this.playProject();});}
  paintPosition(){this.position.textContent=this.layout?.prefs.ruler==='time'?secondsPosition((this.cursor||0)/RATE):musicalPosition(frameBeat(this.cursor||0,this.snapshot),this.snapshot);this.layout?.position(this.cursor||0);}
  clip(){return this.snapshot.clips.find(c=>c.id===this.selectedClip);}
  noteValues(){return {pitch:Number(this.pitch.value),velocity:Number(this.velocity.value),start:Math.round((Number(this.start.value)-1)*PPQ),duration:Math.round(Number(this.duration.value)*PPQ)};}
  addNoteFromFields(){
    const track=this.selectedTrack();if(!track||track.type!=='midi')throw Error('Select an instrument track');let c=this.clip();
    const n={id:uuid(),...this.noteValues()},commands=[];if(!c){c={id:uuid(),type:'midi',trackId:track.id,name:track.name+' clip',position:{unit:'ticks',value:0},length:this.snapshot.length,loopLength:this.snapshot.length,loop:false,notes:[]};commands.push({type:'clip.add',payload:c});}
    commands.push({type:'note.add',payload:{clipId:c.id,note:n}});this.controller.command('batch',{commands});this.selectedClip=c.id;this.selectedNote=n.id;this.refreshEditor();
  }
  row(track){
    const node=el('div','ww-daw-track');node.dataset.trackId=track.id;const choose=action('Select track',()=>{this.selected=track.id;this.selectedClip=null;this.selectedNote=null;this.refresh();}),name=el('input');name.setAttribute('aria-label','DAW track name');name.onchange=()=>this.edit('track.update',{id:track.id,changes:{name:name.value}});
    const identity=el('div','ww-daw-track-identity');identity.append(choose,name,el('small','ww-muted',track.type==='midi'?'MIDI':'Audio'));
    const instrument=el('select');instrument.setAttribute('aria-label','DAW instrument preset');instrument.onchange=()=>this.run(async()=>{const sound=await this.player.tone(Number(instrument.value));if(sound.engine<0)throw Error('This sound is not supported');this.controller.command('track.update',{id:track.id,changes:{instrument:{type:sound.engine===2?'drumx':sound.patch[0]===4?'super':'analog',patch:sound.patch}}});});
    const volume=el('input');volume.type='range';Object.assign(volume,{min:0,max:2,step:.01});volume.setAttribute('aria-label','DAW track volume');volume.oninput=()=>this.edit('track.update',{id:track.id,changes:{volume:Number(volume.value)}});
    const pan=el('input');pan.type='range';Object.assign(pan,{min:-1,max:1,step:.01});pan.setAttribute('aria-label','DAW track pan');pan.oninput=()=>this.edit('track.update',{id:track.id,changes:{pan:Number(pan.value)}});
    const mute=action('Mute track',()=>this.edit('track.update',{id:track.id,changes:{mute:!this.snapshot.tracks.find(t=>t.id===track.id).mute}})),solo=action('Solo track',()=>this.edit('track.update',{id:track.id,changes:{solo:!this.snapshot.tracks.find(t=>t.id===track.id).solo}}));
    const remove=action('Remove track',()=>this.edit('track.remove',{id:track.id}));node.append(identity,instrument,volume,pan,mute,solo,remove);this.rows.set(track.id,{node,choose,name,instrument,volume,pan,mute,solo,remove,library:null});return this.rows.get(track.id);
  }
  refresh(event){
    if(!this.controller)return;this.snapshot=this.controller.snapshot();const p=this.snapshot;if(!p.tracks.some(t=>t.id===this.selected))this.selected=p.tracks[0]?.id||null;
    if(document.activeElement!==this.name)this.name.value=p.name;if(document.activeElement!==this.tempo)this.tempo.value=p.bpm;if(document.activeElement!==this.length)this.length.value=p.length/PPQ;
    this.dirty.textContent=this.controller.dirty?'Unsaved changes':this.files.handle?'Saved · '+this.files.handle.name:'New project';this.masterValue.textContent=db(p.master.volume);if(document.activeElement!==this.master)this.master.value=p.master.volume;
    this.empty.hidden=p.tracks.length>0;
    for(const [id,row] of this.rows)if(!p.tracks.some(t=>t.id===id)){row.node.remove();this.rows.delete(id);}
    p.tracks.forEach((t,i)=>{const row=this.rows.get(t.id)||this.row(t);if(this.trackList.children[i]!==row.node)this.trackList.insertBefore(row.node,this.trackList.children[i]||null);row.node.classList.toggle('is-selected',this.selected===t.id);row.choose.setAttribute('aria-pressed',String(this.selected===t.id));
      if(document.activeElement!==row.name)row.name.value=t.name;if(document.activeElement!==row.volume)row.volume.value=t.volume;if(document.activeElement!==row.pan)row.pan.value=t.pan;row.volume.title=db(t.volume);row.pan.title=t.pan.toFixed(2);row.mute.setAttribute('aria-pressed',String(t.mute));row.solo.setAttribute('aria-pressed',String(t.solo));
      const label=patchName(t.instrument?.patch);if(row.library!==this.programs||row.sound!==label){row.instrument.replaceChildren(new Option(label,''),...this.programs.map(program=>new Option(program.number+' · '+program.name,String(program.number-1))));row.library=this.programs;row.sound=label;row.instrument.value='';}row.instrument.hidden=t.type!=='midi';
    });
    if(!event||!['track.update','project.update','master.update'].includes(event.type)&&event.kind!=='saved')this.refreshEditor();this.refreshControls();this.layout?.render(event);this.clipTools?.refresh();this.editors?.refresh();this.mix?.refresh();void this.monitor?.refresh();
  }
  refreshEditor(){
    const track=this.selectedTrack(),clips=this.snapshot.clips.filter(c=>c.trackId===track?.id&&c.type==='midi');if(track?.type==='midi'){if(!clips.some(c=>c.id===this.selectedClip))this.selectedClip=this.clearClipSelection?null:clips[0]?.id||null;}else if(!this.snapshot.clips.some(c=>c.id===this.selectedClip&&c.trackId===track?.id))this.selectedClip=null;
    this.clipSelect.replaceChildren(...clips.map(c=>new Option(c.name,c.id)));this.clipSelect.value=this.selectedClip||'';const c=this.clip();this.clipStart.value=c?c.position.unit==='ticks'?c.position.value/PPQ+1:c.position.value*this.snapshot.bpm/60+1:1;
    if(!c?.notes?.some(n=>n.id===this.selectedNote))this.selectedNote=this.editors?null:c?.notes?.[0]?.id||null;
    this.notes.replaceChildren(...(c?.notes||[]).map(n=>new Option(`MIDI ${n.pitch} · beat ${(n.start/PPQ+1).toFixed(2)} · ${n.duration/PPQ} beats · vel ${n.velocity}`,n.id)));this.notes.value=this.selectedNote||'';this.inspectNote();this.refreshControls();
  }
  inspectNote(){const n=this.clip()?.notes?.find(n=>n.id===this.selectedNote);if(n){this.pitch.value=n.pitch;this.velocity.value=n.velocity;this.start.value=n.start/PPQ+1;this.duration.value=n.duration/PPQ;}}
  refreshControls(){
    if(!this.controller)return;const recording=!!this.recorder?.busy,fileLocked=this.busy||recording||this.importer?.busy,locked=fileLocked||this.audition?.busy||this.player.playing||this.monitor?.preparing,track=this.selectedTrack();
    for(const b of [this.newButton,this.openButton,this.saveButton,this.saveAsButton,this.recoverButton,this.takeRecovery].filter(Boolean))b.disabled=fileLocked;this.undo.disabled=fileLocked||!this.controller.canUndo||this.player.playing;this.redo.disabled=fileLocked||!this.controller.canRedo||this.player.playing;
    this.play.disabled=fileLocked||this.audition?.busy||this.player.playing||!this.running;this.stop.disabled=!recording&&!this.audition?.busy&&!this.player.playing&&!this.player.starting;this.tempo.disabled=locked;this.length.disabled=locked;this.addMidi.disabled=locked||this.snapshot.tracks.length>=32;this.master.disabled=this.busy;
    for(const [id,row] of this.rows){const auto=target=>this.player.playing&&this.snapshot.automation.some(l=>l.enabled&&l.trackId===id&&l.target===target&&l.points.length);row.name.disabled=locked;row.instrument.disabled=locked||!this.running;row.remove.disabled=locked;row.volume.disabled=this.busy||auto('volume');row.pan.disabled=this.busy||auto('pan');row.mute.disabled=this.busy;row.solo.disabled=this.busy;}
    for(const field of [this.clipSelect,this.newClip,this.clipStart,this.notes,this.pitch,this.velocity,this.start,this.duration,this.addNote,this.applyNote,this.deleteNote])field.disabled=locked||track?.type!=='midi';
    this.applyNote.disabled=locked||!this.selectedNote;this.deleteNote.disabled=locked||!this.selectedNote;
    this.clipStart.disabled=locked||!this.selectedClip;
    this.layout?.controls();this.clipTools?.refresh();this.editors?.controls();this.mix?.refresh();if(this.importButton){this.importButton.disabled=locked;this.midiExport.disabled=fileLocked||!this.snapshot.clips.some(c=>c.type==='midi');this.midiSelectionExport.disabled=fileLocked||!this.snapshot.clips.some(c=>c.type==='midi'&&this.clipTools.selected.has(c.id));this.cancelImport.hidden=!this.importer.busy;}
    if(this.record){this.record.disabled=fileLocked||this.audition?.busy||this.audition?.busy||this.player.playing||this.monitor?.preparing||!this.running||!this.snapshot.tracks.some(t=>t.arm);this.record.setAttribute('aria-pressed',String(recording));this.arm.disabled=locked||!track;this.arm.setAttribute('aria-pressed',String(!!track?.arm));for(const field of [this.countIn,this.click,this.midiOffset,this.audioOffset,this.audioDevice,this.audioInput,this.replaceTake])field.disabled=fileLocked;this.audioInput.disabled=fileLocked||!this.running||this.player.playing||track?.type!=='audio';this.audioInput.textContent=this.recorder.audioTrackId===track?.id?'Disable DAW audio input':'Enable DAW audio input';this.midiOffset.value=this.recorder.offset('midi');this.audioOffset.value=this.recorder.offset('audio');}
    if(this.inputToggle){this.inputToggle.textContent=this.monitor.enabled?'Disable DAW MIDI input':'Enable DAW MIDI input';this.inputToggle.disabled=fileLocked||this.monitor.preparing||!this.running||track?.type!=='midi'&&!this.monitor.enabled;this.inputMode.disabled=fileLocked||!track;this.inputChannel.disabled=fileLocked;this.inputMode.value=track?.monitor||'off';this.inputStatus.textContent=this.monitor.enabled?(this.monitor.ready?'MIDI → '+(this.monitor.track()?.name||'Synth'):'Preparing input; release held notes before retrying'):'DAW MIDI input is off. The original Synth input is unchanged.';}
  }
  transportState(state){
    const changed=this.player.playing!==state.playing||this.transportPlaying!==state.playing;this.player.playing=state.playing;this.transportPlaying=state.playing;if(!state.preparing&&Number.isFinite(state.frame))this.cursor=state.frame;this.paintPosition();
    if(this.recorder?.busy&&this.recorder.state!=='preparing'){this.refreshControls();if(!state.playing&&state.reason&&state.reason!=='replaced'&&!this.recorder.stopping)void this.recorder.stop(state.reason==='ended'?'arrangement-end':state.reason);return;}
    if(state.preparing)this.status.textContent='Preparing playback';else if(state.playing&&(changed||state.reason==='started'))this.status.textContent='Playing project';else if(!state.playing&&state.reason)this.status.textContent=state.reason==='ended'?'Playback finished':'Playback stopped · '+state.reason;if(changed||state.preparing||state.reason){this.refreshControls();void this.monitor?.refresh();}
  }
  async showRecovery(){const copies=await this.files.listRecovery();this.recoveryChoices.replaceChildren(...copies.map(c=>new Option(c.name+' · '+new Date(c.modified).toLocaleString(),c.id)));this.recoveryConfirm.disabled=!copies.length;if(!copies.length)this.recoveryChoices.replaceChildren(new Option('No recovery copies in this browser',''));this.recoveryDialog.showModal();}
  receive(message){
    if(message.t==='ready'){if(this.recorder?.busy)void this.recorder.stop('instrument-reboot');else this.recorder?.releaseAudio();this.monitor?.invalidate();this.player.invalidateBinding();this.running=!!message.audio;this.refreshControls();}
    if(message.t==='frame'){this.frame=message;if(message.programLibrary){this.programs=message.programLibrary;this.refresh({kind:'saved'});}if(!this.node.hidden)this.layout?.meters();}
    if(message.t==='daw-notice')this.status.textContent=message.message;
    if(message.t==='daw-instruments-changed'&&message.projectId===this.controller.snapshot().id){if(this.player.synchronize(this.controller,message.changes))this.status.textContent='Live instrument edits updated the project';}
    if(message.t==='error'){if(this.recorder?.busy)void this.recorder.stop('processor-error');this.monitor?.invalidate();this.running=false;this.player.playing=false;this.refreshControls();}
    this.player.receive(message);
  }
}
