// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';

const PARTS=['A','B','C','D'];
const KITS=['808','909','606','707','DRUM-X'];
const DRUMS=['Kick','Snare','Clap','Closed hi-hat','Open hi-hat','Tom','Rimshot','Bell'];
const COLORS=['Auto','Red','Orange','Yellow','Green','Cyan','Blue','Violet','Pink','White'];
const TYPES=['Off','CC','CC toggle','Note','Pitch bend'];
const VIEWS=['Parts','Steps','More per step','Track','Patterns','Transpose','Endless'];
const options=(select,values)=>select.replaceChildren(...values.map(([value,label])=>new Option(label,value)));
const indexed=values=>values.map((label,index)=>[index,label]);

function control(parent,label,format,change){
  const select=Array.isArray(format),input=el(select?'select':'input'),field=el('label','',label);
  input.setAttribute('aria-label',label);
  if(select)options(input,indexed(format));
  else Object.assign(input,{type:'number',min:format.min,max:format.max,step:1});
  if(change)input.onchange=()=>{if(input.value!==''&&input.checkValidity())change(Number(input.value));};
  field.append(input);
  parent.append(field);
  return input;
}
function setValue(input,value){
  if(input.ownerDocument.activeElement!==input)input.value=value;
}
function detail(parent,label){
  const node=el('details','ww-instrument-group');
  node.append(el('summary','',label));
  parent.append(node);
  return node;
}

export class InstrumentSetup {
  constructor(bridge,hardware){
    this.bridge=bridge;this.hardware=hardware;this.request=0;
    this.node=Panel('Instrument setup');
    this.node.classList.add('ww-instrument-setup');
    this.status=el('p','ww-muted','Start audio to edit the instrument.');
    this.status.setAttribute('role','status');
    this.fields=el('div','ww-instrument-groups');
    this.fields.inert=true;
    this.node.append(this.status,this.fields);
    this.buildParts();
    this.buildPatterns();
    this.buildKeyboard();
    this.buildSettings();
    this.buildController();
  }
  send(action,...args){
    if(!this.frame?.setup)return;
    this.pending=++this.request;
    this.bridge.send({t:'instrument-setup',action,args,request:this.pending});
  }
  buildParts(){
    const parts=detail(this.fields,'Parts and mixer');
    parts.open=true;
    this.part=control(parts,'Active part',PARTS,value=>{
      const delta=value-this.frame.track;
      if(delta)this.bridge.send({t:'enc',e:5,steps:delta});
    });
    const mix=el('div','ww-instrument-mixer');
    parts.append(mix);
    this.mix=PARTS.map((label,part)=>{
      const row=el('fieldset');
      row.append(el('legend','','Part '+label));
      mix.append(row);
      return ['Level','Pan','Chorus send','Delay send','Reverb send','Drive send','Mute','Solo'].map((name,field)=>{
        const format=field===1?{min:-64,max:64}:field>5?['Off','On']:{min:0,max:127};
        return control(row,name,format,value=>this.bridge.send({t:'studio-mixer',part,field,value}));
      });
    });
    const sounds=detail(this.fields,'DRUM-X and SUPER oscillator');
    this.engine=control(sounds,'Engine',['Analog','DRUM-X'],value=>{
      if(value)this.bridge.send({t:'drums',part:this.frame.track,kit:0});
      else this.bridge.send({t:'analog',part:this.frame.track});
    });
    this.drumFields=el('div','ww-instrument-fields');
    sounds.append(this.drumFields);
    this.kit=control(this.drumFields,'Drum kit',KITS,kit=>this.bridge.send({t:'drums',part:this.frame.track,kit}));
    this.kitFields=['Morph','Tone','Decay','Fold'].map((label,index)=>control(this.drumFields,'Kit '+label,{min:0,max:127},
      value=>this.send('kit',this.frame.track,index,value)));
    this.drumLane=control(this.drumFields,'Drum sound',DRUMS,()=>this.updateDrum());
    this.drumValues=['Sound level','Sound decay','Sound pitch (semitones)'].map((label,index)=>control(this.drumFields,label,
      index===2?{min:-12,max:12}:{min:0,max:127},value=>this.send('drum',this.frame.track,Number(this.drumLane.value),index,value+(index===2?64:0))));
    const name=el('input'),label=el('label','','Preset name');
    Object.assign(name,{maxLength:10,placeholder:'DRUM KIT'});
    label.append(name);this.drumFields.append(label);
    const destination=control(this.drumFields,'Preset program',{min:1,max:99});
    this.drumFields.append(action('Save drum preset',()=>{
      const f=this.frame,program=Number(destination.value),text=name.value.trim().toUpperCase();
      if(!/^[ A-Z0-9-]{1,10}$/.test(text)||!destination.value||!destination.reportValidity()){
        this.status.textContent='Enter a program from 1–99 and a name using letters, numbers, spaces or hyphens.';
        return;
      }
      if(!confirm('Overwrite drum preset '+program+' with '+text+'?'))return;
      this.pending=++this.request;
      this.bridge.send({t:'drum-preset-save',request:this.pending,program,name:text,scope:f.instrument.scope,
        token:f.instrument.programToken,targetToken:f.editor.targets[program-1]});
    }),action('Use drum pads',()=>{this.send('bank',4);this.focusPads();}));
    this.superFields=el('div','ww-instrument-fields');
    sounds.append(this.superFields);
    this.superValues=['SUPER detune','SUPER mix'].map((name,index)=>control(this.superFields,name,{min:0,max:127},
      value=>this.send('super',this.frame.track,index,value)));
    this.superHint=el('p','ww-muted','Choose SUPER as the waveform of Oscillator 1 in TONES to edit detune and mix.');
    sounds.append(this.superHint);
  }
  buildPatterns(){
    const section=detail(this.fields,'Patterns, favorites and instrument sequencer');
    this.patternStatus=el('p','ww-muted');
    this.patternSlot=control(section,'Pattern slot',Array.from({length:16},(_,i)=>'Pattern '+(i+1)));
    this.patternLoad=action('Load pattern',()=>this.send('pattern',Number(this.patternSlot.value),0,this.frame.pattern-1));
    this.patternSave=action('Save pattern to slot',()=>{
      const slot=Number(this.patternSlot.value);
      if(!(this.frame.patternsUsed>>slot&1)||confirm('Replace Pattern '+(slot+1)+'?'))this.send('pattern',slot,1,this.frame.pattern-1);
    });
    section.append(this.patternLoad,this.patternSave,this.patternStatus);
    this.favoriteSlot=control(section,'Favorite slot',Array.from({length:8},(_,i)=>'Favorite '+(i+1)),()=>this.updatePatterns());
    this.favoriteLoad=action('Load favorite',()=>this.send('favourite',Number(this.favoriteSlot.value),0,this.frame.track));
    this.favoriteSave=action('Save selected part to favorite',()=>{
      const slot=Number(this.favoriteSlot.value);
      if(!(this.frame.used>>slot&1)||confirm('Replace Favorite '+(slot+1)+'?'))this.send('favourite',slot,1,this.frame.track);
    });
    section.append(this.favoriteLoad,this.favoriteSave);
    const sequencer=detail(section,'Instrument sequencer');
    this.bank=control(sequencer,'Pad bank',['Performance','Sequencer','Patterns','Split / Layer','Drum pads'],value=>this.send('bank',value));
    this.view=control(sequencer,'Sequencer view',VIEWS,value=>this.send('sequence',value));
    this.sequenceStatus=el('p','ww-muted');
    this.patternPlay=action('Play / stop instrument pattern',()=>this.hardware(16));
    this.patternRec=action('Record instrument pattern',()=>this.hardware(17));
    this.stepButtons=[action('Previous step page',()=>this.hardware(2)),action('Next step page',()=>this.hardware(3))];
    this.sequenceActionButtons=[
      action('Undo / redo instrument edit',()=>this.sequenceAction(0)),
      action('Clear selected step',()=>{if(confirm('Clear the selected step?'))this.sequenceAction(1);}),
      action('Toggle Endless',()=>this.sequenceAction(2))
    ];
    sequencer.append(this.patternPlay,this.patternRec,...this.stepButtons,...this.sequenceActionButtons,
      action('Focus pads',()=>this.focusPads()),this.sequenceStatus);
    this.sequenceControls=el('div','ww-instrument-fields');
    this.sequenceKnobs=Array.from({length:4},(_,i)=>{
      const row=el('div','ww-native-parameter'),name=el('strong'),value=el('output');
      const turn=step=>{
        const {sequence}=this.frame.setup;
        if(sequence)this.send('sequenceAdjust',i,step,sequence.view,this.frame.track,this.frame.pattern-1);
      };
      const down=action('−',()=>turn(-1)),up=action('+',()=>turn(1));
      row.append(name,value,down,up);
      this.sequenceControls.append(row);
      return {row,name,value,down,up};
    });
    sequencer.append(this.sequenceControls);
  }
  sequenceAction(action){this.send('sequenceAction',action,this.frame.track,this.frame.pattern-1);}
  buildKeyboard(){
    const section=detail(this.fields,'Split / Layer');
    this.keyboardRow=control(section,'Keyboard configuration',['Row 1','Row 2'],()=>this.updateKeyboard(true));
    this.keyboardStatus=el('p','ww-muted');
    this.keyboardValues=[
      control(section,'Mode',['Single','Split','Layer']),
      control(section,'First part',PARTS),
      control(section,'Second part',PARTS),
      control(section,'Split note',{min:1,max:127}),
      ...['First level %','Second level %'].map(label=>control(section,label,{min:0,max:100})),
      ...['First octave','Second octave'].map(label=>control(section,label,{min:-2,max:2})),
    ];
    section.append(this.keyboardStatus,
      action('Apply keyboard configuration',()=>{
        if(this.keyboardValues.every(input=>input.value!==''&&input.reportValidity())){
          this.send('keyboard',Number(this.keyboardRow.value),this.frame.pattern-1,...this.keyboardValues.map(input=>Number(input.value)));
        }
      }),
      action('Play this keyboard row',()=>this.send('row',Number(this.keyboardRow.value),this.frame.pattern-1)));
  }
  buildSettings(){
    const globals=detail(this.fields,'Globals and hardware faders'),master=detail(this.fields,'Master and shared drive');
    this.settings=[
      ['Instrument tempo (BPM)',{min:40,max:240}],['Instrument click',['Off','Record','On','Count-in']],
      ['Synth MIDI channel',['Omni',...Array.from({length:13},(_,i)=>'Channel '+(i+1))]],
      ['Fine tuning (cents)',{min:-50,max:50}],['Clock',['Auto / MIDI clock','Internal']],['Fader response',['Catch','Jump']],
      ['Hardware LCD theme',['OberVave','Zoom']],['Master level',{min:0,max:127}],['Master filter (64 = off)',{min:0,max:128}],
      ['Master drive',{min:0,max:127}],['Master compressor',{min:0,max:127}],['Drive type',['Overdrive','Distortion','Fuzz','Crush']],
      ['Drive amount',{min:0,max:127}],['Drive tone',{min:0,max:127}],['Drive return mix',{min:0,max:127}]
    ].map(([label,format],field)=>control(field<7?globals:master,label,format,value=>this.send('setting',field,value)));
    this.arpHold=control(globals,'Arpeggiator hold',['Off','On'],value=>this.send('setting',15,value));
    this.faderBank=action('Switch hardware fader bank',()=>this.hardware(1));
    globals.append(this.faderBank);
  }
  buildController(){
    const section=detail(this.fields,'Native MIDI controller mode');
    this.modeStatus=el('p','ww-muted');
    this.mode=action('Enter MIDI controller mode',()=>{
      if(!this.frame.midiMode&&(this.bridge.isDawBusy?.()||this.bridge.isStudioBusy?.())){
        this.status.textContent='Stop DAW and Studio and close their inputs first.';
        return;
      }
      this.send('mode',Number(!this.frame.midiMode));
    });
    section.append(this.modeStatus,this.mode);
    this.controllerFields=el('div','ww-instrument-fields');
    section.append(this.controllerFields);
    const change=()=>this.send('controller',Number(this.map.value),Number(this.channel.value)+1,Number(this.relative.value));
    this.map=control(this.controllerFields,'MIDI map',['Map 1','Map 2','Map 3','Map 4'],change);
    this.channel=control(this.controllerFields,'Main channel',Array.from({length:16},(_,i)=>String(i+1)),change);
    this.relative=control(this.controllerFields,'Knobs',['Absolute','Relative'],change);
    this.mapping=control(this.controllerFields,'Map control',[],()=>this.updateController(true));
    this.mappingType=control(this.controllerFields,'Message type',TYPES);
    this.mappingNumber=control(this.controllerFields,'Note / CC number',{min:0,max:127});
    this.mappingChannel=control(this.controllerFields,'Entry channel',['Main channel',...Array.from({length:16},(_,i)=>String(i+1))]);
    this.mappingColor=control(this.controllerFields,'Pad color',COLORS);
    this.controllerFields.append(action('Apply MIDI map entry',()=>{
      if(this.mappingNumber.value!==''&&this.mappingNumber.reportValidity()){
        this.send('map',Number(this.mapping.value),Number(this.mappingType.value),Number(this.mappingNumber.value),
          Number(this.mappingChannel.value),Number(this.mappingColor.value),Number(this.map.value));
      }
    }),action('Save MIDI map',()=>this.send('controllerAction',0)),action('Release controller notes',()=>this.send('controllerAction',1)));
  }
  focusPads(){this.node.ownerDocument.querySelector('#pads button:not([disabled])')?.focus();}
  updateDrum(){
    const setup=this.frame?.setup,drum=setup?.drum;
    this.drumFields.hidden=!drum;
    this.superFields.hidden=setup?.super[0]===255;
    this.superHint.hidden=!this.superFields.hidden||!!drum;
    if(drum){
      setValue(this.kit,drum.kit);
      this.kitFields.forEach((input,i)=>setValue(input,drum.overall[i]));
      this.drumValues.forEach((input,i)=>setValue(input,drum.sounds[Number(this.drumLane.value)][i]-(i===2?64:0)));
    }
    this.superValues.forEach((input,i)=>setValue(input,setup.super[i]));
  }
  updatePatterns(){
    const f=this.frame,q=f.setup.sequence;
    this.patternStatus.textContent='Current pattern '+f.pattern+(f.patternQueue?' · Queued '+f.patternQueue:'')+(f.patternPending?' · Save pending':'');
    this.favoriteLoad.disabled=!(f.used>>Number(this.favoriteSlot.value)&1);
    this.patternLoad.disabled=this.patternSave.disabled=!!f.patternPending;
    setValue(this.bank,f.bank);
    if(q)setValue(this.view,q.view);
    this.view.disabled=!q;
    this.stepButtons.forEach(button=>{button.disabled=!q;});
    this.sequenceActionButtons[0].disabled=!q||!!q.record||f.instrument.playing;
    this.sequenceActionButtons[1].disabled=this.sequenceActionButtons[0].disabled||![1,2].includes(q?.view);
    this.sequenceActionButtons[2].disabled=this.sequenceActionButtons[0].disabled||q?.view!==6;
    this.sequenceActionButtons[2].setAttribute('aria-pressed',String(!!q?.endless));
    this.sequenceStatus.textContent=q?`Part ${PARTS[f.track]} · Step page ${q.page+1} · ${q.length} steps`:'Select the Sequencer pad bank to edit steps.';
    this.patternPlay.setAttribute('aria-pressed',String(f.instrument.playing));
    this.patternRec.setAttribute('aria-pressed',String(!!q?.record));
    this.sequenceKnobs.forEach(({row,name,value,down,up},index)=>{
      const k=q?.knobs[index];
      row.hidden=!k?.label;
      if(!k?.label)return;
      name.textContent=k.label;value.textContent=k.value;
      down.setAttribute('aria-label','Decrease '+k.label);
      up.setAttribute('aria-label','Increase '+k.label);
    });
  }
  updateKeyboard(force=false){
    const f=this.frame,row=Number(this.keyboardRow.value),values=f.setup.keyboard[row];
    const key=JSON.stringify([f.pattern,row,values]);
    if(force||this.keyboardKey!==key){
      this.keyboardKey=key;
      this.keyboardValues.forEach((input,i)=>{input.value=values[i];});
    }
    this.keyboardStatus.textContent='Playing row '+(f.keyboardRow+1)+(f.keyboardActive?' · Split / Layer active':' · Single part');
  }
  updateController(force=false){
    const c=this.frame.setup.controller;
    this.controllerFields.hidden=!c;
    this.mode.textContent=c?'Return to Synth':'Enter MIDI controller mode';
    this.modeStatus.textContent=c?'Controller mode active · Synth audio suspended'+(c.settings[2]?' · unsaved map':''):
      'Uses the instrument’s own controller maps and suspends Synth audio.';
    if(!c)return;
    if(this.names&&!this.mapping.options.length){
      options(this.mapping,indexed(this.names).filter(([i])=>c.entries[i][0]));
    }
    if(!this.names)return;
    const index=Number(this.mapping.value),entry=c.entries[index],key=JSON.stringify([c.settings[3],index,entry]);
    setValue(this.map,c.settings[3]);
    setValue(this.channel,c.settings[0]-1);
    setValue(this.relative,c.settings[1]);
    if(force||key!==this.mappingKey){
      this.mappingKey=key;
      options(this.mappingType,indexed(TYPES).filter(([i])=>entry[0]>>i&1));
      this.mappingType.value=entry[1];this.mappingNumber.value=entry[2];this.mappingChannel.value=entry[3];this.mappingColor.value=entry[4];
      this.mappingColor.parentElement.hidden=index<24||index>=56;
    }
  }
  update(frame,running){
    this.frame=frame;
    this.names??=frame.setup?.controller?.names;
    if(this.node.hidden)return;
    this.fields.inert=!running||!frame.setup;
    if(!frame.setup)return;
    if(this.pending&&frame.setup.result?.request===this.pending){
      this.status.textContent=frame.setup.result.applied?'':'The instrument changed or is busy. Check the setting and try again.';
      this.pending=null;
    }else if(this.status.textContent==='Start audio to edit the instrument.')this.status.textContent='';
    setValue(this.part,frame.track);
    setValue(this.engine,Number(frame.engines[frame.track]===2));
    this.settings.forEach((input,i)=>setValue(input,frame.setup.settings[i]));
    setValue(this.arpHold,frame.setup.settings[15]);
    this.faderBank.textContent='Switch hardware fader bank · '+(frame.leds>>1&1?'B':'A');
    this.mix.forEach((fields,part)=>fields.forEach((input,i)=>setValue(input,frame.studioMixer[part][i])));
    this.updateDrum();
    this.updatePatterns();
    this.updateKeyboard();
    this.updateController();
  }
}
