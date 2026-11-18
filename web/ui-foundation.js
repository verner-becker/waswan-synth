// SPDX-License-Identifier: GPL-3.0-only
import {CONTROLS,controlTarget,displayValue} from './ui-controls.js';
import {TARGETS,fineTarget} from './midi-profile.js';
import {ToneSelector} from './ui-tone-selector.js';
import {ToneEditor} from './ui-tone-editor.js';
import {MidiSetup} from './ui-midi-setup.js';
import {StudioWorkspace} from './ui-studio.js';
import {SequenceWorkspace} from './ui-studio-sequence.js';
import {DawWorkspace} from './ui-daw.js';
import {DawTab} from './ui-daw-tab.js';
import {MODES,selectVoiceMode} from './polyphony-panel.js';
import {chordLabel} from './ui-chords.js';
import {trackIcon} from './daw-icons.js';
import {el,action,AppShell,TopBar,Panel,StatusIndicator,CompactMeter,RotaryKnob,VerticalFader,WorkspaceNavigation,BottomPerformanceDock} from './ui-primitives.js';

const SYNTH_VIEWS=[['perf','Performance','Performance'],['tones','TONES','Tone Editor']];
const STUDIO_VIEWS=[['seq','SEQ','Sequencer'],['studio','Studio','Studio recorder']];
const WORKSPACES=[...SYNTH_VIEWS,...STUDIO_VIEWS,['daw','DAW','DAW'],['diag','Diagnostics','Diagnostics']];
let app;
export function updateFoundation(message) { app?.receive(message); }
export function mountFoundation(bridge) {
  // Compatibility URL keeps the original composition and handlers for regression/reference.
  if(new URLSearchParams(location.search).get('legacy')==='1')return;
  app=new Foundation(bridge);
}
class Foundation {
  constructor(bridge) {
    this.bridge=bridge;this.frame=null;this.running=false;this.audio=false;this.workspace='perf';this.legacy=false;this.controls=[];this.lastDraw=0;
    this.original=el('div','ww-original');
    for(const child of [...document.body.children])this.original.append(child);
    document.body.append(this.original);document.body.classList.add('ww-page');
    document.documentElement.lang='en';document.title='WASWAN Synth · Performance';
    const css=el('link');css.rel='stylesheet';css.href=new URL('./ui-foundation.css',import.meta.url).href;document.head.append(css);
    this.shell=AppShell();document.body.prepend(this.shell);
    this.buildHeader();
    this.buildNavigation();
    this.main=el('main','ww-main');this.shell.append(this.main);
    this.views=new Map();this.buildPerformance();this.studio=new StudioWorkspace(bridge);this.addView('studio',this.studio.node);this.sequence=new SequenceWorkspace(bridge,this.studio.recorder);this.addView('seq',this.sequence.node);
    this.toneEditor=new ToneEditor(m=>this.bridge.send(m),()=>{if(this.workspace==='tones')this.focusMidiContext();});this.addView('tones',this.toneEditor.node);
    this.buildDiagnostics();this.buildSettings();this.buildDock();this.shell.append(this.performanceReadouts);this.buildMidiDialog();
    this.midiSetup=new MidiSetup(this.bridge.midi,document.querySelector('.midi-panel'),()=>this.dock.querySelector('#keys .key')?.focus());
    this.sequence.openTonePart=part=>{if(this.frame&&this.frame.track!==part)this.bridge.send({t:'enc',e:5,steps:part-this.frame.track});this.selectWorkspace('tones');};
    this.dawKeyboardVisible=false;this.daw=new DawWorkspace(bridge,{openSettings:()=>{window.focus();this.showSettings(true);},toggleKeyboard:()=>{
      this.dawKeyboardVisible=!this.dawKeyboardVisible;
      this.dock.hidden=!this.dawKeyboardVisible;
      if(this.dawTab?.connected&&this.dawKeyboardVisible)window.focus();
      return this.dawKeyboardVisible;
    }});this.addView('daw',this.daw.node);this.settingsPanel.append(this.daw.midiProfiles.panel);bridge.isDawBusy=()=>this.daw.player.playing||this.daw.player.starting||this.daw.recorder.busy||this.daw.recorder.audioTrackId||this.daw.monitor.enabled||this.daw.audition?.busy||this.daw.audioExport?.exporter.busy;bridge.isStudioBusy=()=>!!(this.sequence.playing||this.sequence.starting||this.sequence.rendering||this.sequence.capture||this.studio.recorder.busy||this.studio.recorder.player||this.studio.recorder.playbackPreparing);
    this.dawTab=new DawTab(this.daw,{
      onMove:node=>this.views.set('daw',node),focusSynth:()=>this.selectWorkspace('perf'),
      onError:message=>{this.notice.textContent=message;}
    });
    const credits=el('div','ww-credits');credits.append(el('span','','Based on SMKSYNTH · OberVave / zvenson and contributors · DRUM-X / JIANT · '));
    const license=el('a','','GPL-3.0');license.href='../LICENSE.txt';credits.append(license);
    const lame=el('a','','LAME / lamejs'),source=el('a','','source & license');lame.href='https://lame.sourceforge.net/';source.href='./vendor/lamejs/index.html';credits.append(el('span','',' · MP3: '),lame,el('span','',' · '),source);this.shell.append(credits);
    const previous=this.bridge.midi.profile.onChange;
    this.bridge.midi.onInputStateChange=()=>this.daw.refreshRecordingSummary();
    this.bridge.midi.profile.onChange=()=>{previous();this.updateBadges();this.updateLearnState();this.updateAssignments();};
    addEventListener('focus',()=>this.focusMidiContext());
    this.shell.addEventListener('focusin',event=>{if(!event.target.closest('.ww-daw'))this.focusMidiContext();});
    this.updateAssignments();this.selectWorkspace(new URLSearchParams(location.search).get('workspace')==='daw'?'daw':'perf');this.animate=()=>{this.drawAudio();this.animation=requestAnimationFrame(this.animate);};this.animate();
  }
  buildNavigation() {
    const bar=el('div','ww-workspace-bar');
    const synth=WorkspaceNavigation(SYNTH_VIEWS,id=>this.selectWorkspace(id),'Synth');
    synth.prepend(el('span','ww-workspace-label','Synth'));
    synth.querySelector('button').prepend(trackIcon('keyboard'));
    const daw=WorkspaceNavigation([['daw','DAW','DAW']],id=>this.selectWorkspace(id),'DAW');
    this.openDawTab=action('Open DAW in new tab',()=>this.dawTab.open(),'ww-daw-new-tab');
    daw.append(this.openDawTab);
    const studio=WorkspaceNavigation(STUDIO_VIEWS,id=>this.selectWorkspace(id),'Other workspaces');
    studio.classList.add('ww-secondary-navigation');
    this.legacyToggle=action('Legacy SMK',()=>this.toggleLegacy(),'ww-legacy-toggle');
    studio.append(this.legacyToggle);
    bar.append(synth,daw,studio);this.shell.append(bar);
    this.workspaceButtons=[...bar.querySelectorAll('[data-workspace]')];
  }
  buildHeader() {
    const top=TopBar(),brand=el('div','ww-brand');brand.append(el('strong','','WASWAN'),el('span','','SYNTH'));
    const preset=el('div','ww-preset');this.toneSelector=new ToneSelector(m=>this.bridge.send(m));preset.append(this.toneSelector.node,this.toneSelector.detail);
    this.part=el('span','ww-part','Part —');this.midiStatus=StatusIndicator('MIDI · Not connected');this.mode=el('span','ww-chip','Mode —');this.voices=el('span','ww-chip','Voices — / —');this.bpm=el('span','ww-chip','— BPM');
    this.start=action('Start audio',()=>this.startAudio(),'ww-primary');this.settings=action('Settings',()=>this.showSettings(this.settingsPanel.hidden));
    this.settings.setAttribute('aria-controls','ww-settings');this.settings.setAttribute('aria-expanded','false');
    top.append(brand,preset,this.part,this.midiStatus,this.mode,this.voices,this.bpm,this.start,this.settings);this.shell.append(top);
    this.notice=el('p','ww-notice','Start audio, then connect your MIDI controller in Settings.');this.notice.setAttribute('role','status');this.shell.append(this.notice);
  }
  addView(id,node) {node.dataset.view=id;node.hidden=true;this.views.set(id,node);this.main.append(node);return node;}
  buildPerformance() {
    const view=el('div','ww-performance');const panel=Panel('Performance');
    this.mapToggle=action('MIDI assignments',()=>this.setMappingMode(!this.mappingMode));
    this.mapToggle.setAttribute('aria-pressed','false');
    this.mapToggle.setAttribute('aria-controls','ww-performance-controls');
    panel.firstElementChild.lastElementChild.replaceWith(this.mapToggle);
    const surface=el('div','ww-surface'),knobs=el('div','ww-knob-grid'),faders=el('div','ww-fader-grid');
    surface.id='ww-performance-controls';
    faders.setAttribute('role','group');faders.setAttribute('aria-label','Part mixer');
    for(const c of CONTROLS){
      const options={name:c.name,onInput:value=>this.setControl(c.id,value),onMap:()=>this.openMap(c.id)};
      const primitive=c.id<8?RotaryKnob(options):VerticalFader(options);primitive.node.dataset.control=c.key;primitive.node.title=c.id>=8?'Mixer level: 100 is unity; independent of patch volume.':c.section;
      primitive.badge.hidden=true;
      primitive.badge.setAttribute('aria-label',`Assign MIDI to ${c.name}`);
      primitive.pickup=el('small','ww-pickup');primitive.pickup.id='ww-pickup-'+c.key;primitive.pickup.hidden=true;
      primitive.node.append(primitive.pickup);
      (primitive.dial||primitive.input).setAttribute('aria-describedby',c.id<8?`ww-performance-help ${primitive.pickup.id}`:primitive.pickup.id);
      this.controls.push(primitive);(c.id<8?knobs:faders).append(primitive.node);
    }
    surface.append(knobs,faders);panel.append(surface);
    const help=el('p','ww-control-help','Drag knobs vertically · Shift for fine adjustment · arrow keys for one step');help.id='ww-performance-help';panel.append(help);view.append(panel);
    const middle=el('div','ww-musical-grid');
    const output=Panel('Synth output','Post-master · mono');
    const display=el('div','ww-output-display'),waveform=el('div'),levels=el('div');
    this.scope=el('canvas','ww-scope');this.scope.width=640;this.scope.height=150;this.scope.setAttribute('aria-label','Main output waveform');this.scopeText=el('small','ww-muted','Waiting for audio');waveform.append(this.scope,this.scopeText);
    this.rms=CompactMeter('RMS');this.peak=CompactMeter('Peak');this.rms.update(null);this.peak.update(null);levels.append(this.rms.node,this.peak.node);
    display.append(waveform,levels);output.append(display);
    const notes=Panel('Notes / chord','Selected part · gated voices');this.chord=el('strong','ww-chord','—');this.notes=el('p','ww-muted','No gated notes');this.voiceState=el('p','ww-muted','Allocated voices include release.');notes.append(this.chord,this.notes,this.voiceState);
    const state=Panel('Instrument','Pattern and voice mode');this.performanceState=el('p','','Waiting for instrument');this.patternState=el('p','ww-muted','Pattern —');
    this.transport=action('Play / stop pattern',()=>this.hardware(16));this.sustain=action('Sustain MIDI · off',()=>{if(this.frame)this.bridge.send({t:'voice-sustain',enabled:!this.frame.polyphony.midiSustain});});this.sustain.setAttribute('aria-pressed','false');
    this.voiceModes=el('div','ww-performance-modes');this.voiceModes.setAttribute('role','group');this.voiceModes.setAttribute('aria-label','Voice mode');
    for(const mode of MODES){const button=action(mode.label,()=>selectVoiceMode(this.bridge.midi,this.frame,mode.id));button.dataset.performanceMode=mode.id;button.disabled=true;button.setAttribute('aria-pressed','false');this.voiceModes.append(button);}
    state.append(this.performanceState,this.patternState,this.transport,this.sustain,this.voiceModes);
    middle.append(output,notes,state);this.performanceReadouts=middle;this.addView('perf',view);
  }
  buildDiagnostics() {
    const view=Panel('Diagnostics','Existing tools · same live session');view.append(el('p','ww-muted','DSP timing is approximate. Exceeding the block budget does not prove a hardware underrun.'));
    const toggle=document.querySelector('[data-dsp-toggle]'),dsp=document.querySelector('.waswan-dsp'),midi=document.querySelector('.waswan-midi-diagnostic');
    for(const node of [toggle,dsp,midi])if(node)view.append(node);
    const details=el('details','ww-voice-details');details.append(el('summary','','Voice allocation & execution modes'));
    const poly=document.querySelector('.waswan-polyphony');if(poly)details.append(poly);view.append(details);this.addView('diag',view);
  }
  buildSettings() {
    this.settingsPanel=Panel('Settings','MIDI, controller assignments and session');this.settingsPanel.id='ww-settings';this.settingsPanel.classList.add('ww-settings');this.settingsPanel.hidden=true;
    this.settingsClose=action('Close settings',()=>{this.showSettings(false);this.settings.focus();});
    const diagnostics=action('Diagnostics',()=>{
      const heading=this.views.get('diag').querySelector('h2');
      this.selectWorkspace('diag');heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'nearest'});
    });
    diagnostics.dataset.workspace='diag';this.settingsPanel.append(this.settingsClose,diagnostics);
    this.settingsPanel.append(el('p','ww-muted','Existing K1–K8 and F1–F4 mappings are preserved. Their destinations follow the legacy context. Use Assign MIDI on a Performance control for an explicit, page-independent destination.'));
    for(const selector of ['.midi-panel','.lab','.sessionbar']){const node=document.querySelector(selector);if(node)this.settingsPanel.append(node);}
    const assignments=Panel('Controller assignments','Saved profile · reassignable');
    this.profileToggle=action('Enable profile',()=>this.bridge.midi.profile.setEnabled(!this.bridge.midi.profile.enabled));assignments.append(this.profileToggle);
    this.assignmentRows=el('div','ww-assignment-rows');assignments.append(this.assignmentRows);
    const newTarget=el('select');newTarget.setAttribute('aria-label','MIDI assignment destination');
    for(const t of TARGETS)newTarget.add(new Option(t.label,t.id));
    assignments.append(newTarget,action('Assign selected control',()=>this.openTargetMap(newTarget.value)));
    this.settingsPanel.append(assignments);
    this.shell.insertBefore(this.settingsPanel,this.main);
    // Legacy content remains in the original tree; only its presentation is toggled.
    this.legacyHost=Panel('Legacy SMK','Original display, controls and behaviour · shared dock below');this.legacyHost.classList.add('ww-legacy');this.legacyHost.hidden=true;
    const instrument=document.querySelector('.instrument');this.legacyHost.append(instrument);
    this.legacyHost.append(document.querySelector('.waswan-profile'));
    const toolbar=document.querySelector('.toolbar');if(toolbar)this.legacyHost.append(toolbar);
    const status=document.querySelector('#status');if(status)this.legacyHost.append(status);
    this.shell.insertBefore(this.legacyHost,this.main.nextSibling);
  }
  buildDock() {
    this.dock=BottomPerformanceDock();this.dock.classList.add('ww-dock');const row=el('div','ww-dock-row'),keyboard=el('div','ww-keyboard-area'),pads=el('div','ww-pad-area');
    this.dock.firstElementChild.lastElementChild.replaceWith(el('span','ww-muted','Click or focus a key and press Enter'));
    const actions=el('div','ww-play-actions');
    this.mute=action('Mute output',()=>document.querySelector('#mute').click());
    actions.append(action('Oct −',()=>this.hardware(4)),action('Oct +',()=>this.hardware(5)),action('Release all',()=>document.querySelector('#panic').click()),this.mute);
    const keys=document.querySelector('.keybed');keyboard.append(actions,keys);
    const velocity=document.querySelector('.instrumentfoot');if(velocity){velocity.querySelector('span')?.remove();keyboard.append(velocity);}
    pads.append(el('h3','','Pads'),document.querySelector('.padheading'),document.querySelector('#pads'),document.querySelector('#padHelp'));
    pads.append(action('Cycle pad bank',()=>this.hardware(0)));row.append(keyboard,pads);this.dock.append(row);this.shell.append(this.dock);
    // Nodes move once at mount, before audio starts. Workspace switches never move
    // held keys/pads or replace their event handlers.
  }
  buildMidiDialog() {
    this.dialog=el('dialog','ww-map-dialog');const form=el('div');this.mapTitle=el('h2','','Assign MIDI');this.mapStatus=el('p','ww-muted','');this.mapStatus.setAttribute('role','status');
    this.mapMode=el('select');for(const [value,text] of [['absolute','Absolute · 0–127'],['offset','Relative · 65 / 63'],['twos','Relative · 1 / 127']])this.mapMode.add(new Option(text,value));
    this.mapBehavior=el('select');this.mapBehavior.add(new Option('Fine · one internal unit','fine'));this.mapBehavior.add(new Option('Normal · two units per relative step','normal'));
    const mode=el('label','','Message format');mode.append(this.mapMode);const behavior=el('label','','Response');behavior.append(this.mapBehavior);
    this.mapLearn=action('Learn control',()=>{
      const p=this.bridge.midi.profile;if(!this.bridge.midi.input){this.mapStatus.textContent='Connect and select a MIDI input in Settings first.';return;}
      if(!p.enabled)p.setEnabled(true);p.setContext(this.frame?.knobControl?.context??null);p.controlScope=this.frame?.instrument?.scope??null;p.learn(this.mapTarget,this.mapMode.value,this.mapBehavior.value);
    },'ww-primary');
    const close=()=>{if(this.bridge.midi.profile.learning?.target===this.mapTarget)this.bridge.midi.profile.reset();this.dialog.close();};
    this.dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    this.mapHelp=el('p','ww-muted');form.append(this.mapTitle,this.mapHelp,mode,behavior,this.mapStatus,this.mapLearn,action('Remove assignment',()=>this.bridge.midi.profile.remove(this.mapTarget)),action('Close',close));
    this.dialog.append(form);document.body.append(this.dialog);
  }
  openMap(id) { this.openTargetMap(controlTarget(id)); }
  setMappingMode(enabled) {
    this.mappingMode=enabled;
    this.mapToggle.setAttribute('aria-pressed',String(enabled));
    for(const {badge} of this.controls)badge.hidden=!enabled;
  }
  openTargetMap(target) {
    this.mapTarget=target;this.mapTitle.textContent=`Assign MIDI · ${TARGETS.find(t=>t.id===target)?.label??target}`;
    const binding=this.bridge.midi.profile.bindings.find(b=>b.target===target);
    this.mapMode.value=binding?.mode??'absolute';this.mapMode.disabled=target.startsWith('fader:');
    this.mapBehavior.disabled=!fineTarget(target);this.mapBehavior.value=binding?.behavior??(fineTarget(target)?'fine':'normal');
    this.mapBehavior.options[1].textContent=target.startsWith('control:')?'Normal · two units per relative step':'Normal · original encoder response';
    this.mapHelp.textContent=target.startsWith('control:')?'Move only the physical knob or fader to assign. Absolute controls wait for soft takeover. This replaces any previous assignment using the same MIDI source.':'This legacy destination follows the original panel context. Fine absolute uses soft takeover; Normal preserves the original response. Learning replaces any assignment using the same MIDI source.';
    this.updateLearnState();this.dialog.showModal();
  }
  updateLearnState() {
    if(!this.mapStatus||!this.mapTarget)return;
    const p=this.bridge.midi.profile,b=p.bindings.find(b=>b.target===this.mapTarget);
    this.mapStatus.textContent=p.learning?.target===this.mapTarget?'Listening… move one physical control.':b?`Assigned · channel ${b.channel+1} · CC ${b.cc} · ${b.mode} · ${b.behavior}${p.enabled?'':' · profile disabled'}`:'No MIDI assignment. Existing mappings are unchanged.';
    if(!b&&this.mapTarget.startsWith('control:')){const id=CONTROLS.find(c=>controlTarget(c.id)===this.mapTarget)?.id;if(id!==undefined&&this.legacyBinding(id))this.mapStatus.textContent+=' A contextual Legacy mapping currently reaches this parameter; learning here creates a fixed Performance destination.';}
    if(p.persistenceError)this.mapStatus.textContent+=' Browser storage unavailable; assignment is temporary.';
  }
  updateAssignments() {
    if(!this.assignmentRows)return;
    const p=this.bridge.midi.profile;this.profileToggle.textContent=p.enabled?'Profile enabled · disable':'Profile disabled · enable';this.profileToggle.setAttribute('aria-pressed',String(p.enabled));
    this.assignmentRows.replaceChildren();
    if(!p.bindings.length)this.assignmentRows.append(el('p','ww-muted','No saved assignments. Select a destination below, or turn on MIDI assignments in Performance.'));
    for(const b of p.bindings){const row=el('div','ww-assignment-row');row.append(el('span','',TARGETS.find(t=>t.id===b.target)?.label??b.target),el('small','ww-muted',`Ch ${b.channel+1} · CC ${b.cc} · ${b.mode} · ${b.behavior}`),action('Reassign',()=>this.openTargetMap(b.target)));this.assignmentRows.append(row);}
  }
  legacyBinding(id) {
    const c=CONTROLS[id],profile=this.bridge.midi.profile;
    return profile.bindings.find(b=>c.id===7?b.target==='enc:7':c.legacyParam!==undefined&&/^enc:[0-3]$/.test(b.target)&&this.frame?.knobControl?.parameters[Number(b.target.split(':')[1])]?.id===c.legacyParam);
  }
  updateBadges() {
    if(!this.controls.length)return;
    const profile=this.bridge.midi.profile;
    for(const c of CONTROLS){
      const {badge,pickup}=this.controls[c.id],b=profile.bindings.find(b=>b.target===controlTarget(c.id));
      const legacy=b?null:this.legacyBinding(c.id),state=this.frame?.instrument?.controls[c.id];
      const waiting=profile.enabled&&state?.available&&b?.mode==='absolute'&&b.port===this.bridge.midi.input?.name&&!(state.picked&&state.revision===profile.revision);
      const hint=waiting?`Pickup · move through CC ${Math.round(127*(state.value-state.min)/Math.max(1,state.max-state.min))}`:'';
      const label=b?`Ch ${b.channel+1} · CC ${b.cc}${profile.enabled?'':' · off'}`:legacy?`K${Number(legacy.target.split(':')[1])+1} · CC ${legacy.cc}`:'Assign MIDI';
      if(badge.textContent!==label){
        badge.textContent=label;
        badge.setAttribute('aria-label',`Assign MIDI to ${c.name}${b||legacy?' · '+label:''}`);
      }
      badge.classList.toggle('ww-assigned',!!(b||legacy)&&profile.enabled);
      if(pickup.textContent!==hint)pickup.textContent=hint;
      pickup.hidden=!waiting;
    }
  }
  setControl(id,value) {const f=this.frame;if(!this.running||!f?.instrument)return;this.bridge.send({t:'ui-control',source:'ui',id,value,scope:f.instrument.scope});}
  hardware(b) {if(!this.running)return;this.bridge.send({t:'btn',b,down:true});setTimeout(()=>this.bridge.send({t:'btn',b,down:false}),90);}
  focusMidiContext(){
    const id=this.workspace;
    this.daw?.midiProfiles.focus(id==='daw'?this.daw.hostMidiContext||'transport':id==='tones'?
      (this.toneEditor.selectedGroup==='Envelopes'?'envelope':'instrument'):id==='seq'?'transport':'performance');
  }
  selectWorkspace(id) {
    if(id==='seq')queueMicrotask(()=>this.sequence?.draw());
    if(!this.views.has(id))return;
    if(id==='daw'&&this.dawTab?.connected)this.dawTab.win.focus();
    this.workspace=id;this.legacy=false;
    this.showSettings(false);
    if(id!=='perf'&&this.mappingMode)this.setMappingMode(false);
    this.focusMidiContext();this.legacyHost.hidden=true;this.main.hidden=false;
    this.shell.dataset.activeWorkspace=id;
    if(this.dock)this.dock.hidden=id==='daw'&&!this.dawKeyboardVisible;
    this.performanceReadouts.hidden=id!=='perf';
    for(const [key,node] of this.views)node.hidden=key!==id;
    for(const button of this.workspaceButtons)button.setAttribute('aria-pressed',String(button.dataset.workspace===id));
    this.legacyToggle.setAttribute('aria-pressed','false');
    document.title=`WASWAN Synth · ${WORKSPACES.find(w=>w[0]===id)[2]}`;
    // Presentation only: no MIDI, parameter, transport, release or audio command.
  }
  toggleLegacy(force) {
    this.legacy=force??!this.legacy;this.main.hidden=this.legacy;this.legacyHost.hidden=!this.legacy;
    if(this.legacy&&this.dock)this.dock.hidden=false;
    this.legacyToggle.setAttribute('aria-pressed',String(this.legacy));
    if(this.legacy){this.showSettings(false);this.performanceReadouts.hidden=true;for(const button of this.workspaceButtons)button.setAttribute('aria-pressed','false');}
    else this.selectWorkspace(this.workspace);
  }
  startAudio() {
    if(this.failed){location.reload();return;}
    this.midiSetupPending=true;
    const context=this.bridge.getAudio().context;
    if(this.running&&context?.state==='suspended'){
      void context.resume().then(()=>{if(this.midiSetupPending){this.midiSetupPending=false;this.midiSetup.open({keyboard:this.workspace==='perf'&&!this.legacy});}}).catch(()=>{this.midiSetupPending=false;this.notice.textContent='Unable to resume audio. Try again.';});
    }else document.querySelector('#power').click();
  }
  showSettings(open) {
    this.settingsPanel.hidden=!open;
    this.settings.setAttribute('aria-expanded',String(open));
    if(open){this.settingsClose.focus({preventScroll:true});this.settingsPanel.scrollIntoView({block:'nearest'});}
  }
  receive(m) {
    if(m.t==='audio-owner-busy'){this.midiSetupPending=false;this.openDawTab.disabled=true;this.notice.textContent='Audio is running in another WASWAN tab. Use Open DAW in new tab there to share its session, or close it before starting here.';return;}
    if(m.t==='audio-start-error'){this.midiSetupPending=false;this.notice.textContent=`Unable to start audio: ${m.message}`;return;}
    this.studio.update(m);
    this.sequence.update(m);
    this.daw.receive(m);
    if(m.t==='daw-notice'){this.notice.textContent=m.message;return;}
    if(m.t==='tone-store'){this.toneEditor.stored(m.data,m.ok);return;}
    if(m.t==='ready'){
      this.failed=false;this.running=true;this.audio=!!m.audio;this.openDawTab.disabled=false;this.start.textContent=m.audio?'Audio running':'Silent UI mode';this.start.disabled=true;this.attachAudio();
      if(this.midiSetupPending){this.midiSetupPending=false;this.midiSetup.open({keyboard:this.workspace==='perf'&&!this.legacy});}
    }
    if(m.t==='error'){if(this.frame)this.toneEditor.update(this.frame,false);this.toneSelector.node.disabled=true;this.midiSetupPending=false;this.midiSetup.close();this.failed=true;this.running=false;this.start.disabled=false;this.start.textContent='Reload instrument';this.notice.textContent=`Audio error: ${m.message??'processing stopped'}`;}
    if(m.t!=='frame')return;
    const muted=!!this.bridge.getAudio().muted;this.mute.textContent=muted?'Muted · unmute':'Mute output';this.mute.setAttribute('aria-pressed',String(muted));
    this.frame=m;const f=m.instrument,part=m.track,poly=m.polyphony;
    this.toneSelector.update(m,this.running);this.toneEditor.update(m,this.running);
    this.part.textContent=`Part ${'ABCD'[part]}`;const connected=!!this.bridge.midi.input;
    this.midiStatus.textContent=connected?'MIDI · Connected':'MIDI · Not connected';this.midiStatus.dataset.state=connected?'on':'off';
    this.mode.textContent=m.engines[part]===2?'DRUM-X':['POLY','DUAL','UNISON','MONO'][poly.parts[part].mode];
    for(const button of this.voiceModes.children){button.disabled=!this.running||m.midiMode||m.engines[part]!==0;button.setAttribute('aria-pressed',String(m.engines[part]===0&&Number(button.dataset.performanceMode)===poly.parts[part].mode));}
    const active=poly.slots.filter(v=>v.active),gate=active.filter(v=>v.gate);this.voices.textContent=`Voices ${active.length} / ${poly.limit}`;this.bpm.textContent=f?`${f.bpm} BPM`:'— BPM';
    this.notice.textContent=m.midiMode?'Legacy MIDI MODE is active: synthesis is suspended. Return to synth mode in Legacy SMK.':this.audio?(connected?'':'Ready to play · connect a MIDI input in Settings.'):this.running?'Silent interface mode · audio unavailable in this browser.':'Start audio to play. Connect a MIDI controller in Settings.';
    if(!m.midiMode&&this.audio&&this.daw.monitor?.enabled){const target=this.daw.monitor.target();this.notice.textContent=(connected?'MIDI → ':'Waiting for MIDI input → ')+(target?this.daw.monitor.track()?.name:'Synth')+' · DAW input routing stays active across workspaces.';}
    for(const c of CONTROLS){const state=f?.controls[c.id],analogOnly=c.id<4&&m.engines[part]!==0,display=analogOnly?'—':displayValue(c.id,state?.value,state?.physical);this.controls[c.id].update(state,display,analogOnly?'ANALOG only':state?`${state.value} / ${state.max} · ${c.section}`:'Not available');}
    const held=gate.filter(v=>v.part===part&&!v.sequenced).map(v=>v.note),chord=chordLabel(held);
    this.chord.textContent=m.engines[part]===2?'DRUM-X':chord.name;this.notes.textContent=m.engines[part]===2?'Chord view applies to ANALOG voices.':chord.notes;
    this.voiceState.textContent=`${gate.length} gated · ${active.length-gate.length} release · sustain included`;
    this.performanceState.textContent=`Part ${'ABCD'[part]} · ${m.engines[part]===2?'DRUM-X':'ANALOG'}`;
    this.patternState.textContent=`Pattern ${m.pattern} · ${f?.playing?'playing':'stopped'}${m.patternQueue?' · queued '+m.patternQueue:''}${m.patternPending?' · save pending':''}`;
    this.sustain.textContent=`Sustain MIDI · ${poly.midiSustain?'on':'off'}`;this.sustain.setAttribute('aria-pressed',String(poly.midiSustain));this.sustain.disabled=m.midiMode;this.transport.disabled=m.midiMode;
    this.updateBadges();
  }
  attachAudio() {
    const {context,gain}=this.bridge.getAudio();if(!context||!gain||this.audioContext===context)return;
    if(this.analyser&&this.audioGain)try{this.audioGain.disconnect(this.analyser);}catch{}
    this.audioContext=context;context.addEventListener('statechange',()=>{if(!this.audio)return;this.start.disabled=context.state==='running';this.start.textContent=context.state==='running'?'Audio running':'Resume audio';if(context.state!=='running')this.notice.textContent=`Audio context · ${context.state}`;});this.audioGain=gain;this.analyser=context.createAnalyser();this.analyser.fftSize=1024;gain.connect(this.analyser);this.wave=new Float32Array(this.analyser.fftSize);
  }
  drawAudio() {
    if(!this.analyser||this.workspace!=='perf'||this.legacy||document.hidden||performance.now()-this.lastDraw<50)return;
    this.lastDraw=performance.now();this.analyser.getFloatTimeDomainData(this.wave);
    let sum=0,peak=0;for(const value of this.wave){sum+=value*value;peak=Math.max(peak,Math.abs(value));}
    this.rms.update(Math.sqrt(sum/this.wave.length));this.peak.update(peak);this.scopeText.textContent=this.audioContext.state==='running'?'Live waveform':`Audio context · ${this.audioContext.state}`;
    const canvas=this.scope,c=canvas.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);c.strokeStyle='#233338';c.lineWidth=1;
    for(let x=0;x<=w;x+=w/10){c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}for(let y=0;y<=h;y+=h/4){c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}
    c.strokeStyle='#27e3dd';c.lineWidth=2;c.beginPath();for(let i=0;i<this.wave.length;i++){const x=i*w/(this.wave.length-1),y=h/2-this.wave[i]*h*.45;i?c.lineTo(x,y):c.moveTo(x,y);}c.stroke();
  }
}
