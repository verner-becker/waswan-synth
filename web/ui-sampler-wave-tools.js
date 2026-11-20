// SPDX-License-Identifier: GPL-3.0-only
import {el, action} from './ui-primitives.js';
import {rangeWav} from './sampler-waveform.js';
import {runOffline} from './sampler-offline.js';

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
function input(parent,title,value,min,max,step='1') {
  const label=el('label','',title),box=el('input');
  Object.assign(box,{type:'number',value,min,step});
  if(max!==undefined)box.max=max;
  box.setAttribute('aria-label',title);label.append(box);parent.append(label);return box;
}
function select(parent,title,options) {
  const label=el('label','',title),box=el('select');
  for(const [id,text] of options)box.append(new Option(text,id));
  box.setAttribute('aria-label',title);label.append(box);parent.append(label);return box;
}

export async function nearestZeroCrossing(file,layout,frame) {
  if(frame===0||frame===layout.frames)return frame;
  const start=Math.max(0,frame-256),end=Math.min(layout.frames,frame+257);
  const stride=layout.channels*2,offset=layout.offset;
  const data=new DataView(await file.slice(offset+start*stride,offset+end*stride).arrayBuffer());
  let best=frame,distance=Infinity,previous=data.getInt16(0,true);
  for(let at=start+1;at<end;at++){
    const value=data.getInt16((at-start)*stride,true);
    if((value===0||(value<0)!==(previous<0))&&Math.abs(at-frame)<distance){best=at;distance=Math.abs(at-frame);}
    previous=value;
  }
  return best;
}

export function createWaveTools({state,showRange,selectRange,paint,play,report,onSlices,onLoop,onMarkers}) {
  const node=el('details','ww-wave-tools'),form=el('fieldset');
  node.append(el('summary','','Cursor, zoom, loop and slices'),form);
  const view=el('div','ww-sampler-wave-tools'),position=el('div','ww-sampler-wave-fields');
  const cursorInput=input(position,'Cursor (frame)',0,0);
  const snap=select(position,'Snap pointer',[['off','Off'],['beat','Beat grid'],['slice','Slice markers'],['zero','Zero crossing (L / mono)']]);
  const bpm=input(position,'Grid tempo (BPM)',120,10,480,'any');
  const division=select(position,'Grid step',[['1','1 beat'],['0.5','½ beat'],['0.25','¼ beat'],['2','2 beats'],['4','4 beats']]);
  const zoomInfo=el('output');
  const rangeTools=el('div','ww-sampler-wave-tools');
  const slices=el('div','ww-sampler-wave-fields');
  const sliceLabel=el('label','','Slice markers (displayed WAV frames)'),list=el('input');
  list.type='text';list.setAttribute('aria-label','Waveform slice markers');sliceLabel.append(list);slices.append(sliceLabel);
  const sliceInfo=el('output');slices.append(sliceInfo);
  const sliceTools=el('div','ww-sampler-wave-tools');
  const loopFields=el('div','ww-sampler-wave-fields');
  const loopMode=select(loopFields,'Region loop mode',[['forward','Forward'],['reverse','Reverse'],['pingPong','Ping-pong']]);
  const crossfade=input(loopFields,'Region loop crossfade (frames)',0,0);
  const loopSearch=el('div','ww-sampler-wave-fields');
  function button(parent,label,fn){
    const control=action(label,async()=>{
      try{await fn();}catch(error){report(error.message);}
    });
    parent.append(control);return control;
  }
  const validCursor=()=>Number.isSafeInteger(cursorInput.valueAsNumber)&&cursorInput.valueAsNumber>=0&&cursorInput.valueAsNumber<=state().layout.frames;
  cursorInput.onchange=()=>{
    if(!validCursor()){report('Choose a cursor frame inside this WAV.');cursorInput.value=cursor;return;}
    cursor=cursorInput.valueAsNumber;paint();
  };
  const gridStep=()=>{
    if(!bpm.checkValidity()||!Number.isFinite(bpm.valueAsNumber))throw Error('Choose a tempo from 10 to 480 BPM.');
    return state().layout.sampleRate*60*Number(division.value)/bpm.valueAsNumber;
  };
  let cursor=0,amplitude=1,markers=[],analysis,sourceToken=0,regionLoop;
  function setLoop(loop) {
    regionLoop=loop??null;
    if(regionLoop){loopMode.value=loop.mode??'forward';crossfade.value=loop.crossfade??0;}
    paint();
  }
  function moveCursor(n){
    const {layout}=state();if(!layout)return;
    cursor=clamp(Math.round(n),0,layout.frames);cursorInput.value=cursor;paint();
  }
  function visibleWindow(start,span){
    const {layout}=state();
    span=clamp(Math.round(span),1,layout.frames);
    start=clamp(Math.round(start),0,layout.frames-span);
    return showRange({start,end:start+span});
  }
  function zoom(factor) {
    const {visible}=state(),span=visible.end-visible.start;
    const center=cursor>=visible.start&&cursor<=visible.end?cursor:(visible.start+visible.end)/2;
    return visibleWindow(center-span*factor/2,span*factor);
  }
  function pan(direction){
    const {visible}=state(),span=visible.end-visible.start;
    return visibleWindow(visible.start+direction*Math.max(1,Math.round(span*.8)),span);
  }
  function gain(factor){
    amplitude=clamp(factor,1/16,256);
    zoomInfo.textContent='Amplitude '+ Number(amplitude.toFixed(2))+'×';paint();
  }
  button(view,'Zoom in',()=>zoom(.5));button(view,'Zoom out',()=>zoom(2));
  button(view,'Scroll left',()=>pan(-1));button(view,'Scroll right',()=>pan(1));
  button(view,'Amplitude +',()=>gain(amplitude*2));button(view,'Amplitude −',()=>gain(amplitude/2));
  button(view,'Fit amplitude',()=>{
    const {peaks}=state();if(!peaks)throw Error('Wait for the visible waveform to load.');
    let peak=0;for(const value of peaks)peak=Math.max(peak,Math.abs(value));gain(peak?32768/peak:1);
  });
  view.append(zoomInfo);
  button(rangeTools,'Set start at cursor',()=>selectRange({...state().selection,start:cursor}));
  button(rangeTools,'Set end at cursor',()=>selectRange({...state().selection,end:cursor}));
  button(rangeTools,'Preview from cursor',()=>{
    const {layout}=state();if(cursor>=layout.frames)throw Error('Place the cursor before the end of the WAV.');
    return play({start:cursor,end:layout.frames});
  });
  button(rangeTools,'Repeat selection',()=>play(state().selection,true));
  let loopTask,points=[];
  const suggest=button(loopSearch,'Suggest loop points',async()=>{
    const {file,selection}=state();
    clearSuggestions();
    const task=new AbortController();
    loopTask=task;suggest.disabled=true;searchInfo.textContent='Checking the selection boundaries…';
    try{
      const found=await runOffline(file,{type:'loops',range:selection},{signal:task.signal});
      if(loopTask!==task)return;
      points=found;
      for(const [index,point] of points.entries()){
        candidates.append(new Option(point.start+' – '+point.end+' frames · mismatch '+point.error.toPrecision(3),index));
      }
      searchInfo.textContent=points.length?'Lower mismatch indicates a closer join.':'No loop points found. Choose a longer selection with signal at both boundaries.';
      usePoints.disabled=candidates.disabled=!points.length;
    }catch(error){if(!task.signal.aborted){searchInfo.textContent=error.message;throw error;}}
    finally{if(loopTask===task){suggest.disabled=false;loopTask=null;}}
  });
  const candidates=select(loopSearch,'Suggested loop points',[]);
  const usePoints=button(loopSearch,'Use suggested points',()=>{
    const {start,end}=points[Number(candidates.value)];
    selectRange({start,end});
  });
  const searchInfo=el('output');
  loopSearch.append(searchInfo);
  function clearSuggestions(){
    loopTask?.abort();loopTask=null;suggest.disabled=false;
    points=[];candidates.replaceChildren();usePoints.disabled=candidates.disabled=true;
    searchInfo.textContent='';
  }
  const writeLoop=button(loopFields,'Use selection as region loop',()=>{
    const {file,selection}=state(),length=selection.end-selection.start;
    const fade=crossfade.valueAsNumber;
    if(!Number.isSafeInteger(fade)||fade<0||fade>Math.floor((length-(loopMode.value==='pingPong'?1:0))/2))throw Error('Choose a shorter loop crossfade.');
    return onLoop({file,...selection,mode:loopMode.value,crossfade:fade});
  });
  writeLoop.hidden=!onLoop;
  function setMarkers(next) {
    const {layout}=state();
    if(!layout||next.some(n=>!Number.isSafeInteger(n)||n<=0||n>=layout.frames))throw Error('Each slice marker must be an integer frame inside the WAV.');
    markers=[...new Set(next)].sort((a,b)=>a-b);
    list.value=markers.join(', ');sliceInfo.textContent=(markers.length+1)+' slices'+(markers.length>15?' · kits use up to 16':'');
    apply.disabled=markers.length>15;paint();
  }
  async function editMarkers(next) {
    const old=markers, token=sourceToken;
    setMarkers(next);
    const changed=markers;
    try {await onMarkers?.({file:state().file,markers:[...changed]});}
    catch(error){if(token===sourceToken&&changed===markers)setMarkers(old);throw error;}
  }
  list.onchange=async()=>{try{await editMarkers(list.value.trim()?list.value.split(',').map(n=>Number(n.trim())):[]);}
    catch(error){list.value=markers.join(', ');report(error.message);}};
  button(sliceTools,'Add slice at cursor',()=>editMarkers([...markers,cursor]));
  button(sliceTools,'Remove nearest slice',()=>{
    if(markers.length){const nearest=closest(cursor);return editMarkers(markers.filter(n=>n!==nearest));}
  });
  function closest(frame) {
    return markers.reduce((best,n)=>Math.abs(n-frame)<Math.abs(best-frame)?n:best,markers[0]??frame);
  }
  button(sliceTools,'Slice selection by grid',()=>{
    const {selection,layout}=state(),stride=gridStep(),next=[];
    const first=Math.ceil(selection.start/stride);
    if((selection.end-selection.start)/stride>32768)throw Error('Choose a shorter selection or wider grid.');
    for(let beat=first;Math.round(beat*stride)<selection.end;beat++){
      const at=Math.round(beat*stride);if(at>selection.start&&at<layout.frames)next.push(at);
    }
    return editMarkers(next);
  });
  const detect=button(sliceTools,'Find transients in selection',async()=>{
    const {file,layout,selection}=state();const token=sourceToken;
    analysis?.abort();const task=new AbortController();analysis=task;detect.disabled=true;
    try{
      const wav=rangeWav(file,layout,selection);
      const result=await runOffline(wav,{type:'analyze'},{signal:task.signal});
      if(token===sourceToken)await editMarkers(result.transients.map(n=>n+selection.start).filter(n=>n>0&&n<layout.frames));
    }catch(error){if(!task.signal.aborted)throw error;}
    finally{if(analysis===task){analysis=null;detect.disabled=false;}}
  });
  const apply=button(sliceTools,'Use slices in kit builder',()=>onSlices({file:state().file,markers:[...markers]}));
  apply.hidden=!onSlices;
  form.append(view,position,rangeTools,loopSearch,loopFields,slices,sliceTools);
  async function snapFrame(frame) {
    const {file,layout}=state();
    if(snap.value==='zero')return nearestZeroCrossing(file,layout,frame);
    if(snap.value==='slice'&&markers.length)return closest(frame);
    if(snap.value==='beat'){const stride=gridStep();return clamp(Math.round(Math.round(frame/stride)*stride),0,layout.frames);}
    return frame;
  }
  function reset(){
    clearSuggestions();
    analysis?.abort();sourceToken++;cursor=0;amplitude=1;markers=[];regionLoop=null;list.value='';
    zoomInfo.textContent='Amplitude 1×';sliceInfo.textContent='';cursorInput.value='';
    loopMode.value='forward';crossfade.value=0;form.disabled=true;apply.disabled=false;
  }
  function open(range,restored=[]) {
    form.disabled=false;cursorInput.max=state().layout.frames;
    cursor=range.start;cursorInput.value=cursor;setMarkers(restored);
  }
  return {node,open,reset,snapFrame,moveCursor,setMarkers,setLoop,clearSuggestions,
    get markers(){return markers;},get cursor(){return cursor;},get amplitude(){return amplitude;},get regionLoop(){return regionLoop;}};
}
