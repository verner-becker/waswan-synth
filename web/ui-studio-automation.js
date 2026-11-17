// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {AUTOMATION_TARGETS,automationTarget,initialAutomation,laneFromTake} from './studio-automation.js';
import {PPQ} from './studio-sequence.js';
export class AutomationEditor {
  constructor(owner){
    this.owner=owner;this.node=Panel('Automation','Native parameter scales · read during Studio playback');this.node.classList.add('ww-automation');
    this.node.append(el('p','ww-muted','Record a take while moving controls, then import applied changes. Controls waiting for MIDI pickup produce no automation point. Curves affect shared part/master settings and leave the final value in place after Stop.'));
    const tools=el('div','ww-sequence-settings');this.target=el('select');this.target.setAttribute('aria-label','Automation target');for(const t of AUTOMATION_TARGETS)this.target.add(new Option(t.name,t.id));
    this.add=action('Add automation lane',()=>owner.run(()=>this.addLane()));
    this.import=action('Use take applied controls',()=>owner.run(()=>this.importLane()));tools.append(this.target,this.add,this.import);this.node.append(tools);
    const laneTools=el('div','ww-sequence-settings');this.lanes=el('select');this.lanes.setAttribute('aria-label','Automation lane');this.lanes.onchange=()=>{this.selectedTick=null;this.draw();};
    this.enabled=el('input');this.enabled.type='checkbox';this.enabled.setAttribute('aria-label','Read automation lane');const enabled=el('label','','Read ');enabled.append(this.enabled);
    this.enabled.onchange=()=>this.edit(l=>l.enabled=this.enabled.checked);
    this.curve=el('select');this.curve.setAttribute('aria-label','Automation curve');for(const [v,n] of [['linear','Linear'],['step','Steps']])this.curve.add(new Option(n,v));this.curve.onchange=()=>this.edit(l=>l.curve=this.curve.value);
    this.remove=action('Delete automation lane',()=>owner.edit(s=>s.automation=s.automation.filter(l=>l.id!==this.lanes.value)));
    laneTools.append(this.lanes,enabled,this.curve,this.remove);this.node.append(laneTools);
    this.canvas=el('canvas','ww-automation-curve');this.canvas.width=1152;this.canvas.height=180;this.canvas.setAttribute('aria-label','Automation curve editor');this.node.append(this.canvas);
    this.canvas.onclick=e=>{
      if(owner.playing||owner.recorder.busy||owner.rendering)return;const lane=this.lane();if(!lane)return;
      const t=automationTarget(lane.target),box=this.canvas.getBoundingClientRect(),tick=Math.max(0,Math.min(owner.sequence.length,Math.round((e.clientX-box.left)/box.width*owner.sequence.length/(PPQ/4))*(PPQ/4)));
      const value=Math.round(t.max-Math.max(0,Math.min(1,(e.clientY-box.top-8)/(box.height-16)))*(t.max-t.min));this.time.value=1+tick/PPQ;this.value.value=value;this.setPoint();
    };
    const points=el('div','ww-sequence-settings');this.points=el('select');this.points.setAttribute('aria-label','Automation points');this.points.onchange=()=>{this.selectedTick=Number(this.points.value);this.draw();};
    const field=(name)=>{const label=el('label','',name+' '),input=el('input');input.type='number';input.setAttribute('aria-label',name);label.append(input);points.append(label);return input;};
    points.append(this.points);this.time=field('Automation start beat');this.time.min=1;this.time.step='any';this.value=field('Automation value');this.value.step=1;
    this.set=action('Set automation point',()=>this.setPoint());this.deletePoint=action('Delete automation point',()=>this.edit(l=>{if(l.points.length===1)throw Error('Keep one point or delete the lane');l.points=l.points.filter(p=>p.tick!==Number(this.points.value));this.selectedTick=null;}));points.append(this.set,this.deletePoint);this.node.append(points);
    this.detail=el('p','ww-muted');this.node.append(this.detail);
    this.node.append(el('p','ww-muted','Filter/envelope lanes require ANALOG. Pitch bend is shared; modulation and pitch wheel follow the currently selected live part. Sustain playback belongs only to Studio notes. Full curves stay in the project and WAV/MP3; MIDI export retains notes and recorded MIDI messages.'));
  }
  lane(){return this.owner.sequence.automation?.find(l=>l.id===this.lanes.value);}
  edit(change){const id=this.lanes.value;this.owner.edit(s=>{const l=s.automation?.find(l=>l.id===id);if(l)change(l);});}
  async addLane(){
    const o=this.owner,t=automationTarget(this.target.value),current=o.sequence,existing=current.automation?.find(l=>l.target===t.id);
    if(existing){this.lanes.value=existing.id;this.draw();return;}
    let context=o.recorder.take?.project.sequenceContext||o.recorder.take?.project.context;
    const {node}=o.bridge.getAudio();if(node)context=await o.recorder.snapshot(node);
    if(o.sequence!==current)throw Error('Sequence changed; select the control again');
    if(t.kind==='param'&&context?.parts[t.part].engine!==0)throw Error('This control requires an ANALOG part');
    const value=context?initialAutomation(context,t):t.kind==='mix'&&t.field===0?100:t.kind==='master'?724:Math.max(t.min,0);
    const lane={id:crypto.randomUUID(),target:t.id,enabled:true,curve:t.kind==='pedal'?'step':'linear',points:[{tick:0,value},{tick:current.length,value}]};
    o.edit(s=>(s.automation??=[]).push(lane));this.lanes.value=lane.id;this.draw();
  }
  importLane(){
    const o=this.owner;if(!o.recorder.take)throw Error('Record or open a take first');
    const lane=laneFromTake(o.recorder.take.project,o.sequence,this.target.value);let id=lane.id;
    o.edit(s=>{s.automation??=[];const i=s.automation.findIndex(l=>l.target===lane.target);if(i>=0){id=s.automation[i].id;s.automation[i]={...lane,id};}else s.automation.push(lane);});this.lanes.value=id;this.draw();
  }
  setPoint(){
    const tick=Math.round((Number(this.time.value)-1)*PPQ),value=Number(this.value.value);this.selectedTick=tick;
    this.edit(l=>{const p=l.points.find(p=>p.tick===tick);if(p)p.value=value;else l.points.push({tick,value});l.points.sort((a,b)=>a.tick-b.tick);});this.draw();
  }
  draw(){
    const o=this.owner,sequence=o.sequence,blocked=o.playing||o.recorder.busy||!!o.rendering;
    const selection=this.lanes.value;
    if(this.laneSequence!==sequence){this.laneSequence=sequence;this.lanes.replaceChildren();for(const lane of sequence.automation||[])this.lanes.add(new Option(automationTarget(lane.target).name,lane.id));if(sequence.automation?.some(l=>l.id===selection))this.lanes.value=selection;}
    const lane=this.lane(),target=lane?automationTarget(lane.target):null;
    for(const input of [this.target,this.add,this.import])input.disabled=blocked;
    for(const input of [this.lanes,this.enabled,this.curve,this.remove,this.points,this.time,this.value,this.set,this.deletePoint])input.disabled=blocked||!lane;
    if(lane){
      this.enabled.checked=lane.enabled;this.curve.value=lane.curve;this.curve.disabled=blocked||target.kind==='pedal';this.value.min=target.min;this.value.max=target.max;this.time.max=sequence.length/PPQ+1;
      if(this.pointLane!==lane){this.pointLane=lane;const chosen=this.selectedTick??Number(this.points.value);this.points.replaceChildren();for(const p of lane.points)this.points.add(new Option(`Beat ${(1+p.tick/PPQ).toFixed(3)} · ${p.value}`,String(p.tick)));if(lane.points.some(p=>p.tick===chosen))this.points.value=String(chosen);}
      const selected=lane.points.find(p=>p.tick===Number(this.points.value));if(selected){if(document.activeElement!==this.time)this.time.value=1+selected.tick/PPQ;if(document.activeElement!==this.value)this.value.value=selected.value;}
      this.detail.textContent=`${target.name} · ${target.min}…${target.max} · ${lane.points.length} points · ${lane.enabled?'Read enabled':'Read disabled'}`;
    }else{this.points.replaceChildren();this.detail.textContent='Add a lane or import applied controls from a take. Maximum: 16 lanes, 2048 points per lane.';}
    if(o.node.hidden)return;
    const c=this.canvas.getContext('2d'),w=this.canvas.width,h=this.canvas.height;c.fillStyle='#0a0f12';c.fillRect(0,0,w,h);c.strokeStyle='#34454d';for(let i=0;i<=8;i++){c.beginPath();c.moveTo(i*w/8,0);c.lineTo(i*w/8,h);c.stroke();}
    if(!lane)return;const x=p=>p.tick/sequence.length*w,y=p=>h-8-(p.value-target.min)/(target.max-target.min)*(h-16);c.strokeStyle='#27e3dd';c.lineWidth=2;c.beginPath();
    for(let i=0;i<lane.points.length;i++){const p=lane.points[i];if(!i)c.moveTo(x(p),y(p));else{if(lane.curve==='step')c.lineTo(x(p),y(lane.points[i-1]));c.lineTo(x(p),y(p));}}c.stroke();
    for(const p of lane.points){c.fillStyle=p.tick===Number(this.points.value)?'#fff':'#27e3dd';c.beginPath();c.arc(x(p),y(p),4,0,Math.PI*2);c.fill();}
  }
}
