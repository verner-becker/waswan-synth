// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {PPQ,validateSequence} from './studio-sequence.js';
import {defaultTracks,makeClip,moveClip,duplicateClip,deleteClip,addTake} from './studio-arrangement.js';
export class ArrangementEditor {
  constructor(owner){
    this.owner=owner;this.node=Panel('Arrangement','Four MIDI tracks · one instrument');this.node.classList.add('ww-arrangement');this.rows=[];
    this.node.append(el('p','ww-muted','Sequence mute/solo filters the MIDI arrangement. Part volume and pan also affect live notes using that part. Edit tone uses the existing TONES editor.'));
    for(let part=0;part<4;part++){
      const row=el('div','ww-track-row'),title=el('strong','','Part '+'ABCD'[part]);row.append(title);
      const mute=action('Mute '+'ABCD'[part],()=>owner.edit(s=>{this.tracks(s);s.tracks[part].mute=!s.tracks[part].mute;}));
      const solo=action('Solo '+'ABCD'[part],()=>owner.edit(s=>{this.tracks(s);s.tracks[part].solo=!s.tracks[part].solo;}));
      mute.setAttribute('aria-pressed','false');solo.setAttribute('aria-pressed','false');
      const slider=(name,min,max,field)=>{
        const label=el('label','',name+' '),input=el('input');input.type='range';input.min=min;input.max=max;input.step=1;input.setAttribute('aria-label',`Part ${'ABCD'[part]} ${name.toLowerCase()}`);label.append(input);
        input.oninput=()=>owner.bridge.send({t:'studio-mixer',part,field,value:Number(input.value)});
        input.onchange=()=>{const next=structuredClone(owner.sequence);this.tracks(next);next.tracks[part][field===0?'level':'pan']=Number(input.value);owner.sequence=validateSequence(next);owner.changed();};row.append(label);return input;
      };
      row.append(mute,solo);const level=slider('Volume',0,127,0),pan=slider('Pan',-64,64,1);
      const tone=action('Edit tone '+'ABCD'[part],()=>owner.openTonePart?.(part));
      const clip=action('Make clip '+'ABCD'[part],()=>owner.run(()=>this.selectNew(makeClip(owner.sequence,part))));
      const layer=action('Add take to '+'ABCD'[part],()=>owner.run(()=>{if(!owner.recorder.take)throw Error('Record or open a take first');owner.replace(addTake(owner.sequence,owner.recorder.take.project,part));}));
      const overdub=action('Overdub '+'ABCD'[part],()=>owner.run(()=>this.startOverdub(part)));
      const live=el('small','ww-muted');row.append(tone,clip,layer,overdub,live);this.node.append(row);
      this.rows.push({mute,solo,level,pan,tone,clip,layer,overdub,live});
    }
    const controls=el('div','ww-studio-actions');
    this.applyMix=action('Apply saved part mixer',()=>{const tracks=owner.sequence.tracks||defaultTracks();for(const t of tracks){owner.bridge.send({t:'studio-mixer',part:t.part,field:0,value:t.level});owner.bridge.send({t:'studio-mixer',part:t.part,field:1,value:t.pan});}});
    this.finish=action('Finish overdub',()=>owner.run(()=>this.finishOverdub()));controls.append(this.applyMix,this.finish);this.node.append(controls);
    this.node.append(el('p','ww-muted','For overdub, choose the live part/MIDI routing before recording. New input notes are added to the chosen track. Existing parts play as accompaniment; held notes at a loop boundary are trimmed to that boundary.'));
    this.clips=el('select');this.clips.setAttribute('aria-label','Arrangement clip');this.clips.onchange=()=>this.draw();
    this.clipStart=el('input');this.clipStart.type='number';this.clipStart.min=1;this.clipStart.step=.25;this.clipStart.setAttribute('aria-label','Clip start beat');
    this.clipPart=el('select');this.clipPart.setAttribute('aria-label','Clip part');for(let p=0;p<4;p++)this.clipPart.add(new Option('Part '+'ABCD'[p],String(p)));
    const clipControls=el('div','ww-sequence-settings');clipControls.append(el('span','','Clip'),this.clips,el('span','','Start beat'),this.clipStart,this.clipPart);
    this.move=action('Move clip',()=>owner.run(()=>owner.replace(moveClip(owner.sequence,this.clips.value,Math.round((Number(this.clipStart.value)-1)*PPQ),Number(this.clipPart.value)))));
    this.duplicate=action('Duplicate clip',()=>owner.run(()=>this.selectNew(duplicateClip(owner.sequence,this.clips.value))));
    this.remove=action('Delete clip',()=>owner.run(()=>owner.replace(deleteClip(owner.sequence,this.clips.value))));
    clipControls.append(this.move,this.duplicate,this.remove);this.node.append(clipControls);
    this.timeline=el('div','ww-arrangement-map');this.node.append(this.timeline);
  }
  tracks(s){if(!s.tracks){s.tracks=defaultTracks();if(this.owner.frame?.studioMixer)for(let p=0;p<4;p++){s.tracks[p].level=this.owner.frame.studioMixer[p][0];s.tracks[p].pan=this.owner.frame.studioMixer[p][1];}}}
  selectNew(sequence){this.owner.replace(sequence);this.clips.value=sequence.clips.at(-1).id;this.draw();}
  async startOverdub(part){
    const o=this.owner,r=o.recorder;if(o.playing||r.busy||this.overdub)throw Error('Stop the current transport before overdubbing');
    if(o.legacyPlaying)throw Error('Stop the Legacy sequencer first');
    await r.start();while(r.state==='starting')await new Promise(requestAnimationFrame);
    if(r.state!=='recording')throw Error(r.message);
    try{const start=await o.start(true);this.overdub={part,start};o.status.textContent='Overdubbing part '+'ABCD'[part];this.draw();}
    catch(error){r.stop('overdub-start-error');throw error;}
  }
  async finishOverdub(){
    if(!this.overdub)return;const o=this.owner,r=o.recorder,session=this.overdub;
    o.stopMidi();r.stop();
    while(r.busy)await new Promise(requestAnimationFrame);
    this.overdub=null;if(r.state!=='ready'||!r.take)throw Error(r.message);
    const start=o.transportStartFrame??session.start,offset=r.take.project.firstFrame-start;
    r.take.project.sequenceOffset=offset;
    o.replace(addTake(o.sequence,r.take.project,session.part,offset));this.draw();
  }
  update(m){
    if(m.t==='frame')for(let p=0;p<4;p++){
      const values=m.studioMixer?.[p];if(values){this.rows[p].live.textContent=`Live volume ${values[0]} · pan ${values[1]}${values[6]?' · Legacy mute':''}${values[7]?' · Legacy solo':''}`;
        if(!this.owner.sequence.tracks){if(document.activeElement!==this.rows[p].level)this.rows[p].level.value=values[0];if(document.activeElement!==this.rows[p].pan)this.rows[p].pan.value=values[1];}
      }
    }
  }
  draw(){
    const o=this.owner,s=o.sequence,tracks=s.tracks||defaultTracks().map((t,p)=>({...t,level:o.frame?.studioMixer?.[p][0]??100,pan:o.frame?.studioMixer?.[p][1]??0})),blocked=o.playing||o.recorder.busy||!!this.overdub;
    for(let p=0;p<4;p++){
      const row=this.rows[p],track=tracks[p];row.mute.setAttribute('aria-pressed',String(track.mute));row.solo.setAttribute('aria-pressed',String(track.solo));
      row.mute.disabled=row.solo.disabled=blocked;row.clip.disabled=row.layer.disabled=row.overdub.disabled=blocked;
      row.level.disabled=row.pan.disabled=!o.bridge.getAudio().node;
      if(document.activeElement!==row.level)row.level.value=track.level;if(document.activeElement!==row.pan)row.pan.value=track.pan;
    }
    this.finish.disabled=!this.overdub;this.applyMix.disabled=!s.tracks||!o.bridge.getAudio().node||o.recorder.busy;
    const selected=this.clips.value,key=(s.clips||[]).map(c=>[c.id,c.part,c.start,c.length,c.name].join('/')).join('|');
    if(key!==this.clipKey){this.clipKey=key;this.clips.replaceChildren();for(const c of s.clips||[])this.clips.add(new Option(`Part ${'ABCD'[c.part]} · ${c.name}`,c.id));if((s.clips||[]).some(c=>c.id===selected))this.clips.value=selected;}
    const clip=s.clips?.find(c=>c.id===this.clips.value);
    if(clip){this.clipStart.value=1+clip.start/PPQ;this.clipPart.value=clip.part;}
    for(const input of [this.clips,this.clipStart,this.clipPart,this.move,this.duplicate,this.remove])input.disabled=blocked||!clip;
    const mapKey=key+'@'+s.length;if(mapKey===this.mapKey)return;this.mapKey=mapKey;this.timeline.replaceChildren();
    for(let part=0;part<4;part++){
      const row=el('div','ww-clip-lane');row.setAttribute('aria-label','Clips in part '+'ABCD'[part]);
      for(const c of s.clips||[])if(c.part===part){const b=action(c.name,()=>{this.clips.value=c.id;this.draw();});b.style.left=c.start/s.length*100+'%';b.style.width=c.length/s.length*100+'%';b.title=`${c.name} · beat ${1+c.start/PPQ} · ${c.length/PPQ} beats`;row.append(b);}this.timeline.append(row);
    }
  }
}
