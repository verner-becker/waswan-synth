// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {StudioRecorder} from './studio-recorder.js';
import {RATE} from './studio-format.js';
import {CONTROLS} from './ui-controls.js';
import {automationTarget} from './studio-automation.js';
const pitch=n=>['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12]+(Math.floor(n/12)-1);
function midiLabel(st,a,b){
  const channel=(st&15)+1,kind=st&240;
  if(kind===144||kind===128)return `${kind===144&&b?'Note on':'Note off'} · ${pitch(a)}${kind===144&&b?' · velocity '+b:''} · channel ${channel}`;
  if(kind===224)return `Pitch bend · ${(a|(b<<7))-8192} · channel ${channel}`;
  if(kind===176)return `${a===64?'Sustain':a===1?'Modulation':'CC '+a} · ${b} · channel ${channel}`;
  return `MIDI message · channel ${channel}`;
}
function eventLabel(e){
  if(e.kind==='input')return midiLabel(...e.data);
  if(e.kind==='parameter')return `${automationTarget(e.target).name} · ${e.value}`;
  const m=e.command;
  if(m.t==='midi')return midiLabel(m.st,m.d1,m.d2);
  if(m.t==='ui-control')return `${CONTROLS[m.id]?.name||'Control'} · ${m.value??(m.steps>0?'+':'')+m.steps}`;
  if(m.t==='wheel')return m.w===1?'Modulation wheel':'Pitch wheel';
  if(m.t==='key')return `Virtual key ${m.k+1} · ${m.down?'pressed':'released'}`;
  if(m.t==='pad')return `Pad ${m.p+1} · ${m.v?'velocity '+m.v:'released'}`;
  if(m.t==='program-select')return `Tone program ${m.program}`;
  if(m.t==='voice-mode')return `Voice mode · ${['POLY','DUAL','UNISON','MONO'][m.mode]}`;
  if(m.t==='voice-sustain')return `Sustain · ${m.enabled?'on':'off'}`;
  if(m.t==='studio-note')return `Sequence · ${pitch(m.note)} · ${m.velocity?'velocity '+m.velocity:'note off'} · part ${'ABCD'[m.part]}`;
  if(m.t==='studio-mixer')return `Part ${'ABCD'[m.part]} · ${['volume','pan','chorus send','delay send','reverb send','drive send','Legacy mute','Legacy solo'][m.field]} · ${m.value}`;
  if(m.t==='panic')return 'Release all';
  if(m.t==='enc'||m.t.startsWith('enc-fine'))return `Knob ${m.e+1} · ${m.steps===undefined?'position '+m.value:(m.steps>0?'+':'')+m.steps}`;
  if(m.t==='fader')return `Fader ${m.f+1} · ${m.v}`;
  if(m.t==='editor-set')return `Tone edit · value ${m.value}`;
  if(m.t==='editor-save')return `Save tone · program ${m.program}`;
  return {btn:'Legacy button',master:'Master level',velocity:'Keyboard velocity','voice-unison':'Unison voices','drum-hit':'Drum hit',drums:'Drum kit',analog:'Analog engine'}[m.t]||'Instrument action';
}
export class StudioWorkspace {
  constructor(bridge){
    this.recorder=new StudioRecorder(bridge);this.recorder.onChange=()=>this.draw();this.bridge=bridge;
    this.node=Panel('Studio · performance recorder','Local stereo take · input MIDI and instrument commands');this.node.classList.add('ww-studio');
    this.status=el('p','ww-studio-status');this.status.setAttribute('role','status');
    const controls=el('div','ww-studio-actions');
    const run=task=>void Promise.resolve().then(task).catch(error=>{this.recorder.message=error.message;this.draw();});
    this.record=action('Record take',()=>run(()=>this.recorder.start()),'ww-primary');
    this.stop=action('Stop recording',()=>this.recorder.stop());
    this.play=action('Listen to take',()=>run(()=>this.recorder.play()));
    this.stopPlay=action('Stop take playback',()=>{this.recorder.stopPlayback();this.draw();});
    this.wav=action('Export WAV',()=>run(()=>this.recorder.exportWav()));
    this.mp3=action('Export MP3',()=>run(()=>this.recorder.exportMp3()));this.cancelMp3=action('Cancel MP3 export',()=>this.recorder.cancelMp3());
    this.mp3Status=el('p','ww-muted');this.mp3Status.setAttribute('role','status');
    this.save=action('Save project',()=>run(async()=>{await this.recorder.prepareProject?.();this.recorder.exportProject();}));
    this.applyContext=action('Apply saved tones and mixer',()=>run(()=>this.recorder.applyContext()));
    this.recover=action('Recover local take',()=>run(()=>this.recorder.recover()));
    this.open=el('input');this.open.type='file';this.open.accept='.wsproj';this.open.setAttribute('aria-label','Open Studio project');
    this.open.onchange=()=>{const file=this.open.files[0];if(file)run(()=>this.recorder.open(file));this.open.value='';};
    controls.append(this.record,this.stop,this.play,this.stopPlay,this.wav,this.mp3,this.cancelMp3,this.save,this.recover,this.applyContext);
    const openLabel=el('label','ww-studio-open','Open project ');openLabel.append(this.open);
    this.counter=el('p','ww-studio-counter');this.context=el('p','ww-muted');this.events=el('div','ww-studio-events');
    this.node.append(this.status,controls,this.mp3Status,openLabel,this.counter,
      el('p','ww-muted','Records the synth after master/effects plus playing audio clips, before monitoring mute. Stop ends capture without releasing notes; wait for effect tails before stopping.'),
      this.context,el('p','ww-muted','Local recovery is not a backup. Save a project file to preserve the take. Opening a project does not replace the live instrument. Maximum: 20 minutes.'),
      el('h3','','Recorded events'),el('p','ww-muted','MIDI input and instrument actions are listed separately. Legacy arp and sequence notes are not transcribed. A MIDI control waiting for pickup may leave the sound unchanged.'),this.events);
    this.draw();
  }
  update(m){
    if(m.t==='error'&&this.recorder.busy)this.recorder.stop('instrument-error');
    if(m.t==='frame'||m.t==='ready'||m.t==='error')this.draw();
  }
  draw(){
    const r=this.recorder,audio=this.bridge.getAudio();
    this.status.textContent=r.message;this.status.dataset.state=r.state;
    this.record.disabled=r.busy||audio.context?.state!=='running';this.stop.disabled=!['starting','recording'].includes(r.state);
    for(const b of [this.play,this.wav,this.save])b.disabled=r.busy||!r.take;
    this.applyContext.disabled=r.busy||!r.take||!audio.node;
    this.mp3.disabled=r.busy||r.encoding||!r.take?.project.frames;this.cancelMp3.disabled=!r.encoding;this.mp3Status.textContent=r.mp3Message||'MP3 is encoded locally at 192 kbps. WAV remains the lossless reference.';
    if(!r.take?.project.frames){this.play.disabled=true;this.wav.disabled=true;}
    this.stopPlay.disabled=!r.player;this.open.disabled=r.busy;this.recover.disabled=r.busy;
    this.counter.textContent=`${(r.frames/RATE).toFixed(1)} s · ${r.eventCount} events · ${r.state}`;
    const p=r.take?.project;
    this.context.textContent=p?`${p.name} · ${p.status} · ${p.context.tempo} BPM · recorded programs ${p.context.parts.map((part,i)=>'ABCD'[i]+': '+part.program).join(' / ')}. Context retained for later MIDI work.`:'Select a tone and record a performance. Existing keyboard, pads and MIDI mappings remain active.';
    if(this.eventProject===p)return;this.eventProject=p;this.events.replaceChildren();
    if(!p){this.events.append(el('p','ww-muted','No take loaded'));return;}
    const table=el('table'),head=el('tr');for(const name of ['Time','Source','Event'])head.append(el('th','',name));table.append(head);
    for(const e of p.events.slice(0,100)){
      const row=el('tr');row.append(el('td','',(e.frame/RATE).toFixed(3)+' s'),el('td','',e.kind==='input'?'MIDI input':e.kind==='parameter'?'Applied control':'Instrument action'),el('td','',eventLabel(e)));table.append(row);
    }
    this.events.append(table);if(p.events.length>100)this.events.append(el('p','ww-muted',`Showing first 100 of ${p.events.length} events. All events remain in the project.`));
  }
}
