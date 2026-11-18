// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {PPQ,emptySequence,validateSequence,inputNotes,compileNotes,smf,musicalPosition} from './studio-sequence.js';
import {RATE,MAX_FRAMES} from './studio-format.js';
import {ArrangementEditor} from './ui-studio-arrangement.js';
import {LiveNotes} from './studio-live-notes.js';
import {AudioEditor} from './ui-studio-audio.js';
import {AutomationEditor} from './ui-studio-automation.js';
const pitch=n=>['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12]+(Math.floor(n/12)-1);
export class SequenceWorkspace {
  constructor(bridge,recorder){
    this.bridge=bridge;this.recorder=recorder;this.sequence=emptySequence();this.history=[];this.selected=null;this.playing=false;this.grid=PPQ/4;
    recorder.beforeReplace=()=>{this.replacing=true;if(this.playing||this.starting)this.stopMidi();};
    recorder.canReplace=()=>!this.starting&&!this.rendering&&!this.capture&&!this.arrangement?.overdub&&!this.audio?.busy&&!this.audio?.preparing;
    recorder.confirmReplace=()=>!this.hasWork()||confirm('Discard the current Studio project and open another? Save a project file first if you want to keep it. Live tones and MIDI mappings are preserved.');
    recorder.onInput=input=>{this.preview?.input(input);if(this.capture&&!this.previewDraw){this.previewDraw=true;requestAnimationFrame(()=>{this.previewDraw=false;this.draw();});}};
    recorder.newProject=()=>this.newProject();
    recorder.stopFromUI=()=>this.capture||this.arrangement?.overdub||this.rendering?this.stopTransport():recorder.stop();
    recorder.canApplyContext=()=>!this.playing&&!this.starting&&!this.legacyPlaying&&!this.bridge.isDawBusy?.();
    recorder.prepareProject=async()=>{if(!this.sequence.notes.length&&!this.sequence.clips?.length&&!this.sequence.audioClips?.length)return;if(this.bridge.getAudio().node)await this.storeProject();else if(recorder.take){recorder.take.project.sequence=structuredClone(this.sequence);this.audio.attach(recorder.take);}};
    const previous=recorder.onChange;recorder.onChange=r=>{previous(r);this.update({t:'studio-project'});};
    this.node=Panel('Studio arrangement','MIDI and audio clips · four instrument parts · current live timbres');this.node.classList.add('ww-sequence');
    this.status=el('p','ww-sequence-status','Ready · Record MIDI or draw notes in the piano roll.');this.status.setAttribute('role','status');
    const run=task=>void Promise.resolve().then(task).catch(error=>{this.status.textContent=error.message;});this.run=run;
    const tools=el('div','ww-studio-actions');
    this.play=action('Play',()=>run(()=>this.start()),'ww-primary');this.stop=action('Stop',()=>run(()=>this.stopTransport()));
    this.record=action('Record MIDI',()=>run(()=>this.recordMidi()),'ww-record');
    this.recordPart=el('select');this.recordPart.setAttribute('aria-label','Recording part');for(let p=0;p<4;p++)this.recordPart.add(new Option('Part '+'ABCD'[p],String(p)));
    this.recordPart.onchange=()=>{this.selected=null;this.part.value=this.recordPart.value;this.centerC3();this.draw();};
    this.load=action('Use take input notes',()=>run(()=>{if(!recorder.take)throw Error('Record or open a take first');const notes=inputNotes(recorder.take.project);if(!notes.notes.length)throw Error('No external MIDI note input in this take. Virtual controls remain in the recorded event list.');this.replace(notes);}));
    this.save=action('Save project',()=>run(async()=>{await this.storeProject();recorder.exportProject();}));
    this.export=action('Export MIDI',()=>run(()=>recorder.download(new Blob([smf(this.sequence)],{type:'audio/midi'}),'waswan-sequence.mid')));
    this.undo=action('Undo',()=>{if(this.history.length){const mix=this.sequence.tracks;this.sequence=this.history.pop();if(mix){this.sequence.tracks??=mix.map(t=>({...t,mute:false,solo:false}));for(let p=0;p<4;p++){this.sequence.tracks[p].level=mix[p].level;this.sequence.tracks[p].pan=mix[p].pan;}}if(!this.sequence.notes.some(n=>n.id===this.selected))this.selected=null;this.changed();}});
    this.render=action('Record arrangement',()=>run(()=>this.recordArrangement()));
    this.tail=el('input');this.tail.type='number';this.tail.min=0;this.tail.max=30;this.tail.value=2;this.tail.step=.5;this.tail.setAttribute('aria-label','Arrangement tail seconds');
    const tailLabel=el('label','','Tail seconds ');tailLabel.append(this.tail);
    tools.append(this.play,this.stop,this.load,this.save,this.export,this.undo,this.render,tailLabel);this.node.append(this.status,tools,el('p','ww-muted','Record arrangement captures one pass plus the chosen tail, including live input and existing effects. Monitoring mute and metronome are excluded. Save/export the resulting take in Studio.'));
    const settings=el('div','ww-sequence-settings');
    const number=(name,min,max,value,step=1)=>{const label=el('label','',name+' '),input=el('input');input.type='number';Object.assign(input,{min,max,value,step});input.setAttribute('aria-label',name);label.append(input);settings.append(label);return input;};
    this.bpm=number('Sequence BPM',40,240,120);this.length=number('Length in quarter beats',.25,4096,16,.25);
    this.meter=el('select');this.meter.setAttribute('aria-label','Time signature');for(const value of ['4/4','3/4','6/8'])this.meter.add(new Option(value,value));
    const meterLabel=el('label','','Meter ');meterLabel.append(this.meter);settings.append(meterLabel);
    const check=(name)=>{const label=el('label','',name+' '),input=el('input');input.type='checkbox';input.setAttribute('aria-label',name);label.append(input);settings.append(label);return input;};
    this.loop=check('Loop');this.click=check('Metronome');
    this.bpm.onchange=()=>this.edit(s=>s.bpm=Number(this.bpm.value));this.length.onchange=()=>this.edit(s=>s.length=Math.round(Number(this.length.value)*PPQ));
    this.meter.onchange=()=>this.edit(s=>s.meter=this.meter.value.split('/').map(Number));this.loop.onchange=()=>this.edit(s=>s.loop=this.loop.checked);
    this.node.append(settings,el('p','ww-muted','Click an empty grid cell to add a note; select a note to edit. Arrow keys move it; Delete removes it. Input import uses the part selected at recording start. Playback uses current part sounds and bypasses arp. Bend, modulation and sustain are replayed; mapped controls use applied automation. Recorded audio remains the original reference.'));
    this.scroll=el('div','ww-piano-scroll');this.canvas=el('canvas','ww-piano-roll');this.canvas.width=1152;this.canvas.height=128*12;this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','MIDI piano roll');this.scroll.append(this.canvas);this.node.append(this.scroll);
    this.canvas.onclick=e=>{
      if(this.playing||this.rendering)return;const box=this.canvas.getBoundingClientRect(),x=(e.clientX-box.left)*this.canvas.width/box.width,y=(e.clientY-box.top)*this.canvas.height/box.height;
      const tick=Math.max(0,Math.min(this.sequence.length-1,Math.floor(x/this.canvas.width*this.sequence.length))),note=Math.max(0,Math.min(127,127-Math.floor(y/12)));
      const found=this.sequence.notes.find(n=>n.part===Number(this.part.value)&&n.note===note&&tick>=n.start&&tick<n.start+n.duration);
      if(found){this.selected=found.id;this.inspector.open=true;this.draw();return;}
      const start=Math.floor(tick/this.grid)*this.grid,id=crypto.randomUUID();this.edit(s=>s.notes.push({id,part:Number(this.part.value),note,velocity:100,start,duration:Math.min(this.grid,s.length-start)}));this.selected=id;this.inspector.open=true;this.draw();
    };
    this.canvas.onkeydown=e=>{
      const n=this.sequence.notes.find(n=>n.id===this.selected);if(!n||this.playing)return;
      if(['Delete','Backspace'].includes(e.key)){e.preventDefault();this.remove();}
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();this.edit(s=>{const p=s.notes.find(p=>p.id===n.id);if(e.key==='ArrowUp')p.note=Math.min(127,p.note+1);if(e.key==='ArrowDown')p.note=Math.max(0,p.note-1);if(e.key==='ArrowLeft')p.start=Math.max(0,p.start-this.grid);if(e.key==='ArrowRight')p.start=Math.min(s.length-p.duration,p.start+this.grid);});}
    };
    const editor=el('div','ww-sequence-settings');
    this.part=el('select');this.part.setAttribute('aria-label','Note part');for(let part=0;part<4;part++)this.part.add(new Option('Part '+'ABCD'[part],String(part)));editor.append(this.part);
    const field=(name,min,max,value)=>{const label=el('label','',name+' '),input=el('input');input.type='number';Object.assign(input,{min,max,value});input.step='any';input.setAttribute('aria-label',name);label.append(input);editor.append(label);return input;};
    this.note=field('MIDI pitch',0,127,60);this.velocity=field('Note velocity',1,127,100);this.startBeat=field('Start beat',1,4097,1);this.duration=field('Duration in quarter beats',1/PPQ,4096,.25);
    this.apply=action('Apply note edit',()=>this.edit(s=>{const n=s.notes.find(n=>n.id===this.selected);if(!n)throw Error('Select a note first');Object.assign(n,{part:Number(this.part.value),note:Number(this.note.value),velocity:Number(this.velocity.value),start:Math.round((Number(this.startBeat.value)-1)*PPQ),duration:Math.round(Number(this.duration.value)*PPQ)});}));
    this.delete=action('Delete note',()=>this.remove());this.quantize=action('Quantize to 1/16',()=>this.edit(s=>{for(const n of s.notes){const c=s.clips?.find(c=>c.id===n.clip),start=c?.start||0,end=c?c.start+c.length:s.length;n.start=Math.min(end-1,start+Math.round((n.start-start)/this.grid)*this.grid);n.duration=Math.min(end-n.start,Math.max(this.grid,Math.round(n.duration/this.grid)*this.grid));}}));
    editor.append(this.apply,this.delete,this.quantize);this.node.append(editor);
    this.list=el('select','ww-note-list');this.list.size=5;this.list.setAttribute('aria-label','Sequence notes');this.list.onchange=()=>{this.selected=this.list.value;this.draw();};this.node.append(this.list);
    this.arrangement=new ArrangementEditor(this);this.node.insertBefore(this.arrangement.node,this.scroll);
    this.automation=new AutomationEditor(this);this.node.append(this.automation.node);
    this.audio=new AudioEditor(this);this.node.append(this.audio.node);
    this.composeLayout({settings,editor,tailLabel});this.pendingCenter=true;this.draw();
  }
  composeLayout({settings,editor,tailLabel}){
    const header=this.node.firstElementChild;
    this.node.replaceChildren(header);this.projectBar=el('div','ww-project-bar');
    this.newButton=action('New project',()=>this.run(()=>this.newProject()));
    const openLabel=el('span','ww-project-open');this.openProjectButton=action('Open project',()=>this.openFile.click());this.openFile=el('input');this.openFile.type='file';this.openFile.accept='.wsproj';this.openFile.setAttribute('aria-label','Open composition project');this.openFile.hidden=true;openLabel.append(this.openProjectButton,this.openFile);
    this.openFile.onchange=()=>{const file=this.openFile.files[0];if(file)this.run(()=>this.recorder.open(file));this.openFile.value='';};
    this.projectState=el('span','ww-muted','Untitled · empty');this.projectBar.append(this.newButton,openLabel,this.save,this.projectState);this.node.append(this.projectBar);
    this.transport=el('div','ww-seq-transport');const destination=el('label','','Record into ');destination.append(this.recordPart);
    this.transport.append(this.play,this.stop,this.record,destination);this.node.append(this.transport,settings,this.status);
    this.inputHint=el('p','ww-seq-hint','Connect a MIDI keyboard in Settings. Record MIDI adds notes to the selected destination; live sound follows your existing MIDI routing.');this.node.append(this.inputHint);
    const rollTools=el('div','ww-roll-tools');this.center=action('Center C3',()=>this.centerC3());this.clearNotes=action('Clear MIDI notes',()=>{if(!this.sequence.notes.length)return;if(confirm('Remove all MIDI notes and clips? Audio clips, automation and the recorded take are kept.'))this.edit(s=>{s.notes=[];s.clips=[];s.expression=[];delete s.expressionStart;});});
    this.emptyHint=el('span','ww-muted','Start with Record MIDI, or click the grid to draw notes.');rollTools.append(this.center,this.undo,this.clearNotes,this.emptyHint);this.node.append(rollTools);
    this.ruler=el('div','ww-piano-ruler');this.ruler.setAttribute('aria-label','Piano roll bar ruler');const rulerWindow=el('div','ww-ruler-window');rulerWindow.append(this.ruler);this.node.append(rulerWindow,this.scroll);this.scroll.addEventListener('scroll',()=>{this.ruler.style.transform=`translateX(${-this.scroll.scrollLeft}px)`;});
    this.scroll.setAttribute('aria-label','Piano roll viewport');
    const details=(title,...nodes)=>{const d=el('details','ww-seq-section'),summary=el('summary','',title);d.append(summary,...nodes);this.node.append(d);return d;};
    this.inspector=details('Note inspector',editor,this.list);
    this.list.addEventListener('change',()=>{this.inspector.open=true;});
    details('Tracks & clips',this.arrangement.node);
    details('Automation',this.automation.node);
    details('Audio clips',this.audio.node);
    const exports=el('div','ww-studio-actions');exports.append(this.load,this.export,this.render,tailLabel);
    const recovery=el('div','ww-studio-actions');recovery.append(this.audio.localSave,this.audio.localRecover);
    details('Export & recovery',exports,recovery,el('p','ww-muted','Record arrangement captures one pass plus the tail. Export the resulting WAV/MP3 from Studio. Use take input notes replaces the editable sequence; Save browser composition keeps a local copy.'));
    this.node.append(el('p','ww-muted','Piano roll: click to draw/select; arrow keys move a selected note; Delete removes it. C3 = MIDI 48. Capture preserves raw timing; Quantize is an explicit edit.'));
  }
  hasWork(){return !!this.recorder.take||!!this.audio?.assets.length||JSON.stringify(this.sequence)!==JSON.stringify(emptySequence());}
  async newProject(){
    if(this.recorder.busy||!this.recorder.canReplace())throw Error('Finish recording, loading or audio preparation before starting a new project');
    if(this.hasWork()&&!confirm('Start a new empty Studio project? The current composition, take and imported audio will be removed from this workspace. Save a project file first to keep them. Live tones and MIDI mappings are preserved.'))return false;
    if(this.playing||this.audio.source)this.stopMidi();
    this.sequence=emptySequence();this.history=[];this.selected=null;this.preview=null;this.capture=null;this.transportStartFrame=null;this.expectedStartFrame=null;this.position=0;this.dirty=false;
    this.scroll.scrollLeft=0;this.recordPart.value='0';this.part.value='0';this.click.checked=false;this.tail.value='2';this.replacing=false;
    this.audio.adopt(null);this.arrangement.overdub=null;this.automation.selectedTick=null;this.automation.target.value='part:0:cutoff';this.note.value='48';this.velocity.value='100';this.startBeat.value='1';this.duration.value='.25';this.audio.status.textContent='Import WAV audio or use a recorded take. Sources are preserved by clip edits.';this.recorder.clearProject();this.take=null;
    this.status.textContent='New project · choose a destination and Record MIDI';this.centerC3();this.draw();return true;
  }
  centerC3(){this.pendingCenter=true;this.applyCenter();}
  applyCenter(){if(this.pendingCenter&&!this.node.hidden&&this.scroll.clientHeight>0){this.scroll.scrollTop=(127-48)*12+6-this.scroll.clientHeight/2;this.pendingCenter=false;}}
  async recordMidi(destination=Number(this.recordPart.value)){
    if(this.capture||this.playing||this.starting||this.recorder.busy||this.audio.busy)throw Error('Stop the current transport before recording MIDI');
    const part=destination;this.recordPart.value=String(part);this.selected=null;this.capture={part,phase:'Preparing'};this.preview=new LiveNotes(part);this.part.value=String(part);this.centerC3();this.draw();
    try{await this.arrangement.startOverdub(part);this.capture.phase='Recording';this.capture.start=this.arrangement.overdub.start;this.draw();}
    catch(error){this.capture=null;this.preview=null;this.draw();throw error;}
  }
  async stopTransport(){
    if(this.capture?.phase==='Preparing'){this.capture.phase='Finalizing';this.stopMidi();this.recorder.stop();this.draw();return;}
    if(this.arrangement.overdub){if(this.capture?.phase==='Finalizing')return;if(this.capture)this.capture.phase='Finalizing';this.draw();try{await this.arrangement.finishOverdub();}finally{this.capture=null;this.preview=null;this.draw();}}
    else{this.stopMidi();if(this.rendering)this.recorder.stop();}
  }
  edit(change,allowPlaying=false){
    if((this.playing||this.rendering||this.starting||this.capture)&&!allowPlaying)return;
    try{const next=structuredClone(this.sequence);change(next);this.replace(validateSequence(next),allowPlaying);}catch(error){this.status.textContent=error.message;this.draw();}
  }
  replace(next,allowPlaying=false){
    if(this.playing&&!allowPlaying)throw Error('Stop MIDI before replacing notes');
    validateSequence(next);this.history.push(this.sequence);if(this.history.length>16)this.history.shift();this.sequence=structuredClone(next);this.changed();
  }
  changed(){
    if(this.recorder.take)this.recorder.take.project.sequence=structuredClone(this.sequence);
    this.dirty=true;this.status.textContent=`${this.sequence.notes.length} notes · MIDI edits are separate from the recorded audio`;
    this.draw();
  }
  remove(){this.edit(s=>s.notes=s.notes.filter(n=>n.id!==this.selected));this.selected=null;this.draw();}
  async storeProject(){
    if(!this.bridge.getAudio().node&&this.recorder.take){this.recorder.take.project.sequence=structuredClone(this.sequence);this.audio.attach(this.recorder.take);this.take=this.recorder.take;return;}
    this.saving=true;
    try{await this.recorder.ensureProject(this.sequence);this.recorder.take.project.sequence=structuredClone(this.sequence);this.audio.attach(this.recorder.take);this.take=this.recorder.take;}
    finally{this.saving=false;}
  }
  async start(allowEmpty=false,onePass=false){
    if(this.bridge.isDawBusy?.())throw Error('Stop DAW before starting Studio');
    if(this.legacyPlaying)throw Error('Stop the Legacy sequencer before playing Studio MIDI');
    if(this.frame?.midiMode)throw Error('Return to synth mode in Legacy SMK before playing MIDI');
    const {context,node,gain}=this.bridge.getAudio();if(!context||!node)throw Error('Start audio before playing MIDI');
    if(this.starting||this.playing)throw Error('Studio transport is already preparing or playing');
    const data=compileNotes(this.sequence);if(!data.events.length&&!data.automation.length&&!data.expression.length&&!this.sequence.audioClips?.length&&!allowEmpty)throw Error('Add notes or automation first');if(onePass)data.loop=false;
    const token=(this.startToken||0)+1;this.startToken=token;this.expectedStartFrame=null;this.starting=true;this.draw();
    try{
    await context.resume();
    const audioBuffer=await this.audio.prepare(context);if(audioBuffer)data.duration=data.length;
    if(this.click.checked){
      if(!this.metronome){await context.audioWorklet.addModule(new URL('./studio-metronome.js',import.meta.url));this.metronome=new AudioWorkletNode(context,'waswan-studio-metronome',{numberOfInputs:0,outputChannelCount:[2]});this.metronome.connect(gain);}
    }
    if(this.startToken!==token)throw Error('Studio start cancelled');
    const startFrame=Math.ceil((context.currentTime*RATE+2048)/128)*128;
    this.expectedStartFrame=startFrame;this.audio.play(context,gain,audioBuffer,startFrame,data.loop);
    node.port.postMessage({t:'studio-sequence-start',data,startFrame});
    if(this.click.checked)this.metronome.port.postMessage({t:'start',bpm:this.sequence.bpm,meter:this.sequence.meter,startFrame});
    return startFrame;
    }finally{if(this.startToken===token)this.starting=false;this.draw();}
  }
  async recordArrangement(){
    const r=this.recorder;if(this.playing||r.busy||this.rendering)throw Error('Stop the current transport before recording the arrangement');
    const data=compileNotes(this.sequence),tail=Number(this.tail.value);
    if(!Number.isFinite(tail)||tail<0||tail>30||data.length+Math.round(tail*RATE)+4096>MAX_FRAMES)throw Error('Arrangement plus tail and recording lead-in exceeds the recording limit');
    this.rendering={length:data.length,tail:Math.round(tail*RATE)};this.draw();
    try{await r.start();while(r.state==='starting')await new Promise(requestAnimationFrame);if(r.state!=='recording')throw Error(r.message);const start=await this.start(true,true);if(start-r.firstFrame+this.rendering.length+this.rendering.tail>MAX_FRAMES)throw Error('Recording lead-in exceeds the available duration');r.stopAtFrame(start+this.rendering.length+this.rendering.tail);}
    catch(error){this.rendering=null;this.stopMidi();if(r.state==='recording')r.stop('arrangement-start-error');this.draw();throw error;}
  }
  stopMidi(){this.startToken=(this.startToken||0)+1;this.starting=false;this.audio?.stop();this.bridge.getAudio().node?.port.postMessage({t:'studio-sequence-stop'});this.metronome?.port.postMessage({t:'stop'});}
  update(m){
    this.arrangement?.update(m);
    if(m.t==='frame'){this.frame=m;this.legacyPlaying=!!m.instrument?.playing;if(this.playing&&this.legacyPlaying)this.stopMidi();}
    if(m.t==='studio-sequence-state'){
      if((this.starting&&this.expectedStartFrame===null)||(m.startFrame!==undefined&&this.expectedStartFrame!=null&&m.startFrame!==this.expectedStartFrame))return;
      this.playing=m.playing;this.position=m.frame;this.status.textContent=m.error||`${m.playing?'Playing':'Stopped'} · ${musicalPosition(m.frame,this.sequence)} · bars : beats : ticks${m.cycle?' · loop '+(m.cycle+1):''}`;
      if(m.reason==='started'){this.transportStartFrame=m.startFrame;if(this.rendering)this.recorder.stopAtFrame(m.startFrame+this.rendering.length+this.rendering.tail);}
      if(['instrument-unavailable','automation-unavailable','expression-unavailable'].includes(m.reason)){this.status.textContent='Studio stopped · check the part engine and finish any pending tone operation';if(this.rendering)this.recorder.stop('arrangement-playback-error');}
      if(m.playing&&m.reason==='started'&&this.click.checked)this.metronome?.port.postMessage({t:'start',bpm:this.sequence.bpm,meter:this.sequence.meter,startFrame:m.startFrame});
      if(!m.playing){this.audio?.stop();this.metronome?.port.postMessage({t:'stop'});}this.draw();
    }
    if(m.t==='error'){this.audio?.stop();this.playing=false;this.metronome?.port.postMessage({t:'stop'});this.draw();}
    const take=this.recorder.take;
    if(take!==this.take){this.take=take;if(this.replacing&&!this.saving){try{this.sequence=structuredClone(validateSequence(take?.project.sequence||emptySequence(take?.project.context.tempo)));this.selected=null;this.history=[];this.preview=null;this.dirty=false;this.audio.adopt(take);this.replacing=false;this.draw();}catch(error){this.status.textContent=error.message;}}}
    if(m.t==='ready'||m.t==='frame'&&this.controlsReady!==!!this.bridge.getAudio().node){this.controlsReady=!!this.bridge.getAudio().node;this.draw();}
    if(m.t==='studio-project'){if(this.capture?.phase==='Recording'&&['ready','error'].includes(this.recorder.state))this.run(()=>this.stopTransport());if(this.rendering&&['ready','error'].includes(this.recorder.state))this.rendering=null;this.draw();}
  }
  draw(){
    this.applyCenter();
    this.audio?.draw();
    this.arrangement?.draw();
    this.automation?.draw();
    const s=this.sequence,n=s.notes.find(n=>n.id===this.selected);this.bpm.value=s.bpm;this.length.value=s.length/PPQ;this.meter.value=s.meter.join('/');this.loop.checked=s.loop;
    this.stop.disabled=(!this.playing&&!this.starting&&!this.arrangement?.overdub&&!this.rendering&&!this.capture)||!!this.capture&&this.capture.phase==='Finalizing';this.play.disabled=this.playing||this.starting||!!this.capture||this.recorder.busy||!this.bridge.getAudio().node;this.undo.disabled=this.playing||this.starting||!!this.capture||!this.history.length;
    const locked=this.recorder.busy||!this.recorder.canReplace();
    if(this.newButton){this.newButton.disabled=locked;this.openFile.disabled=locked;this.openProjectButton.disabled=locked;this.record.disabled=locked||this.playing||!this.bridge.getAudio().node;this.recordPart.disabled=locked||this.playing;this.clearNotes.disabled=locked||this.playing||!s.notes.length;this.projectState.textContent=(this.recorder.take?.project.name||'Untitled')+(this.dirty?' · composition edited':this.hasWork()?' · project in workspace':' · empty');this.emptyHint.hidden=!!s.notes.length||!!this.capture;
      if(this.capture)this.status.textContent=`${this.capture.phase} MIDI · Part ${'ABCD'[this.capture.part]} · ${this.preview?.count||0} notes${this.capture.phase==='Recording'?' · press Stop to finish':'…'}`;
    }
    this.save.disabled=locked;
    this.render.disabled=this.playing||this.starting||this.recorder.busy||!!this.rendering||!this.bridge.getAudio().node;this.tail.disabled=!!this.rendering;
    for(const input of [this.bpm,this.length,this.meter,this.loop,this.click,this.load,this.apply,this.delete,this.quantize,this.part,this.note,this.velocity,this.startBeat,this.duration])input.disabled=this.playing||this.starting||!!this.rendering||!!this.capture;
    if(n){this.part.value=n.part;this.note.value=n.note;this.velocity.value=n.velocity;this.startBeat.value=1+n.start/PPQ;this.duration.value=n.duration/PPQ;}
    this.apply.disabled=this.playing||this.starting||!!this.rendering||!!this.capture||!n;this.delete.disabled=this.apply.disabled;
    if(this.listSequence!==s){this.listSequence=s;this.list.replaceChildren();for(const note of s.notes)this.list.add(new Option(`Part ${'ABCD'[note.part]} · ${pitch(note.note)} · beat ${(1+note.start/PPQ).toFixed(2)} · velocity ${note.velocity}`,note.id));}
    this.list.value=this.selected||'';
    if(this.node.hidden)return;
    const now=this.bridge.getAudio().context?.currentTime*RATE||0,live=this.preview?.view(this.capture?.start,now,s)||[],displayLength=Math.max(s.length,...live.map(n=>n.start+n.duration));
    const c=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height;c.fillStyle='#0a0f12';c.fillRect(0,0,w,h);
    for(let note=0;note<128;note++){const y=(127-note)*12;c.fillStyle=note===48?'#1c3c42':[1,3,6,8,10].includes(note%12)?'#101a20':'#18252b';c.fillRect(0,y,w,12);if(note%12===0){c.fillStyle=note===48?'#27e3dd':'#a9b8bf';c.font=note===48?'bold 11px sans-serif':'10px sans-serif';c.fillText(pitch(note),2,y+10);}}
    const gridStep=Math.max(this.grid,Math.ceil(displayLength/this.grid/512)*this.grid);
    c.strokeStyle='#34454d';for(let tick=0;tick<=displayLength;tick+=gridStep){const x=tick/displayLength*w;c.globalAlpha=tick%PPQ===0?.8:.3;c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}c.globalAlpha=1;
    for(const note of s.notes){c.fillStyle=note.id===this.selected?'#fff':['#27e3dd','#58a6ff','#d8b4fe','#facc15'][note.part];c.fillRect(note.start/displayLength*w,(127-note.note)*12+1,Math.max(2,note.duration/displayLength*w),10);}
    for(const note of live){c.fillStyle='#ffad7d';c.fillRect(note.start/displayLength*w,(127-note.note)*12+1,Math.max(2,note.duration/displayLength*w),10);}
    if(this.ruler){const bar=PPQ*4/s.meter[1]*s.meter[0],count=Math.ceil(displayLength/bar),step=Math.max(1,Math.ceil(count/16)),key=`${displayLength}/${bar}`;if(this.rulerKey!==key){this.rulerKey=key;this.ruler.replaceChildren();for(let b=0;b<count;b+=step){const label=el('span','',String(b+1));label.style.left=b*bar/displayLength*100+'%';this.ruler.append(label);}}}
    if(this.playing){const tick=this.position*s.bpm*PPQ/(RATE*60);c.strokeStyle='#ff6b6b';c.beginPath();c.moveTo(tick/displayLength*w,0);c.lineTo(tick/displayLength*w,h);c.stroke();}
  }
}
