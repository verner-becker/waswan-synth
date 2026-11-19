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
import {DawExportPanel} from './ui-daw-export.js';
import {DawAssetRetention} from './daw-asset-retention.js';
import {DawMidiProfilesPanel,midiPanelContext} from './ui-daw-midi-profiles.js';
import {dawShortcut,shortcutHelp} from './ui-daw-shortcuts.js';
import {DawEditors} from './ui-daw-editors.js';
import {DawAudition} from './daw-audition.js';
import {DawClipTools} from './ui-daw-clip-tools.js';
import {DawImporter} from './daw-import.js';
import {DawRecorder,SYNTH_INPUT} from './daw-recording.js';
import {beatFrame,frameBeat,arrangementBeats,musicalPosition,secondsPosition} from './daw-arrangement.js';
const patchName=patch=>patch?String.fromCharCode(...patch.slice(63,73)).replace(/[^\x20-\x7e]/g,'').trim()||'Saved sound':'Choose an instrument';
const db=value=>value>0?(20*Math.log10(value)).toFixed(1)+' dB':'−∞ dB';
export class DawWorkspace {
  constructor(bridge,{toggleKeyboard=()=>false,openSettings=()=>{},openStudioFile=()=>{}}={}){
    this.bridge=bridge;this.files=new ProjectFiles({
      openPicker:options=>this.pick('showOpenFilePicker',options),
      savePicker:options=>this.pick('showSaveFilePicker',options)
    });this.assetRetention=new DawAssetRetention(this);this.rows=new Map();this.programs=[];this.drumKits=[];this.busy=false;this.running=false;this.selected=null;this.cursor=0;
    this.player=new DawPlayer(bridge,state=>this.transportState(state));
    this.node=Panel('DAW');this.node.classList.add('ww-daw');
    this.status=el('p','ww-daw-status');this.status.setAttribute('role','status');
    this.toolbar=el('div','ww-daw-file-actions');
    const button=(name,task)=>action(name,()=>this.run(task));
    this.newButton=button('New DAW project',async()=>{if(!this.confirmDiscard())return;await this.adopt({project:emptyProject(),assets:new Map(),dispose:async()=>{},warnings:[]});this.files.forget();this.refresh();});
    this.openButton=button('Open DAW project',async()=>{
      const loaded=await this.files.open({deferBinding:true,accept:()=>this.confirmDiscard(),chooseStudio:source=>this.studioChoice(source)});
      if(!loaded)return;
      if(loaded.originalFile){
        await openStudioFile(loaded.originalFile);
        return;
      }
      await this.adopt(loaded);
      if(loaded.warnings.length){this.files.forget();this.controller.markUnsaved();}
      else this.files.adoptBinding(loaded.binding);
      this.refresh();
    });
    this.saveButton=button('Save DAW project',()=>this.saveProject());
    this.saveAsButton=button('Save DAW project as',()=>this.saveProject({saveAs:true}));
    this.undo=button('Undo DAW edit',()=>this.controller.command('undo'));this.redo=button('Redo DAW edit',()=>this.controller.command('redo'));
    this.recoverButton=button('Recover DAW copy',()=>this.showRecovery());
    this.toolbar.append(this.newButton,this.openButton,this.saveButton,this.saveAsButton,this.undo,this.redo,this.recoverButton);
    const transport=el('div','ww-daw-transport');this.play=button('Play DAW',()=>this.playProject());this.play.classList.add('ww-primary');
    this.stop=action('Stop DAW',()=>{if(this.audioExport?.exporter.busy){this.audioExport.abort();return;}void (this.audition?.busy?this.audition.release():this.recorder?.busy?this.recorder.stop():this.player.stop()).catch(error=>this.error(error));});this.position=el('output','ww-daw-position','1.1');
    this.name=this.field('DAW project name','text','Untitled',transport);this.name.onchange=()=>this.edit('project.update',{name:this.name.value});
    this.tempo=this.field('DAW tempo','number',120,transport);Object.assign(this.tempo,{min:40,max:240,step:.1});this.tempo.onchange=()=>this.edit('project.update',{bpm:Number(this.tempo.value)});
    this.length=this.field('DAW length in beats','number',16,transport);Object.assign(this.length,{min:1,max:8192,step:1});this.length.onchange=()=>{const length=Math.round(Number(this.length.value)*PPQ),t=this.snapshot.transport;this.edit('project.update',{length,...(t?.end===this.snapshot.length?{transport:{...t,start:t.start<length?t.start:0,end:length}}:{})});};
    this.dirty=el('span','ww-chip','New project');this.recoveryStatus=el('span','ww-muted','Recovery updates after edits');
    transport.prepend(this.play,this.stop,this.position);transport.append(this.dirty,this.recoveryStatus);
    const trackTools=el('div','ww-studio-actions');this.addMidi=button('Add MIDI track',async()=>{
      const t=makeTrack('midi','Instrument '+(this.controller.snapshot().tracks.filter(t=>t.type==='midi').length+1));if(this.running){const sound=await this.player.currentTone(this.frame?.track||0);t.instrument=sound;}
      this.controller.command('track.create',t);this.selected=t.id;this.refresh();
    });
    this.keyboard=action('Show Synth keyboard',()=>{
      const visible=toggleKeyboard();
      if(!this.linked)this.keyboard.textContent=visible?'Hide Synth keyboard':'Show Synth keyboard';
    });trackTools.append(this.addMidi,this.keyboard);
    this.trackScroll=el('div','ww-daw-track-scroll');this.trackList=el('div','ww-daw-tracks');this.trackScroll.append(this.trackList);
    const editor=Panel('Clip editor');this.editor=editor;
    this.notes=el('select');this.notes.size=5;this.notes.setAttribute('aria-label','DAW notes');this.notes.onchange=()=>{this.selectedNote=this.notes.value;this.inspectNote();};editor.append(this.notes);
    const noteTools=el('div','ww-daw-note-fields');this.pitch=this.field('DAW note pitch','number',60,noteTools);Object.assign(this.pitch,{min:0,max:127,step:1});this.velocity=this.field('DAW note velocity','number',100,noteTools);Object.assign(this.velocity,{min:1,max:127,step:1});
    this.start=this.field('DAW note start beat','number',1,noteTools);Object.assign(this.start,{min:1,step:.25});this.duration=this.field('DAW note duration beats','number',1,noteTools);Object.assign(this.duration,{min:1/PPQ,step:.25});
    this.addNote=button('Add DAW note',()=>this.addNoteFromFields());this.applyNote=button('Apply DAW note',()=>{const c=this.clip();if(!c||!this.selectedNote)throw Error('Select a note');this.controller.command('note.update',{clipId:c.id,id:this.selectedNote,changes:this.noteValues()});});
    this.deleteNote=button('Delete DAW note',()=>{const c=this.clip();if(c&&this.selectedNote)this.controller.command('note.remove',{clipId:c.id,id:this.selectedNote});});noteTools.append(this.addNote,this.applyNote,this.deleteNote);editor.append(noteTools);
    const master=el('div','ww-daw-master');this.master=this.field('DAW master volume','range',1,master);Object.assign(this.master,{min:0,max:2,step:.01});this.master.oninput=()=>this.edit('master.update',{volume:Number(this.master.value)});this.master.onchange=()=>this.controller.endCoalescing();this.masterValue=el('output','','0.0 dB');this.mixerMasterPeaks=el('output','ww-daw-master-readout','DAW Master L/R: −∞ / −∞ dBFS');
    this.mixerMasterPeaks.setAttribute('aria-label','Mixer Master stereo peaks');
    master.append(this.masterValue,this.mixerMasterPeaks);
    this.recoveryDialog=el('dialog','ww-map-dialog');this.recoveryChoices=el('select');this.recoveryChoices.setAttribute('aria-label','DAW recovery project');
    this.recoveryConfirm=button('Recover selected DAW copy',async()=>{const loaded=await this.files.recover(this.recoveryChoices.value,{accept:()=>this.confirmDiscard(),deferBinding:true});if(loaded){await this.adopt(loaded);this.files.forget();this.controller.markUnsaved();this.refresh();this.recoveryDialog.close();}});
    this.recoveryDialog.append(el('h2','','Recover a project from this browser'),this.recoveryChoices,this.recoveryConfirm,action('Cancel DAW recovery',()=>this.recoveryDialog.close()));document.body.append(this.recoveryDialog);
    this.buildStudioCompatibility();
    this.attach(new ProjectController());
    this.layout=new DawArrangement(this,{transport,trackTools,master});this.layout.render();
    this.monitor=new DawMonitor(this);this.recorder=new DawRecorder(this);this.buildInputControls(openSettings);this.buildRecordingControls(transport);this.importer=new DawImporter(this);this.audition=new DawAudition(this);this.clipTools=new DawClipTools(this);this.buildImportControls();this.editors=new DawEditors(this);this.mix=new DawMix(this);this.audioExport=new DawExportPanel(this,this.layout.transportOptions);
    this.midiProfiles=new DawMidiProfilesPanel(this);
    transport.append(action('Shortcuts',()=>shortcutHelp(this.node.ownerDocument)));
    this.refreshControls();
    this.node.addEventListener('pointerup',()=>this.controller.endCoalescing());
    this.node.addEventListener('keyup',event=>{if(event.target.type==='range')this.controller.endCoalescing();});
    addEventListener('beforeunload',event=>{if(this.controller.dirty||this.recorder.busy||this.audioExport.exporter.busy){event.preventDefault();event.returnValue='';}});
    this.node.addEventListener('keydown',event=>this.shortcut(event));
    this.node.addEventListener('focusin',()=>this.layout.windows.status());
  }
  get viewWindow(){return this.node.ownerDocument.defaultView;}
  buildStudioCompatibility(){
    this.studioDialog=el('dialog','ww-map-dialog ww-studio-import');
    this.studioDialog.setAttribute('aria-labelledby','ww-studio-import-title');
    this.studioTitle=el('h2');
    this.studioTitle.id='ww-studio-import-title';
    this.studioNotice=el('p','ww-muted');
    this.studioDetails=el('ul');
    this.studioOriginal=action('Open Studio original',()=>this.studioDialog.close('original'),'ww-primary');
    this.studioConvert=action('Open editable DAW copy',()=>this.studioDialog.close('convert'));
    this.studioDismiss=action('Close',()=>this.studioDialog.close());
    this.studioDialog.append(this.studioTitle,this.studioNotice,this.studioDetails,this.studioOriginal,this.studioConvert,this.studioDismiss);
    document.body.append(this.studioDialog);
    this.studioCompatibility=action('Studio playback compatibility',()=>this.studioChoice(this.snapshot.legacy.studio,{report:true}));
    this.studioCompatibility.hidden=true;
    this.toolbar.append(this.studioCompatibility);
  }
  studioChoice(source,{report=false}={}){
    const lanes=source.sequence?.automation||[];
    const baseLanes=lanes.filter(lane=>/^part:[0-3]:(level|pan)$/.test(lane.target));
    const details=[
      'DAW converts the notes, audio clips and Volume/Pan automation. It keeps the original source data with the copy.',
      'Open the Studio original to use the shared Synth effects, the original expression and other automation lanes.'
    ];
    if(!report)details.push('The editable copy asks for a new file when you save.');
    if(lanes.length>baseLanes.length)details.push((lanes.length-baseLanes.length)+' automation lane(s) remain in the source data.');
    if(baseLanes.length)details.push('At Stop, DAW restores the base faders. Studio keeps the last automated values.');
    this.studioTitle.textContent=report?'Studio playback compatibility':'Open Studio project';
    this.studioNotice.textContent=source.name||'Studio project';
    this.studioDetails.replaceChildren(...details.map(line=>el('li','',line)));
    this.studioConvert.hidden=this.studioOriginal.hidden=report;
    this.studioDismiss.textContent=report?'Close':'Cancel';
    this.studioDialog.returnValue='';
    this.studioDialog.showModal();
    return new Promise(resolve=>this.studioDialog.addEventListener('close',()=>resolve(this.studioDialog.returnValue),{once:true}));
  }
  setLinked(linked){
    if(linked)this.inlineKeyboardLabel=this.keyboard.textContent;
    this.linked=linked;
    this.keyboard.textContent=linked?'Focus Synth keyboard':this.inlineKeyboardLabel;
  }
  async pick(method,options,source=this.viewWindow){
    const result=await source[method](options);
    return source===window?result:structuredClone(result);
  }
  shortcut(event){dawShortcut(this,event);}
  panelFocus(name,{detached=false}={}){
    const context=midiPanelContext(name);
    if(!detached)this.hostMidiContext=context;
    this.midiProfiles?.focus(context);
  }
  async saveProject({saveAs=false,source=this.viewWindow}={}){
    await this.player.capture(this.controller);
    await this.files.save(this.controller,{saveAs,savePicker:options=>this.pick('showSaveFilePicker',options,source)});
    this.refresh();
    this.status.textContent='Project saved to '+this.files.handle.name;
  }
  field(name,type,value,parent){const label=el('label','',name+' '),input=el('input');input.type=type;input.value=value;input.setAttribute('aria-label',name);label.append(input);parent.append(label);return input;}
  buildInputControls(openSettings){
    this.inputPanel=Panel('Recording input');
    this.inputPanel.classList.add('ww-daw-track-input');
    this.inputPanel.querySelector('.ww-section-header span').remove();
    this.inputMode=el('select');
    this.inputMode.setAttribute('aria-label','DAW track monitor');
    for(const [value,label] of [['auto','Auto · while stopped or recording'],['in','In · always hear input'],['off','Off · playback only']]){
      this.inputMode.add(new Option(label,value));
    }
    this.inputMode.onchange=()=>this.edit('track.update',{id:this.selected,changes:{monitor:this.inputMode.value}});
    const monitor=el('label','','Monitor');
    monitor.append(this.inputMode);
    this.midiRouting=el('div','ww-daw-midi-routing');
    this.inputToggle=action('Enable DAW MIDI input',()=>this.run(()=>this.monitor.enabled?this.monitor.disable():this.monitor.enable()));
    this.inputToggle.id='ww-daw-midi-route';
    this.inputToggle.title='Route incoming MIDI between Synth and DAW';
    this.inputChannel=el('select');
    this.inputChannel.setAttribute('aria-label','DAW MIDI input channel');
    this.inputChannel.add(new Option('All MIDI channels','all'));
    for(let ch=0;ch<16;ch++)this.inputChannel.add(new Option('MIDI channel '+(ch+1),ch));
    this.inputChannel.onchange=()=>{
      this.monitor.channel=this.inputChannel.value==='all'?null:Number(this.inputChannel.value);
      this.monitor.updateMix();
      this.refreshRecordingSummary();
    };
    this.inputStatus=el('p','ww-muted');
    this.midiRouting.append(this.inputStatus,this.inputToggle,this.inputChannel,action('Controller settings',openSettings));
    this.audioRouting=el('div','ww-daw-audio-routing');
    this.inputPanel.append(monitor,this.midiRouting,this.audioRouting);
    this.layout.preset.after(this.inputPanel);
  }
  buildImportControls(){this.importButton=action('Import WAV / MP3 / MIDI',()=>this.run(()=>this.importer.choose()));this.cancelImport=action('Cancel DAW import',()=>this.importer.cancel());this.midiExport=action('Export MIDI composition',()=>this.run(async()=>{const name=await saveMidi(this.controller.snapshot(),null,options=>this.pick('showSaveFilePicker',options));this.status.textContent='MIDI exported to '+name+' · choose instruments in the destination app; mix/FX remain in the WS project';}));this.midiSelectionExport=action('Export selected MIDI clips',event=>{const source=event.currentTarget.ownerDocument.defaultView;return this.run(async()=>{const name=await saveMidi(this.controller.snapshot(),new Set(this.clipTools.selected),options=>this.pick('showSaveFilePicker',options,source));this.status.textContent='MIDI selection exported to '+name;});});this.clipTools.bar.append(this.midiSelectionExport);this.toolbar.append(this.importButton,this.midiExport);this.layout.topActions.append(this.cancelImport);this.layout.viewport.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files'))e.preventDefault();});this.layout.viewport.addEventListener('drop',e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();e.stopPropagation();if(e.dataTransfer.files.length!==1){this.error(Error('Drop one media file at a time'));return;}const beat=this.layout.beatAt(e,this.layout.ruler),atBeat=this.layout.snap?Math.round(beat/this.layout.grid)*this.layout.grid:beat,trackId=e.target.closest('.ww-daw-arrangement-row')?.dataset.trackId;void this.run(()=>this.importer.import(e.dataTransfer.files[0],{atBeat,trackId}));});this.refreshControls();}
  armTrack(id){if(this.recorder.busy||this.player.playing)return;const track=this.snapshot.tracks.find(t=>t.id===id),arm=!track?.arm;this.controller.command('batch',{commands:this.snapshot.tracks.filter(t=>t.arm||t.id===id).map(t=>({type:'track.update',payload:{id:t.id,changes:{arm:t.id===id&&arm}}}))});this.selected=id;this.refresh();}
  buildRecordingControls(transport){
    this.record=action('Record DAW',()=>this.run(()=>this.recorder.start()));this.record.classList.add('ww-daw-record');this.record.setAttribute('aria-label','Record DAW');this.record.textContent='Record';
    this.arm=action('Arm selected DAW track',()=>this.armTrack(this.selected));
    this.arm.setAttribute('aria-label','Arm selected DAW track');
    this.recordSummary=el('p','ww-daw-record-summary');
    this.recordSummary.id='ww-daw-record-summary';
    this.recordSummary.setAttribute('aria-live','polite');
    this.record.setAttribute('aria-describedby',this.recordSummary.id);
    this.midiDestination=el('p','ww-muted ww-daw-midi-destination');
    this.layout.context.after(this.recordSummary,this.midiDestination);
    transport.prepend(this.record);
    this.countIn=el('select');this.countIn.setAttribute('aria-label','DAW count-in bars');for(const bars of [0,1,2,4])this.countIn.add(new Option(bars?'Count-in '+bars+' bar'+(bars===1?'':'s'):'No count-in',bars));this.countIn.value=this.recorder.settings.countIn;this.countIn.onchange=()=>{this.recorder.settings.countIn=Number(this.countIn.value);this.recorder.preferences();};
    this.click=this.field('DAW metronome','checkbox','',transport);
    this.click.parentElement.firstChild.textContent='Click';
    this.click.checked=!!this.recorder.settings.click;
    this.clickVolume=this.field('DAW metronome volume','range',Math.round(this.recorder.settings.clickLevel*100),transport);
    this.clickVolume.parentElement.firstChild.textContent='Click volume';
    this.clickVolume.className='ww-daw-click-volume';
    Object.assign(this.clickVolume,{min:0,max:100,step:1});
    const setClick=()=>{
      const volume=Number(this.clickVolume.value);
      this.clickVolume.setAttribute('aria-valuetext',volume+'%');
      this.recorder.settings.click=this.click.checked;
      this.recorder.settings.clickLevel=volume/100;
      this.recorder.preferences();
      this.player.setClick(this.recorder.clickSettings)?.catch(error=>this.error(error));
    };
    this.click.onchange=setClick;this.clickVolume.oninput=setClick;
    this.clickVolume.setAttribute('aria-valuetext',this.clickVolume.value+'%');
    this.player.setClick(this.recorder.clickSettings);
    transport.append(this.countIn);
    this.midiOffset=this.field('DAW MIDI offset ms','number',0,this.midiRouting);this.audioOffset=this.field('DAW audio offset ms','number',0,this.audioRouting);for(const [input,kind] of [[this.midiOffset,'midi'],[this.audioOffset,'audio']]){Object.assign(input,{min:-2000,max:2000,step:1});input.onchange=()=>{const value=Number(input.value);if(!Number.isFinite(value)||Math.abs(value)>2000){this.error(Error('Offset range: −2000 to 2000 ms'));return;}this.recorder.setOffset(kind,value);};}
    this.audioDevice=el('select');this.audioDevice.setAttribute('aria-label','DAW audio input device');this.audioDevice.append(new Option('Default audio input','default'),new Option('Synth output (internal)',SYNTH_INPUT));if(this.recorder.settings.deviceId!=='default'&&!this.recorder.synthInput)this.audioDevice.add(new Option('Saved audio input',this.recorder.settings.deviceId));this.audioDevice.value=this.recorder.settings.deviceId;this.audioDevice.onchange=()=>{this.recorder.releaseAudio();this.recorder.settings.deviceId=this.audioDevice.value;this.recorder.preferences();this.refreshControls();};
    this.audioInput=action('Enable DAW audio input',()=>this.run(async()=>{if(this.recorder.audioTrackId===this.selected){this.recorder.releaseAudio();this.monitor.updateMix();}else{await this.recorder.enableAudio();await this.refreshAudioDevices();}}));
    this.replaceTake=this.field('Replace selected DAW clip','checkbox','',this.inputPanel);this.replaceTake.checked=this.recorder.settings.replaceSelected!==false;this.replaceTake.onchange=()=>{this.recorder.settings.replaceSelected=this.replaceTake.checked;this.recorder.preferences();this.refreshRecordingSummary();};
    this.synthInputHint=el('p','ww-muted','Hear this source from the Synth. Playback and click stay outside the take.');
    this.returnToSynth=action('Route MIDI to Synth',()=>this.run(()=>this.monitor.disable()));
    const source=el('label','','Source');
    source.append(this.audioDevice);
    this.audioRouting.prepend(source,this.audioInput,this.synthInputHint,this.returnToSynth);
    this.takeDestination=el('p','ww-muted');
    this.inputPanel.prepend(this.arm);
    this.inputPanel.append(this.replaceTake.parentElement,this.takeDestination);
    this.takeRecovery=action('Recover interrupted take',()=>this.run(async()=>{const takes=await this.recorder.list();this.takeChoices.replaceChildren(...takes.map(t=>new Option(t.name+' · '+new Date(t.created).toLocaleString()+' · '+t.status,t.id)));this.takeConfirm.disabled=!takes.length;if(!takes.length)this.takeChoices.replaceChildren(new Option('No recoverable take checkpoints',''));this.takeDialog.showModal();}));this.toolbar.append(this.takeRecovery);
    this.takeDialog=el('dialog','ww-map-dialog');this.takeChoices=el('select');this.takeChoices.setAttribute('aria-label','DAW interrupted take');this.takeConfirm=action('Recover selected take checkpoint',()=>this.run(async()=>{if(!this.confirmDiscard())return;await this.recorder.recover(this.takeChoices.value);this.takeDialog.close();}));this.takeDialog.append(el('h2','','Recover a take and its original project snapshot'),this.takeChoices,this.takeConfirm,action('Cancel take recovery',()=>this.takeDialog.close()));document.body.append(this.takeDialog);this.refreshControls();
  }
  async refreshAudioDevices(){const devices=await this.viewWindow.navigator.mediaDevices.enumerateDevices();this.audioDevice.replaceChildren(new Option('Default audio input','default'),new Option('Synth output (internal)',SYNTH_INPUT),...devices.filter(d=>d.kind==='audioinput'&&d.deviceId!=='default').map((d,i)=>new Option(d.label||'Audio input '+(i+1),d.deviceId)));this.audioDevice.value=this.recorder.settings.deviceId;if(!this.audioDevice.value)this.audioDevice.value='default';}
  error(error){this.status.textContent=error.name==='AbortError'?'File operation cancelled':error.message;}
  async run(task){if(this.busy)return;this.busy=true;this.refreshControls();try{await task();}catch(error){this.error(error);this.layout?.render();}finally{this.busy=false;this.refreshControls();this.assetRetention.schedule();}}
  edit(type,payload){if(this.recorder?.busy||this.importer?.busy||this.audition?.busy||this.audioExport?.exporter.busy){this.error(Error('Finish recording before editing the project'));return;}try{const keys=Object.keys(payload.changes||payload),mergeKey=keys.length===1&&['volume','pan'].includes(keys[0])?type+':'+(payload.id||'master')+':'+keys[0]:undefined;this.controller.command(type,payload,{mergeKey});}catch(error){this.error(error);this.refresh();}}
  confirmDiscard(){return !this.controller.dirty||this.viewWindow.confirm('Discard unsaved DAW changes? Save a project file first to keep them.');}
  attach(controller){
    this.unsubscribe?.();this.controller=controller;this.snapshot=controller.snapshot();this.cursor=0;this.selected=this.snapshot.tracks[0]?.id||null;this.selectedClip=null;this.selectedNote=null;this.clearClipSelection=false;if(this.clipTools){this.clipTools.selected.clear();if(this.clipTools.clipboard?.projectId!==this.snapshot.id)this.clipTools.clipboard=null;}
    this.unsubscribe=controller.subscribe(event=>{this.assetRetention.schedule();this.refresh(event);try{if(!this.player.exporting)this.player.updateMix(this.snapshot);}catch(error){this.error(error);}});
    this.auto=new RecoveryAutosave(controller,this.files,{onStatus:s=>{if(s.state!=='saving')this.assetRetention.schedule();this.recoveryStatus.textContent=s.state==='saved'?'Recovery copy updated':s.state==='saving'?'Updating recovery copy':'Recovery failed: '+s.message;}});this.refresh();
  }
  async adopt(loaded,prepare=()=>{}){
    let owned=false;
    try{
      if(this.recorder?.busy)throw Error('Finish recording before opening another project');
      const next=new ProjectController(loaded.project,loaded.assets),result=prepare(next);
      await this.audition?.release();this.recorder?.releaseAudio();
      await this.monitor?.disable();await this.player.stop(true);await this.player.reset();await this.auto.close();
      this.assetRetention.hold(loaded.assets,loaded.dispose);owned=true;
      this.attach(next);
      this.status.textContent=loaded.warnings?.join(' ')||'Project ready';
      return result;
    }catch(error){
      if(!owned)await loaded.dispose().catch(()=>{});
      throw error;
    }
  }
  instrumentOptions(label){
    return [new Option(label,''),new Option('Mellotron · loaded banks','mellotron'),...this.programs.map(program=>new Option(program.number+' · '+program.name,String(program.number-1))),
      ...this.drumKits.map(kit=>new Option('DRUM-X · '+kit.name,'drum:'+kit.kit))];
  }
  async selectInstrument(id,value){
    if(value==='')return;
    if(value==='mellotron'){
      const tape=this.bridge.tapeSnapshot?.();
      if(!tape)throw Error('Open Mellotron in Performance and load both banks first.');
      const instrument=await this.player.tapeInstrument(tape);
      this.controller.command('track.update',{id,changes:{instrument}});
      return;
    }
    const sound=value.startsWith('drum:')?await this.player.drumKit(Number(value.slice(5))):await this.player.tone(Number(value));
    if(sound.engine<0)throw Error('This sound is not supported');
    this.controller.command('track.update',{id,changes:{instrument:{type:sound.engine===2?'drumx':sound.patch[0]===4?'super':'analog',patch:sound.patch}}});
  }
  selectedTrack(){return this.snapshot.tracks.find(t=>t.id===this.selected);}
  playProject(){
    if(this.audition?.busy||this.importer?.busy||this.recorder?.busy||this.audioExport?.exporter.busy)throw Error('Finish the current recording, import or piano audition before Play');const p=this.snapshot,transport=p.transport||{loop:false,start:0,end:p.length},end=beatFrame(arrangementBeats(p),p),loopStart=beatFrame(transport.start/PPQ,p),loopEnd=beatFrame(transport.end/PPQ,p);let fromFrame=this.cursor||0;
    if(transport.loop&&(fromFrame<loopStart||fromFrame>=loopEnd))fromFrame=loopStart;else if(!transport.loop&&fromFrame>=end)fromFrame=0;
    return this.player.start(this.controller,{fromFrame,loop:transport.loop,loopStart,loopEnd});
  }
  seek(frame){if(this.recorder?.busy||this.importer?.busy||this.audition?.busy)return;return this.run(async()=>{if(!Number.isSafeInteger(frame)||frame<0)throw Error('Invalid seek position');const resume=this.player.playing;await this.player.capture(this.controller);if(resume)await this.player.stop();this.cursor=Math.min(frame,Math.max(0,beatFrame(arrangementBeats(this.snapshot),this.snapshot)-1));this.paintPosition();if(resume)await this.playProject();});}
  changeTransport(changes){if(this.recorder?.busy||this.importer?.busy||this.audition?.busy)return;return this.run(async()=>{const p=this.controller.snapshot(),transport={...(p.transport||{loop:false,start:0,end:p.length}),...changes};validateProject({...p,transport});if(transport.loop&&(beatFrame((transport.end-transport.start)/PPQ,p)<128||beatFrame(transport.end/PPQ,p)>RATE*1200))throw Error('Choose a loop of at least 128 frames within the 20-minute playback range');const resume=this.player.playing;await this.player.capture(this.controller);if(resume)await this.player.stop();this.controller.command('project.update',{transport});if(resume)await this.playProject();});}
  paintPosition(){this.position.textContent=this.layout?.prefs.ruler==='time'?secondsPosition((this.cursor||0)/RATE):musicalPosition(frameBeat(this.cursor||0,this.snapshot),this.snapshot);this.layout?.position(this.cursor||0);this.layout?.windows.status();}
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
    const instrument=el('select');instrument.setAttribute('aria-label','DAW instrument preset');instrument.onchange=()=>this.run(()=>this.selectInstrument(track.id,instrument.value));
    const volume=el('input');volume.type='range';Object.assign(volume,{min:0,max:2,step:.01});volume.setAttribute('aria-label','DAW track volume');volume.oninput=()=>this.edit('track.update',{id:track.id,changes:{volume:Number(volume.value)}});
    const pan=el('input');pan.type='range';Object.assign(pan,{min:-1,max:1,step:.01});pan.setAttribute('aria-label','DAW track pan');pan.oninput=()=>this.edit('track.update',{id:track.id,changes:{pan:Number(pan.value)}});
    volume.onchange=pan.onchange=()=>this.controller.endCoalescing();
    const mute=action('Mute track',()=>this.edit('track.update',{id:track.id,changes:{mute:!this.snapshot.tracks.find(t=>t.id===track.id).mute}})),solo=action('Solo track',()=>this.edit('track.update',{id:track.id,changes:{solo:!this.snapshot.tracks.find(t=>t.id===track.id).solo}}));
    const meter=el('meter','ww-daw-mixer-meter');
    Object.assign(meter,{min:0,max:1,value:0});
    meter.setAttribute('aria-label','Track peak · '+track.name);
    const remove=action('Remove track',()=>this.edit('track.remove',{id:track.id}));node.append(identity,instrument,meter,volume,pan,mute,solo,remove);this.rows.set(track.id,{node,choose,name,instrument,meter,volume,pan,mute,solo,remove,library:null});return this.rows.get(track.id);
  }
  refresh(event){
    if(!this.controller)return;this.snapshot=this.controller.snapshot();const p=this.snapshot;if(!p.tracks.some(t=>t.id===this.selected))this.selected=p.tracks[0]?.id||null;
    if(this.name.ownerDocument.activeElement!==this.name)this.name.value=p.name;if(this.tempo.ownerDocument.activeElement!==this.tempo)this.tempo.value=p.bpm;if(this.length.ownerDocument.activeElement!==this.length)this.length.value=p.length/PPQ;
    this.dirty.textContent=this.controller.dirty?'Unsaved changes':this.files.handle?'Saved · '+this.files.handle.name:'New project';this.masterValue.textContent=db(p.master.volume);if(this.master.ownerDocument.activeElement!==this.master)this.master.value=p.master.volume;
    this.studioCompatibility.hidden=!p.legacy?.studio;
    for(const [id,row] of this.rows)if(!p.tracks.some(t=>t.id===id)){row.node.remove();this.rows.delete(id);}
    p.tracks.forEach((t,i)=>{const row=this.rows.get(t.id)||this.row(t);if(this.trackList.children[i]!==row.node)this.trackList.insertBefore(row.node,this.trackList.children[i]||null);row.node.classList.toggle('is-selected',this.selected===t.id);row.choose.setAttribute('aria-pressed',String(this.selected===t.id));
      if(row.name.ownerDocument.activeElement!==row.name)row.name.value=t.name;if(row.volume.ownerDocument.activeElement!==row.volume)row.volume.value=t.volume;if(row.pan.ownerDocument.activeElement!==row.pan)row.pan.value=t.pan;row.volume.title=db(t.volume);row.pan.title=t.pan.toFixed(2);row.mute.setAttribute('aria-pressed',String(t.mute));row.solo.setAttribute('aria-pressed',String(t.solo));
      row.meter.setAttribute('aria-label','Track peak · '+t.name);
      const label=patchName(t.instrument?.patch);if(row.library!==this.programs||row.kits!==this.drumKits||row.sound!==label){row.instrument.replaceChildren(...this.instrumentOptions(label));row.library=this.programs;row.kits=this.drumKits;row.sound=label;row.instrument.value='';}row.instrument.hidden=t.type!=='midi';
    });
    if(!event||!['track.update','project.update','master.update'].includes(event.type)&&event.kind!=='saved')this.refreshEditor();this.refreshControls();this.layout?.render(event);this.clipTools?.refresh();this.editors?.refresh();this.mix?.refresh();void this.monitor?.refresh();
  }
  refreshEditor(){
    const track=this.selectedTrack(),clips=this.snapshot.clips.filter(c=>c.trackId===track?.id&&c.type==='midi');if(track?.type==='midi'){if(!clips.some(c=>c.id===this.selectedClip))this.selectedClip=this.clearClipSelection?null:clips[0]?.id||null;}else if(!this.snapshot.clips.some(c=>c.id===this.selectedClip&&c.trackId===track?.id))this.selectedClip=null;
    const c=this.clip();
    if(!c?.notes?.some(n=>n.id===this.selectedNote))this.selectedNote=this.editors?null:c?.notes?.[0]?.id||null;
    this.notes.replaceChildren(...(c?.notes||[]).map(n=>new Option(`MIDI ${n.pitch} · beat ${(n.start/PPQ+1).toFixed(2)} · ${n.duration/PPQ} beats · vel ${n.velocity}`,n.id)));this.notes.value=this.selectedNote||'';this.inspectNote();this.refreshControls();
  }
  inspectNote(){const n=this.clip()?.notes?.find(n=>n.id===this.selectedNote);if(n){this.pitch.value=n.pitch;this.velocity.value=n.velocity;this.start.value=n.start/PPQ+1;this.duration.value=n.duration/PPQ;}}
  refreshControls(){
    if(!this.controller)return;const recording=!!this.recorder?.busy,fileLocked=this.busy||recording||this.importer?.busy,locked=fileLocked||this.audition?.busy||this.player.playing||this.monitor?.preparing,track=this.selectedTrack();
    for(const b of [this.newButton,this.openButton,this.saveButton,this.saveAsButton,this.recoverButton,this.takeRecovery].filter(Boolean))b.disabled=fileLocked;this.undo.disabled=fileLocked||!this.controller.canUndo||this.player.playing;this.redo.disabled=fileLocked||!this.controller.canRedo||this.player.playing;
    this.play.disabled=fileLocked||this.audition?.busy||this.player.playing||!this.running;this.stop.disabled=!recording&&!this.audition?.busy&&!this.player.playing&&!this.player.starting;this.tempo.disabled=locked;this.length.disabled=locked;this.addMidi.disabled=locked||this.snapshot.tracks.length>=32;this.master.disabled=this.busy;
    for(const [id,row] of this.rows){const auto=target=>this.player.playing&&this.snapshot.automation.some(l=>l.enabled&&l.trackId===id&&l.target===target&&l.points.length);row.name.disabled=locked;row.instrument.disabled=locked||!this.running;row.remove.disabled=locked;row.volume.disabled=this.busy||auto('volume');row.pan.disabled=this.busy||auto('pan');row.mute.disabled=this.busy;row.solo.disabled=this.busy;}
    for(const field of [this.notes,this.pitch,this.velocity,this.start,this.duration,this.addNote,this.applyNote,this.deleteNote])field.disabled=locked||track?.type!=='midi';
    this.applyNote.disabled=locked||!this.selectedNote;this.deleteNote.disabled=locked||!this.selectedNote;
    this.layout?.controls();this.clipTools?.refresh();this.audioExport?.refresh(locked);this.editors?.controls();this.mix?.refresh();if(this.importButton){this.importButton.disabled=locked;this.midiExport.disabled=fileLocked||!this.snapshot.clips.some(c=>c.type==='midi');this.midiSelectionExport.disabled=fileLocked||!this.snapshot.clips.some(c=>c.type==='midi'&&this.clipTools.selected.has(c.id));this.cancelImport.hidden=!this.importer.busy;}
    if(this.record)this.refreshRecordingControls(locked,fileLocked);
  }
  refreshRecordingControls(locked,fileLocked){
    const track=this.selectedTrack(),recorder=this.recorder,midi=track?.type==='midi',audio=track?.type==='audio';
    this.inputPanel.hidden=!track;
    this.midiRouting.hidden=!midi;
    this.audioRouting.hidden=!audio;
    this.arm.disabled=locked||!track;
    this.arm.setAttribute('aria-pressed',String(!!track?.arm));
    this.arm.textContent=track?.arm?'Disarm track':'Arm track';
    for(const control of [this.countIn,this.midiOffset,this.audioOffset,this.audioDevice,this.replaceTake])control.disabled=fileLocked;
    this.click.disabled=this.clickVolume.disabled=this.busy||!!this.audioExport?.exporter.busy;
    this.audioInput.hidden=recorder.synthInput;
    this.synthInputHint.hidden=!recorder.synthInput;
    this.returnToSynth.hidden=!recorder.synthInput||!this.monitor.enabled;
    this.returnToSynth.disabled=locked;
    this.inputMode.parentElement.hidden=audio&&recorder.synthInput;
    this.audioOffset.parentElement.hidden=recorder.synthInput;
    this.audioInput.disabled=locked||!this.running;
    this.audioInput.textContent=recorder.audioTrackId===track?.id?'Disable DAW audio input':'Enable DAW audio input';
    this.midiOffset.value=recorder.offset('midi');
    this.audioOffset.value=recorder.offset('audio');
    this.inputToggle.textContent=this.monitor.enabled?'Disable DAW MIDI input':'Enable DAW MIDI input';
    this.inputToggle.disabled=fileLocked||this.monitor.preparing||!this.running||!midi&&!this.monitor.enabled;
    this.inputMode.disabled=fileLocked||!track;
    this.inputMode.value=track?.monitor||'off';
    this.inputChannel.disabled=fileLocked;
    this.refreshRecordingSummary();
  }
  refreshRecordingSummary(){
    if(!this.recordSummary)return;
    const {track,replace,internal}=this.recorder.intent(),input=this.bridge.midi.input;
    const route=this.monitor.enabled&&this.monitor.track()?.type==='midi'?this.monitor.track().name:'Synth';
    const routeText='MIDI → '+route+(input?'':' · no controller selected');
    if(this.inputStatus.textContent!==routeText)this.inputStatus.textContent=routeText;
    if(this.midiDestination.textContent!==routeText)this.midiDestination.textContent=routeText;
    const source=internal?'Synth output':track?.type==='audio'?(this.audioDevice.selectedOptions[0]?.textContent||'Audio input'):
      (input?.name||'MIDI input')+(this.monitor.channel===null?'':' · Ch '+(this.monitor.channel+1));
    const destination=replace?'Replace “'+replace.name+'”':'New clip';
    const state=this.recorder.state;
    const labels={preparing:'Preparing', 'count-in':this.recorder.settings.countIn?'Count-in':'Starting',
      recording:'Recording', finalizing:'Finishing', idle:'Record'};
    const label=labels[state];
    const blocker=!this.running?'Start audio':!track?'Arm a track with R':track.type==='midi'&&!track.instrument?
      'Choose an instrument in the Track inspector':internal&&this.monitor.enabled?'Route MIDI to Synth in the Track inspector':
      track.type==='midi'&&!input?'Choose a controller in Settings':'';
    const busy=this.recorder.busy;
    const details=track?track.name+' · '+source+' · '+destination:'';
    const text=[details,busy?'':blocker].filter(Boolean).join(' · ');
    if(this.recordSummary.textContent!==text)this.recordSummary.textContent=text;
    this.recordSummary.dataset.state=state;
    this.record.dataset.state=state;
    this.record.textContent=label;
    this.record.setAttribute('aria-pressed',String(state==='recording'));
    this.record.disabled=busy||this.busy||this.importer?.busy||this.audition?.busy||this.player.playing||this.player.starting||
      this.monitor.preparing||this.audioExport?.exporter.busy||!!blocker;
    if(this.takeDestination.textContent!==destination)this.takeDestination.textContent=destination;
  }

  transportState(state){
    if(!state.playing&&!state.preparing)this.assetRetention.schedule();
    const changed=this.player.playing!==state.playing||this.transportPlaying!==state.playing;this.player.playing=state.playing;this.transportPlaying=state.playing;if(!state.preparing&&Number.isFinite(state.frame))this.cursor=state.frame;this.paintPosition();
    if(this.recorder?.busy&&this.recorder.state!=='preparing'){this.refreshControls();if(!state.playing&&state.reason&&state.reason!=='replaced'&&!this.recorder.stopping)void this.recorder.stop(state.reason==='ended'?'arrangement-end':state.reason);return;}
    if(state.preparing)this.status.textContent='Preparing playback';else if(state.playing&&(changed||state.reason==='started'))this.status.textContent='Playing project';else if(!state.playing&&state.reason)this.status.textContent=state.reason==='ended'?'Playback finished':'Playback stopped · '+state.reason;if(changed||state.preparing||state.reason){this.refreshControls();void this.monitor?.refresh();}
  }
  async showRecovery(){const copies=await this.files.listRecovery();this.recoveryChoices.replaceChildren(...copies.map(c=>new Option(c.name+' · '+new Date(c.modified).toLocaleString(),c.id)));this.recoveryConfirm.disabled=!copies.length;if(!copies.length)this.recoveryChoices.replaceChildren(new Option('No recovery copies in this browser',''));this.recoveryDialog.showModal();}
  receive(message){
    if(message.t==='ready'){this.audioExport?.exporter.cancel(Error('Instrument restarted during export'));if(this.recorder?.busy)void this.recorder.stop('instrument-reboot');else this.recorder?.releaseAudio();this.monitor?.invalidate();this.player.invalidateBinding();this.running=!!message.audio;this.refreshControls();if(this.running){
      const node=this.bridge.getAudio().node;
      void this.player.drumKits().then(kits=>{if(this.bridge.getAudio().node===node&&this.running){this.drumKits=kits;this.refresh({kind:'saved'});}}).catch(()=>{});
    }}
    if(message.t==='frame'){this.frame=message;if(message.programLibrary){this.programs=message.programLibrary;this.refresh({kind:'saved'});}if(!this.node.hidden||this.layout?.windows.has('mixer'))this.layout?.meters();else if(this.layout?.windows.has('effects'))this.mix?.meters();}
    if(message.t==='daw-notice')this.status.textContent=message.message;
    if(message.t==='daw-instruments-changed'&&message.projectId===this.controller.snapshot().id){if(this.player.synchronize(this.controller,message.changes))this.status.textContent='Live instrument edits updated the project';}
    if(message.t==='error'){this.audioExport?.exporter.cancel(Error('Audio processor stopped during export'));if(this.recorder?.busy)void this.recorder.stop('processor-error');this.monitor?.invalidate();this.running=false;this.player.playing=false;this.refreshControls();}
    this.player.receive(message);
  }
}
