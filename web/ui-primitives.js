// SPDX-License-Identifier: GPL-3.0-only
// Browser-only primitives. They know ranges and callbacks, never WASM or MIDI ports.
export function el(tag,className,text) {
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!==undefined)node.textContent=text;
  return node;
}
export function action(text,run,className='') {
  const button=el('button',className,text);button.type='button';button.onclick=run;return button;
}
export function SectionHeader(title,detail='') {
  const header=el('div','ww-section-header');header.append(el('h2','',title),el('span','ww-muted',detail));return header;
}
export function Panel(title,detail='') {
  const node=el('section','ww-panel');node.append(SectionHeader(title,detail));return node;
}
export function StatusIndicator(label) {
  const node=el('span','ww-status',label);node.dataset.state='off';return node;
}
export function CompactMeter(label) {
  const node=el('div','ww-meter'),fill=el('span','ww-meter-fill'),track=el('span','ww-meter-track'),value=el('output','','—');
  track.append(fill);node.append(el('span','ww-muted',label),track,value);
  return {node,update(level){const v=Math.max(0,Math.min(1,level));fill.style.width=`${v*100}%`;value.textContent=level===null?'—':`${(20*Math.log10(Math.max(v,1e-6))).toFixed(1)} dBFS`;}};
}
export function MidiMapBadge(onMap) {
  const node=action('Assign MIDI',onMap,'ww-midi-badge');node.title='Assign or reassign a physical MIDI control';return node;
}
export function RotaryKnob({name,min=0,max=127,onInput,onMap}) {
  const node=el('div','ww-control'),label=el('span','ww-control-name',name),dial=el('div','ww-rotary');
  const canvas=el('canvas'),value=el('span','ww-control-value','—'),technical=el('small','ww-control-technical','Not started');
  canvas.width=200;canvas.height=200;canvas.setAttribute('aria-hidden','true');
  dial.tabIndex=0;dial.setAttribute('role','slider');dial.setAttribute('aria-label',name);dial.setAttribute('aria-valuemin',min);dial.setAttribute('aria-valuemax',max);
  dial.append(canvas,value);const badge=MidiMapBadge(onMap);node.append(label,dial,technical,badge);
  let current=min,disabled=true,drag=null,drawKey;
  const apply=v=>{if(disabled)return;const next=Math.max(min,Math.min(max,Math.round(v)));current=next;onInput(next);};
  dial.addEventListener('pointerdown',e=>{if(disabled)return;e.preventDefault();dial.focus();dial.setPointerCapture(e.pointerId);drag={y:e.clientY,value:current};node.classList.add('ww-manipulating');});
  dial.addEventListener('pointermove',e=>{if(drag)apply(drag.value+(drag.y-e.clientY)*(e.shiftKey?.15:.7));});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])dial.addEventListener(event,()=>{drag=null;node.classList.remove('ww-manipulating');});
  dial.addEventListener('keydown',e=>{
    if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home','End','PageUp','PageDown'].includes(e.key)){
      e.preventDefault();const delta=e.key==='PageUp'?10:e.key==='PageDown'?-10:['ArrowUp','ArrowRight'].includes(e.key)?1:-1;
      apply(e.key==='Home'?min:e.key==='End'?max:current+delta);
    }
  });
  // Wheel is intentionally not captured: scrolling must not edit a musical parameter.
  return {node,badge,dial,update(state,display,secondary){
    disabled=!state?.available;current=state?.value??min;max=state?.max??max;min=state?.min??min;
    dial.setAttribute('aria-disabled',String(disabled));dial.setAttribute('aria-valuenow',current);
    dial.setAttribute('aria-valuemax',max);dial.setAttribute('aria-valuetext',display);node.classList.toggle('ww-unavailable',disabled);
    value.textContent=display;technical.textContent=secondary;
    const key=`${current}/${min}/${max}/${disabled}`;if(key===drawKey)return;drawKey=key;
    const c=canvas.getContext('2d'),start=.75*Math.PI,end=2.25*Math.PI;c.clearRect(0,0,200,200);c.lineWidth=12;c.lineCap='round';
    c.strokeStyle='#39444a';c.beginPath();c.arc(100,100,78,start,end);c.stroke();
    if(current>min){c.strokeStyle=disabled?'#748088':'#f3f7f8';c.beginPath();c.arc(100,100,78,start,start+(end-start)*(current-min)/Math.max(1,max-min));c.stroke();}
  }};
}
export function VerticalFader({name,onInput,onMap}) {
  const node=el('div','ww-control ww-fader'),input=el('input'),value=el('output','','—'),badge=MidiMapBadge(onMap);
  input.type='range';input.min=0;input.max=127;input.step=1;input.disabled=true;input.setAttribute('aria-label',`${name} level`);
  input.oninput=()=>onInput(Number(input.value));node.append(el('span','ww-control-name',name),input,value,el('small','ww-muted','100 = unity'),badge);
  return {node,badge,input,update(state,display){input.disabled=!state?.available;input.max=state?.max??127;input.value=state?.value??0;input.setAttribute('aria-valuetext',display);input.style.setProperty('--fill',`${100*(state?.value??0)/(state?.max??127)}%`);value.textContent=display;}};
}
export function WorkspaceNavigation(items,onSelect,label) {
  const node=el('nav','ww-navigation');node.setAttribute('aria-label',label);
  for(const [id,label,title] of items){const button=action(label,()=>onSelect(id));button.dataset.workspace=id;button.title=title;button.setAttribute('aria-label',title);button.setAttribute('aria-pressed','false');node.append(button);}
  node.addEventListener('keydown',event=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;const buttons=[...node.querySelectorAll('[data-workspace]')],i=buttons.indexOf(document.activeElement);if(i<0)return;event.preventDefault();const n=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[n].focus();buttons[n].click();});
  return node;
}
export const AppShell=()=>el('div','ww-shell');
export const TopBar=()=>el('div','ww-topbar');
export const BottomPerformanceDock=()=>Panel('Keyboard & pads','');
