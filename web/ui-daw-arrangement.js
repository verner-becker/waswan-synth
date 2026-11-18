// SPDX-License-Identifier: GPL-3.0-only
import {el,action,Panel} from './ui-primitives.js';
import {PPQ,RATE,makeTrack,uuid} from './daw-project.js';
import {trackIcon} from './daw-icons.js';
import {saveTrackPreset,loadTrackPreset} from './daw-track-preset.js';
import {DawWindows} from './ui-daw-windows.js';
import {clipBeat,clipBeats,arrangementBeats,frameBeat,beatFrame,musicalPosition,secondsPosition,snapBeat,defaultDawLayout,readDawLayout} from './daw-arrangement.js';
const icons=['keyboard','piano','bass','guitar','acoustic','organ','drums','percussion','voice','backing','strings','fx','mic','audio','generic'];
const shortSound=patch=>patch?String.fromCharCode(...patch.slice(63,73)).replace(/[^\x20-\x7e]/g,'').trim():'Choose a sound';
const control=(name,type,parent)=>{const label=el('label','',name),input=el('input');input.type=type;input.setAttribute('aria-label',name);label.append(input);parent.append(label);return input;};
const popover=(label,panel)=>{
  const button=action(label);
  panel.classList.add('ww-daw-popover');
  panel.setAttribute('popover','auto');
  button.popoverTargetElement=panel;
  return button;
};
const volumeText=value=>value>0?(20*Math.log10(value)).toFixed(1)+' dB':'−∞ dB';
const panText=value=>value===0?'Center':(value<0?'L ':'R ')+Math.round(Math.abs(value)*100)+'%';
export class DawArrangement {
  constructor(workspace,{transport,trackTools,master}){
    this.w=workspace;this.windows=new DawWindows(workspace,()=>this.windowChanged());this.prefs=readDawLayout(localStorage);this.rows=new Map();this.clips=new Map();this.markerButtons=new Map();this.peaks=new Map();this.peakQueue=[];this.grid=.25;this.snap=true;this.meterSamples=new Float32Array(256);
    this.root=el('div','ww-daw-layout');this.upper=el('div','ww-daw-upper');this.browser=Panel('Track inspector');this.browser.classList.add('ww-daw-browser');this.buildBrowser();
    this.timeline=el('section','ww-daw-arrangement');this.timeline.setAttribute('aria-label','Arrangement');const tools=el('div','ww-daw-arrangement-tools');
    this.browserToggle=action('Show Track inspector',()=>{if(this.prefs.maximized==='arrangement'){this.prefs.maximized=null;this.prefs.browser=true;}else this.prefs.browser=!this.prefs.browser;this.layout();});this.zoomOut=action('−',()=>this.zoom(this.prefs.zoom/1.25));this.zoomOut.setAttribute('aria-label','Zoom out Arrangement');this.zoomIn=action('+',()=>this.zoom(this.prefs.zoom*1.25));this.zoomIn.setAttribute('aria-label','Zoom in Arrangement');this.zoomFit=action('Fit',()=>this.fit());this.zoomFit.setAttribute('aria-label','Fit Arrangement to content');this.zoomValue=el('output','ww-muted');
    this.gridSelect=el('select');this.gridSelect.setAttribute('aria-label','Arrangement grid');for(const [label,value] of [['1/4',1],['1/8',.5],['1/16',.25],['1/32',.125]])this.gridSelect.add(new Option(label,value));this.gridSelect.value=this.grid;this.gridSelect.onchange=()=>{this.grid=Number(this.gridSelect.value);this.render();};
    this.snapToggle=action('Snap',()=>{this.snap=!this.snap;this.snapToggle.setAttribute('aria-pressed',String(this.snap));});this.snapToggle.setAttribute('aria-pressed','true');
    this.rulerMode=el('select');this.rulerMode.setAttribute('aria-label','Arrangement ruler');this.rulerMode.add(new Option('Bars / beats','music'));this.rulerMode.add(new Option('Minutes / seconds','time'));this.rulerMode.value=this.prefs.ruler;this.rulerMode.onchange=()=>{this.prefs.ruler=this.rulerMode.value;this.persist();this.render();};
    this.addAudio=action('Add audio track',()=>this.w.run(()=>{const t=makeTrack('audio','Audio '+(this.w.snapshot.tracks.filter(t=>t.type==='audio').length+1));this.w.controller.command('track.create',t);this.w.selected=t.id;this.w.refresh();}));
    this.addClip=action('Add clip at cursor',()=>this.addMidiClip(this.w.selected,frameBeat(this.w.cursor||0,this.w.snapshot)));
    this.maximize=action('Expand Arrangement',()=>{this.prefs.maximized=this.prefs.maximized==='arrangement'?null:'arrangement';this.layout();});
    const view=el('details','ww-daw-view-menu'),summary=el('summary','','View panels');
    view.append(summary);
    for(const name of ['clip','mixer','effects','automation']){
      const label=this.windows.label(name);
      view.append(action('Show '+label,()=>{view.open=false;this.panel(name);}),
        action('Detach '+label,()=>{view.open=false;this.detachPane(name);}));
    }
    view.append(action('Reset layout',()=>{view.open=false;this.windows.closeAll({forget:true});this.prefs=defaultDawLayout();this.layout();}));
    tools.append(this.browserToggle,trackTools,this.addAudio,this.addClip,this.gridSelect,this.snapToggle,this.zoomOut,this.zoomIn,this.zoomFit,this.zoomValue,this.rulerMode,this.maximize,view);
    this.viewport=el('div','ww-daw-arrangement-scroll');this.viewport.tabIndex=0;this.viewport.setAttribute('aria-label','Arrangement timeline');this.content=el('div','ww-daw-arrangement-content');this.viewport.append(this.content);
    const rulerRow=el('div','ww-daw-ruler-row');this.corner=el('div','ww-daw-track-corner');this.buildMarkers();
    this.ruler=el('div','ww-daw-ruler');this.ruler.setAttribute('aria-label','Arrangement ruler — click to seek, drag to select interval');this.ruler.title='Click to seek · drag to select the loop/export interval';this.labels=el('div','ww-daw-ruler-labels');this.markers=el('div','ww-daw-markers');this.range=el('div','ww-daw-range');this.ruler.append(this.range,this.labels,this.markers);rulerRow.append(this.corner,this.ruler);this.body=el('div','ww-daw-arrangement-rows');this.playhead=el('div','ww-daw-playhead');this.content.append(rulerRow,this.body,this.playhead);this.timeline.append(tools,this.viewport);
    this.hSplit=this.splitter('vertical','browserWidth',160,480);this.upper.append(this.browser,this.hSplit,this.timeline);
    this.bottom=el('section','ww-daw-bottom');const tabs=el('div','ww-daw-panel-tabs');this.clipTab=action('Clip editor',()=>this.panel('clip'));this.mixerTab=action('Mixer',()=>this.panel('mixer'));this.bottomToggle=action('Hide editor',()=>{
      this.prefs.bottom=false;
      if(this.prefs.maximized==='editor')this.prefs.maximized=null;
      this.layout();
      this.collapsedTabs.querySelector('button').focus({preventScroll:true});
    },'ww-daw-hide-panel');this.bottomExpand=action('Expand editor',()=>{this.prefs.maximized=this.prefs.maximized==='editor'?null:'editor';this.layout();});this.detach=action('Detach active panel',()=>this.detachPane(this.prefs.panel));tabs.append(this.clipTab,this.mixerTab,this.bottomToggle,this.bottomExpand,this.detach);
    this.clipPane=el('div','ww-daw-clip-pane');this.clipPane.append(this.w.editor);this.mixerPane=el('div','ww-daw-mixer');this.mixerPane.append(this.w.trackScroll,master);this.detachedNotice=el('p','ww-muted ww-daw-detached-notice');this.bottom.append(tabs,this.clipPane,this.mixerPane,this.detachedNotice);
    this.vSplit=this.splitter('horizontal','bottomHeight',160,800);this.collapsedTabs=el('div','ww-daw-collapsed-tabs');this.collapsedTabs.append(
      action('Show Clip editor',()=>{this.panel('clip');if(!this.windows.has('clip'))this.clipTab.focus({preventScroll:true});}),
      action('Show Mixer',()=>{this.panel('mixer');if(!this.windows.has('mixer'))this.mixerTab.focus({preventScroll:true});})
    );this.root.append(this.upper,this.vSplit,this.bottom,this.collapsedTabs);
    this.buildTransport(transport);
    for(const [node,context] of [[this.viewport,'transport'],[transport,'transport'],[this.browser,'clip'],[this.bottom,null]]){
      const focus=()=>this.w.panelFocus(context||this.prefs.panel);
      node.addEventListener('focusin',focus);
      node.addEventListener('pointerdown',focus);
    }
    for(const [button,label,hint] of [[this.w.newButton,'New project','New project'],[this.w.openButton,'Open…','Open a .wsproj file'],[this.w.saveButton,'Save','Save project · Ctrl/Cmd+S'],[this.w.saveAsButton,'Save as…','Save to a new .wsproj file'],[this.w.undo,'Undo','Undo · Ctrl/Cmd+Z'],[this.w.redo,'Redo','Redo · Ctrl/Cmd+Shift+Z'],[this.w.recoverButton,'Recover project copy…','Recover a browser copy'],[this.w.play,'Play','Play project · Space'],[this.w.stop,'Stop','Stop · Space']]){
      button.setAttribute('aria-label',button.textContent);
      button.textContent=label;
      button.dataset.dawHint=button.title=hint;
    }
    const heading=this.w.node.firstElementChild;heading.lastElementChild.remove();
    this.empty=el('p','ww-daw-empty-arrangement','Add a MIDI or audio track, or drop a media file here.');this.content.append(this.empty);
    this.topActions=el('div','ww-daw-filebar');
    const file=popover('File',this.w.toolbar);
    this.w.toolbar.prepend(this.w.name.parentElement);
    this.w.toolbar.append(this.w.recoveryStatus);
    this.w.toolbar.addEventListener('click',event=>{
      if(event.target.closest('button')&&this.w.toolbar.matches(':popover-open'))this.w.toolbar.hidePopover();
    });
    this.topActions.append(file,this.w.toolbar,this.w.undo,this.w.redo,this.w.dirty);
    heading.append(this.topActions);
    const top=el('div','ww-daw-top');
    top.append(heading,transport);
    const statusLine=el('div','ww-daw-status-line');
    this.context=el('p','ww-daw-context');
    this.context.setAttribute('aria-live','polite');
    this.context.setAttribute('aria-atomic','true');
    this.focusHint=el('p','ww-muted ww-daw-focus-hint');
    statusLine.append(this.context,this.w.status,this.focusHint);
    this.w.node.replaceChildren(top,statusLine,this.root);
    this.w.node.addEventListener('focusin',({target})=>{
      this.focusHint.textContent=target.matches(':focus-visible, [role="separator"]')?target.dataset.dawHint||'':'';
    });
    this.w.node.addEventListener('focusout',()=>{this.focusHint.textContent='';});
    this.ruler.addEventListener('pointerdown',event=>this.rulerDown(event));this.viewport.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();this.zoom(this.prefs.zoom*Math.exp(-event.deltaY*.005),event.clientX-this.viewport.getBoundingClientRect().left);},{passive:false});
    this.viewport.addEventListener('keydown',event=>this.timelineKey(event));
    this.observer=new ResizeObserver(()=>this.measure());this.observer.observe(this.viewport);this.observer.observe(top);this.observer.observe(statusLine);addEventListener('resize',()=>this.measure());requestAnimationFrame(()=>this.measure());this.layout(false);
  }
  persist(){try{localStorage.setItem('waswan-daw-layout-v1',JSON.stringify(this.prefs));}catch{this.w.status.textContent='Layout could not be saved in this browser';}}
  splitter(orientation,key,min,max){
    const node=el('div','ww-daw-splitter');node.tabIndex=0;node.setAttribute('role','separator');node.setAttribute('aria-label',orientation==='horizontal'?'Resize lower panel':'Resize Track inspector');node.setAttribute('aria-orientation',orientation);node.setAttribute('aria-valuemin',min);node.setAttribute('aria-valuemax',max);let drag;
    node.dataset.dawHint=node.title='Arrow keys resize · Home resets the size';
    node.onpointerdown=e=>{e.preventDefault();node.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,value:this.prefs[key]};};node.onpointermove=e=>{if(!drag)return;this.prefs[key]=Math.max(min,Math.min(max,drag.value+(orientation==='horizontal'?drag.y-e.clientY:e.clientX-drag.x)));this.layout(false);};
    for(const event of ['pointerup','pointercancel','lostpointercapture'])node.addEventListener(event,()=>{if(drag){drag=null;this.persist();}});node.ondblclick=()=>{this.prefs[key]=defaultDawLayout()[key];this.layout();};
    node.onkeydown=e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();e.stopPropagation();this.prefs[key]=e.key==='Home'?defaultDawLayout()[key]:Math.max(min,Math.min(max,this.prefs[key]+(['ArrowUp','ArrowRight'].includes(e.key)?20:-20)));this.layout();};return node;
  }
  measure(){if(!this.w.node.offsetParent)return;const available=Math.max(320,this.root.ownerDocument.defaultView.innerHeight-this.root.getBoundingClientRect().top-28);this.available=available;this.root.style.height=available+'px';this.applyVisibility();if(this.viewport.clientWidth){this.headWidth=Math.max(224,Math.min(260,this.viewport.clientWidth*.23));this.root.style.setProperty('--daw-header-width',this.headWidth+'px');this.render();}}
  applyVisibility(){
    const p=this.prefs,max=p.maximized;this.browser.hidden=!p.browser||max==='arrangement';this.hSplit.hidden=this.browser.hidden;this.upper.hidden=max==='editor';this.bottom.hidden=!p.bottom||max==='arrangement';this.vSplit.hidden=this.bottom.hidden||max==='editor';this.collapsedTabs.hidden=!this.bottom.hidden;
    this.browser.style.width=p.browserWidth+'px';
    const timelineSpace=p.panel==='clip'?207:200;
    this.bottom.style.flexBasis=Math.max(160,Math.min(p.bottomHeight,(this.available||700)-timelineSpace))+'px';this.bottom.classList.toggle('is-expanded',max==='editor');for(const name of ['clip','mixer','effects','automation']){
      const pane=this.pane(name);
      if(pane)pane.hidden=!this.windows.has(name)&&p.panel!==name;
    }
    const detached=this.windows.has(p.panel);
    this.detachedNotice.hidden=!detached;
    this.detachedNotice.textContent=detached?this.windows.label(p.panel)+' is open in another window.':'';
    this.detach.textContent=detached?'Focus detached panel':'Detach active panel';for(const [name,button] of [['clip',this.clipTab],['mixer',this.mixerTab],['automation',this.autoTab],['effects',this.fxTab]])button?.setAttribute('aria-pressed',String(p.panel===name));this.browserToggle.textContent=p.browser?'Hide Track inspector':'Show Track inspector';this.maximize.textContent=max==='arrangement'?'Restore Arrangement':'Expand Arrangement';this.bottomExpand.textContent=max==='editor'?'Restore editor':'Expand editor';this.hSplit.setAttribute('aria-valuenow',p.browserWidth);this.vSplit.setAttribute('aria-valuenow',p.bottomHeight);
  }
  layout(save=true){this.applyVisibility();if(save)this.persist();this.measure();}
  pane(name){return {clip:this.clipPane,mixer:this.mixerPane,effects:this.fxPane,automation:this.autoPane}[name];}
  panel(name){
    this.prefs.panel=name;this.prefs.bottom=true;this.prefs.maximized=null;
    this.layout();this.w.panelFocus(name);this.windows.focus(name);
  }
  detachPane(name){
    this.prefs.panel=name;this.prefs.bottom=true;this.prefs.maximized=null;
    this.windows.open(name,this.pane(name));this.layout();
  }
  windowChanged(){this.layout(false);this.w.editors?.paint();this.w.mix?.paint();this.windows.status();}
  zoom(value,anchor){const old=this.prefs.zoom,next=Math.max(.01,Math.min(512,value)),x=anchor??(this.viewport.clientWidth+(this.headWidth||246))/2,beat=(this.viewport.scrollLeft+x-(this.headWidth||246))/old;this.prefs.zoom=next;this.render();this.viewport.scrollLeft=beat*next-x+(this.headWidth||246);this.persist();}
  fit(){const beats=arrangementBeats(this.w.snapshot)+4;this.zoom((this.viewport.clientWidth-(this.headWidth||246))/beats);this.viewport.scrollLeft=0;}
  buildTransport(parent){
    this.transportOptions=el('div','ww-daw-transport-options');
    this.loop=action('Loop',()=>this.w.changeTransport({loop:!this.transport().loop}));this.loop.setAttribute('aria-label','DAW transport loop');this.loop.title='Repeat the range · L';this.rangeStart=control('DAW range start beat','number',this.transportOptions);this.rangeEnd=control('DAW range end beat','number',this.transportOptions);for(const field of [this.rangeStart,this.rangeEnd]){field.min=1;field.step=.25;}this.rangeStart.onchange=()=>this.w.changeTransport({start:Math.round((Number(this.rangeStart.value)-1)*PPQ)});this.rangeEnd.onchange=()=>this.w.changeTransport({end:Math.round((Number(this.rangeEnd.value)-1)*PPQ)});
    this.meter=el('select');this.meter.setAttribute('aria-label','DAW time signature');for(const denominator of [4,8])for(let n=1;n<=12;n++)this.meter.add(new Option(n+'/'+denominator,n+'/'+denominator));this.meter.onchange=()=>this.w.edit('project.update',{meter:this.meter.value.split('/').map(Number)});
    const meterLabel=el('label','','Time signature');meterLabel.append(this.meter);
    this.transportOptions.prepend(meterLabel,this.w.length.parentElement);
    const home=action('Return to start',()=>this.w.seek(0));home.setAttribute('aria-label','Return to start');home.dataset.dawHint=home.title='Return to start · Home on the timeline';home.textContent='↤';parent.insertBefore(home,this.w.position);
    parent.append(this.loop,popover('Transport options',this.transportOptions),this.transportOptions);
    for(const [field,label] of [[this.w.name,'Project'],[this.w.tempo,'BPM'],[this.w.length,'Length (quarter beats)'],[this.rangeStart,'Range in'],[this.rangeEnd,'Range out']])field.parentElement.firstChild.textContent=label;
  }
  transport(){return this.w.snapshot.transport||{loop:false,start:0,end:this.w.snapshot.length};}
  buildBrowser(){
    this.selection=el('strong','','Select a track');this.selectedType=el('p','ww-muted');this.preset=el('select');this.preset.setAttribute('aria-label','Selected instrument preset');this.preset.onchange=()=>this.w.run(()=>this.w.selectInstrument(this.w.selected,this.preset.value));
    this.icon=el('select');this.icon.setAttribute('aria-label','Selected track icon');this.icon.append(...icons.map(name=>new Option(name,name)));this.icon.onchange=()=>this.w.edit('track.update',{id:this.w.selected,changes:{icon:this.icon.value}});this.color=control('Selected track color','color',this.browser);this.color.onchange=()=>this.w.edit('track.update',{id:this.w.selected,changes:{color:this.color.value}});
    this.includeClips=control('Include clips when duplicating','checkbox',this.browser);this.includeClips.checked=true;
    this.duplicate=action('Duplicate selected track',()=>this.w.run(()=>{this.w.controller.command('track.duplicate',{id:this.w.selected,clips:this.includeClips.checked});this.w.selected=this.w.controller.snapshot().tracks.at(-1).id;this.w.refresh();}));
    this.up=action('Move selected track up',()=>this.move(-1));this.down=action('Move selected track down',()=>this.move(1));this.remove=action('Delete selected track',()=>this.w.edit('track.remove',{id:this.w.selected}));
    this.height=control('Track height','range',this.browser);Object.assign(this.height,{min:56,max:180,step:4,value:this.prefs.trackHeight});this.height.oninput=()=>{this.prefs.trackHeight=Number(this.height.value);this.render();};this.height.onchange=()=>this.persist();
    this.browser.prepend(this.selection,this.selectedType,this.preset);this.browser.append(this.icon,this.duplicate,this.up,this.down,this.remove);
    const presets=el('details');
    const presetButton=(label,task)=>action(label,()=>this.w.run(async()=>{
      const track=this.w.selectedTrack();if(track)this.w.status.textContent=await task(track);
    }));
    this.saveTrackPreset=presetButton('Save track preset…',async track=>'Saved '+await saveTrackPreset(track,'track',options=>this.w.pick('showSaveFilePicker',options)));
    this.saveInstrumentPreset=presetButton('Save instrument preset…',async track=>'Saved '+await saveTrackPreset(track,'instrument',options=>this.w.pick('showSaveFilePicker',options)));
    this.loadTrackPreset=presetButton('Load preset on track…',async track=>'Applied '+await loadTrackPreset(this.w.controller,track,options=>this.w.pick('showOpenFilePicker',options)));
    presets.append(el('summary','','Track presets'),this.saveTrackPreset,this.saveInstrumentPreset,this.loadTrackPreset);
    this.browser.append(presets);
  }
  buildMarkers(){
    const marker=el('div','ww-daw-marker-editor');
    this.markerToggle=popover('Markers',marker);
    this.markerToggle.title='Add or edit markers on the ruler';
    this.markerSelect=el('select');this.markerSelect.setAttribute('aria-label','DAW markers');this.markerSelect.onchange=()=>this.markerFields();
    const selected=el('label','','Marker');selected.append(this.markerSelect);marker.append(selected);
    this.markerName=control('Marker name','text',marker);this.markerBeat=control('Marker beat','number',marker);this.markerBeat.min=1;this.markerBeat.step=1/PPQ;
    this.addMarker=action('Add marker at cursor',()=>this.addMarkerAtCursor());
    this.applyMarker=action('Apply marker',()=>this.w.run(()=>{const tick=Math.round((Number(this.markerBeat.value)-1)*PPQ);this.w.controller.command('batch',{commands:[...this.extendCommand(tick),{type:'marker.update',payload:{id:this.markerSelect.value,changes:{name:this.markerName.value,tick}}}]});}));this.deleteMarker=action('Delete marker',()=>this.w.edit('marker.remove',{id:this.markerSelect.value}));marker.append(this.addMarker,this.applyMarker,this.deleteMarker);
    this.corner.append(el('span','','Tracks'),this.markerToggle,marker);
  }
  markerFields(){
    const marker=this.w.snapshot.markers.find(m=>m.id===this.markerSelect.value);
    const key=JSON.stringify([this.w.snapshot.id,marker]);
    if(this.markerEditKey===key)return;
    this.markerEditKey=key;
    this.markerName.value=marker?.name||'';
    this.markerBeat.value=marker?marker.tick/PPQ+1:'';
  }
  renderMarkers(project,zoom){
    for(const [id,button] of this.markerButtons){
      if(project.markers.some(marker=>marker.id===id))continue;
      if(button===button.ownerDocument.activeElement)this.markerToggle.focus({preventScroll:true});
      button.remove();
      this.markerButtons.delete(id);
    }
    for(const [index,marker] of project.markers.entries()){
      let button=this.markerButtons.get(marker.id);
      if(!button){
        button=action(marker.name,()=>{
          const current=this.w.snapshot.markers.find(m=>m.id===marker.id);
          if(!current)return;
          this.markerSelect.value=current.id;
          this.markerFields();
          return this.w.seek(beatFrame(current.tick/PPQ,this.w.snapshot));
        });
        this.markerButtons.set(marker.id,button);
      }
      if(this.markers.children[index]!==button)this.markers.insertBefore(button,this.markers.children[index]||null);
      button.textContent=marker.name;
      button.style.left=marker.tick/PPQ*zoom+'px';
      button.title=marker.name+' · '+musicalPosition(marker.tick/PPQ,project);
      button.setAttribute('aria-label','Go to marker '+marker.name);
    }
    const key=JSON.stringify(project.markers.map(({id,name})=>[id,name]));
    if(this.markerListKey!==key){
      const selected=this.markerSelect.value;
      this.markerSelect.replaceChildren(...project.markers.map(m=>new Option(m.name,m.id)));
      if(project.markers.some(m=>m.id===selected))this.markerSelect.value=selected;
      this.markerListKey=key;
    }
    this.markerFields();
  }
  extendCommand(tick){const p=this.w.snapshot;if(tick<=p.length)return [];return [{type:'project.update',payload:{length:tick,...(p.transport?.end===p.length?{transport:{...p.transport,end:tick}}:{})}}];}
  addMarkerAtCursor(){return this.w.run(()=>{const p=this.w.snapshot,tick=Math.max(0,Math.round(frameBeat(this.w.cursor||0,p)*PPQ)),id=uuid();this.w.controller.command('batch',{commands:[...this.extendCommand(tick),{type:'marker.add',payload:{id,name:this.markerName.value||'Marker '+(p.markers.length+1),tick}}]});this.markerSelect.value=id;this.markerFields();});}
  move(delta){const tracks=this.w.snapshot.tracks,index=tracks.findIndex(t=>t.id===this.w.selected),next=index+delta;if(next>=0&&next<tracks.length)this.w.edit('track.move',{id:this.w.selected,index:next});}
  selectTrack(id){this.w.clearClipSelection=false;this.w.clipTools?.selected.clear();this.w.selected=id;this.w.selectedClip=null;this.w.selectedNote=null;this.w.refresh();}
  makeRow(track){
    const row=el('div','ww-daw-arrangement-row'),header=el('div','ww-daw-track-header'),lane=el('div','ww-daw-lane'),choose=action('Select '+track.name,()=>this.selectTrack(track.id)),name=el('input'),type=el('small','ww-muted'),controls=el('div','ww-daw-header-controls');row.dataset.trackId=track.id;name.setAttribute('aria-label','Arrangement track name');name.onchange=()=>this.w.edit('track.update',{id:track.id,changes:{name:name.value}});
    const fold=action('Collapse '+track.name,()=>{const set=new Set(this.prefs.folded);set.has(track.id)?set.delete(track.id):set.add(track.id);this.prefs.folded=[...set];this.layout();});fold.textContent='▾';fold.setAttribute('aria-label','Collapse '+track.name);choose.textContent='↦';choose.setAttribute('aria-label','Select '+track.name);
    const drag=action('Move track',()=>{this.selectTrack(track.id);this.prefs.browser=true;this.layout();});drag.textContent='⋮⋮';drag.setAttribute('aria-label','Move track');drag.draggable=true;drag.title='Drag to reorder · Alt + ↑/↓ with focus · click for track controls';drag.ondragstart=e=>{if(this.locked())return e.preventDefault();this.dragTrack=track.id;e.dataTransfer.setData('text/waswan-track',track.id);};drag.ondragend=()=>{this.dragTrack=null;};drag.onkeydown=e=>{if(e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();e.stopPropagation();this.w.selected=track.id;this.move(e.key==='ArrowUp'?-1:1);drag.focus();}};
    const volume=control('Header track volume','range',controls);Object.assign(volume,{min:0,max:2,step:.01});volume.oninput=()=>this.w.edit('track.update',{id:track.id,changes:{volume:Number(volume.value)}});const pan=control('Header track pan','range',controls);Object.assign(pan,{min:-1,max:1,step:.01});pan.oninput=()=>this.w.edit('track.update',{id:track.id,changes:{pan:Number(pan.value)}});
    volume.parentElement.className='ww-daw-header-volume';
    volume.parentElement.firstChild.textContent='Vol';
    pan.parentElement.className='ww-daw-header-pan';
    pan.parentElement.firstChild.textContent='Pan';
    const mute=action('Mute '+track.name,()=>this.w.edit('track.update',{id:track.id,changes:{mute:!this.w.snapshot.tracks.find(t=>t.id===track.id).mute}})),solo=action('Solo '+track.name,()=>this.w.edit('track.update',{id:track.id,changes:{solo:!this.w.snapshot.tracks.find(t=>t.id===track.id).solo}})),meter=el('meter');mute.textContent='M';solo.textContent='S';meter.min=0;meter.max=1;meter.value=0;meter.setAttribute('aria-label','Track peak amplitude');const arm=action('Arm '+track.name,()=>this.w.armTrack(track.id));arm.textContent='R';arm.setAttribute('aria-label','Arm '+track.name);controls.append(mute,solo,arm,meter);header.append(drag,choose,name,fold,type,controls);lane.ondblclick=e=>{if(e.target===lane)this.addMidiClip(track.id,this.beatAt(e,lane));};lane.onclick=e=>{if(e.target===lane){this.selectTrack(track.id);this.viewport.focus();}};row.append(header,lane);
    row.ondragover=e=>{if(this.dragTrack&&!this.locked())e.preventDefault();};row.ondrop=e=>{if(!this.dragTrack||this.locked())return;e.preventDefault();const index=this.w.snapshot.tracks.findIndex(t=>t.id===track.id);this.w.edit('track.move',{id:this.dragTrack,index});this.dragTrack=null;};return {row,header,lane,choose,name,type,volume,pan,mute,solo,arm,meter,fold,drag};
  }
  locked(){return this.w.busy||this.w.recorder?.busy||this.w.player.playing||this.w.player.starting||this.w.monitor?.preparing||this.w.importer?.busy||this.w.audition?.busy;}
  controls(){
    if(!this.w.snapshot)return;const locked=this.locked(),p=this.w.snapshot,t=this.w.selectedTrack();
    for(const row of this.rows.values()){row.name.disabled=locked;row.drag.disabled=locked;row.arm.disabled=locked;row.arm.setAttribute('aria-label','Arm '+p.tracks.find(t=>t.id===row.row.dataset.trackId)?.name);row.arm.setAttribute('aria-pressed',String(!!p.tracks.find(t=>t.id===row.row.dataset.trackId)?.arm));for(const [field,target] of [[row.volume,'volume'],[row.pan,'pan']])field.disabled=this.w.busy||this.w.player.playing&&p.automation.some(l=>l.enabled&&l.trackId===row.row.dataset.trackId&&l.target===target&&l.points.length);row.mute.disabled=this.w.busy;row.solo.disabled=this.w.busy;}
    for(const field of [this.preset,this.icon,this.color,this.duplicate,this.up,this.down,this.remove])field.disabled=locked||!t;this.preset.disabled=locked||!this.w.running||t?.type!=='midi';this.saveTrackPreset.disabled=this.loadTrackPreset.disabled=locked||!t;this.saveInstrumentPreset.disabled=locked||!t?.instrument;this.addAudio.disabled=locked||p.tracks.length>=32;this.duplicate.disabled=locked||!t||p.tracks.length>=32;this.addClip.disabled=locked||t?.type!=='midi'||p.clips.length>=512;this.meter.disabled=locked;for(const field of [this.rangeStart,this.rangeEnd,this.loop])field.disabled=this.w.busy||this.w.recorder?.busy;
    this.addMarker.disabled=locked||p.markers.length>=256;
    this.applyMarker.disabled=this.deleteMarker.disabled=this.markerBeat.disabled=locked||!p.markers.length;
    this.markerName.disabled=locked;
    this.markerSelect.disabled=!p.markers.length;
    this.updateContext();
  }
  updateContext(){
    const track=this.w.selectedTrack(),clip=this.w.clip(),hasClips=this.w.snapshot.clips.some(c=>c.trackId===track?.id);
    const selection=clip?(clip.type==='midi'?'Piano Roll':'Waveform')+' · '+clip.name:
      !track?'Add a MIDI or audio track to begin':
        hasClips?track.name+' · Select a clip to edit':
          track.name+(track.type==='midi'?' · Double-click the lane to create a clip':' · Import audio or record a take');
    const text=(this.w.running?'':'Audio is off · ')+selection;
    if(this.context.textContent!==text)this.context.textContent=text;
  }
  beatAt(event,node){return snapBeat((event.clientX-node.getBoundingClientRect().left)/this.prefs.zoom,this.grid,this.snap);}
  addMidiClip(trackId,beat){if(this.w.player.playing||this.w.player.starting){this.w.error(Error('Stop playback before creating a clip'));return;}void this.w.run(()=>{const track=this.w.snapshot.tracks.find(t=>t.id===trackId);if(!track||track.type!=='midi')throw Error('Select a MIDI track for notes; use Import for audio');const length=Math.round(this.w.snapshot.meter[0]*4/this.w.snapshot.meter[1]*PPQ),position=Math.round(snapBeat(beat,this.grid,this.snap)*PPQ),id=uuid();this.w.controller.command('batch',{commands:[...this.extendCommand(position+length),{type:'clip.add',payload:{id,type:'midi',trackId,name:track.name+' clip',position:{unit:'ticks',value:position},length,loopLength:length,loop:false,notes:[]}}]});this.w.selected=trackId;this.w.selectedClip=id;this.w.refresh();this.panel('clip');});}
  rulerDown(event){
    if(event.target.closest('button')||event.button!==0)return;event.preventDefault();this.ruler.setPointerCapture(event.pointerId);const start=this.beatAt(event,this.ruler),x=event.clientX;let end=start,moved=false;
    const move=e=>{if(Math.abs(e.clientX-x)>4)moved=true;if(moved){end=this.beatAt(e,this.ruler);this.showRange(Math.min(start,end)*PPQ,Math.max(start,end)*PPQ);}};
    const finish=e=>{this.ruler.removeEventListener('pointermove',move);this.ruler.removeEventListener('pointerup',finish);this.ruler.removeEventListener('pointercancel',cancel);if(moved){const inTick=Math.round(Math.min(start,end)*PPQ),outTick=Math.round(Math.max(start,end)*PPQ);if(outTick>inTick)void this.w.changeTransport({start:inTick,end:outTick});else this.render();}else void this.w.seek(beatFrame(start,this.w.snapshot));};const cancel=()=>{this.ruler.removeEventListener('pointermove',move);this.ruler.removeEventListener('pointerup',finish);this.ruler.removeEventListener('pointercancel',cancel);this.render();};this.ruler.addEventListener('pointermove',move);this.ruler.addEventListener('pointerup',finish);this.ruler.addEventListener('pointercancel',cancel);
  }
  showRange(start,end){this.range.style.left=start/PPQ*this.prefs.zoom+'px';this.range.style.width=(end-start)/PPQ*this.prefs.zoom+'px';}
  timelineKey(event){
    if(event.key!=='Home'||event.target.closest('input, select, textarea, button'))return;
    event.preventDefault();event.stopPropagation();void this.w.seek(0);
  }
  render(event){
    if(!this.w.snapshot)return;const p=this.w.snapshot,zoom=this.prefs.zoom,width=Math.max(this.viewport.clientWidth,(this.headWidth||246)+(arrangementBeats(p)+4)*zoom),beats=(width-(this.headWidth||246))/zoom,locked=this.locked();this.content.style.width=width+'px';this.empty.hidden=!!p.tracks.length;let gridPixels=zoom*this.grid;while(gridPixels<8)gridPixels*=2;this.root.style.setProperty('--daw-grid-px',gridPixels+'px');this.zoomValue.textContent=(zoom<2?zoom.toFixed(2):Math.round(zoom))+' px/beat';this.zoomIn.disabled=zoom>=512;this.zoomOut.disabled=zoom<=.01;
    this.labels.replaceChildren();let step=this.prefs.ruler==='time'?Math.max(1,Math.ceil(75/(zoom*p.bpm/60))):Math.max(1,Math.ceil(75/zoom));while((this.prefs.ruler==='time'?beats*60/p.bpm:beats)/step>1000)step*=2;
    const maximum=this.prefs.ruler==='time'?beats*60/p.bpm:beats;for(let value=0;value<=maximum;value+=step){const beat=this.prefs.ruler==='time'?value*p.bpm/60:value,label=el('span','',this.prefs.ruler==='time'?secondsPosition(value):musicalPosition(beat,p).replace(/\.000$/,''));label.style.left=beat*zoom+'px';this.labels.append(label);}
    this.renderMarkers(p,zoom);
    for(const [id,row] of this.rows)if(!p.tracks.some(t=>t.id===id)){row.row.remove();this.rows.delete(id);}
    for(const [index,t] of p.tracks.entries()){
      const row=this.rows.get(t.id)||this.makeRow(t);this.rows.set(t.id,row);if(this.body.children[index]!==row.row)this.body.insertBefore(row.row,this.body.children[index]||null);const folded=this.prefs.folded.includes(t.id);row.row.style.height=(folded?36:this.prefs.trackHeight)+'px';row.row.classList.toggle('is-selected',this.w.selected===t.id);row.row.classList.toggle('is-folded',folded);row.row.classList.toggle('is-compact',this.prefs.trackHeight<80);row.row.style.setProperty('--track-color',t.color);if(row.name.ownerDocument.activeElement!==row.name)row.name.value=t.name;row.type.textContent=t.type.toUpperCase()+' · '+t.icon;row.choose.setAttribute('aria-label','Select '+t.name);row.choose.setAttribute('aria-pressed',String(this.w.selected===t.id));row.fold.setAttribute('aria-label',(folded?'Expand ':'Collapse ')+t.name);row.fold.textContent=folded?'▸':'▾';
      if(row.iconName!==t.icon){row.choose.replaceChildren(trackIcon(t.icon));row.iconName=t.icon;}
      row.choose.title='Select '+t.name;
      row.fold.title=(folded?'Expand ':'Collapse ')+t.name;
      for(const [button,hint] of [[row.arm,'Arm '+t.name+' for recording'],[row.mute,'Mute '+t.name],[row.solo,'Solo '+t.name],[row.choose,row.choose.title],[row.fold,row.fold.title],[row.drag,row.drag.title]]){
        button.dataset.dawHint=button.title=hint;
      }
      for(const [field,name,value] of [[row.volume,'Volume',volumeText(t.volume)],[row.pan,'Pan',panText(t.pan)]]){
        field.title=name+' · '+value;
        field.setAttribute('aria-valuetext',value);
      }
      for(const [field,value] of [[row.volume,t.volume],[row.pan,t.pan]])if(field.ownerDocument.activeElement!==field)field.value=value;row.name.disabled=locked;row.drag.disabled=locked;row.arm.disabled=locked;row.arm.setAttribute('aria-label','Arm '+p.tracks.find(t=>t.id===row.row.dataset.trackId)?.name);row.arm.setAttribute('aria-pressed',String(!!p.tracks.find(t=>t.id===row.row.dataset.trackId)?.arm));row.volume.disabled=this.w.busy||this.w.player.playing&&p.automation.some(l=>l.enabled&&l.trackId===t.id&&l.target==='volume'&&l.points.length);row.pan.disabled=this.w.busy||this.w.player.playing&&p.automation.some(l=>l.enabled&&l.trackId===t.id&&l.target==='pan'&&l.points.length);for(const [button,on,label] of [[row.mute,t.mute,'Mute '],[row.solo,t.solo,'Solo ']]){button.setAttribute('aria-label',label+t.name);button.setAttribute('aria-pressed',String(on));button.disabled=this.w.busy;}
    }
    for(const [id,clip] of this.clips)if(!p.clips.some(c=>c.id===id)){clip.remove();this.clips.delete(id);}
    for(const c of p.clips){
      let button=this.clips.get(c.id);if(!button){button=action('',()=>{const current=this.w.snapshot.clips.find(clip=>clip.id===c.id);if(!current)return;this.w.selected=current.trackId;this.w.selectedClip=c.id;this.w.selectedNote=null;this.w.refresh();this.panel('clip');});button.className='ww-daw-arrangement-clip';button.dataset.clipId=c.id;button.label=el('span');button.preview=el('canvas');button.preview.setAttribute('aria-hidden','true');button.append(button.label,button.preview);this.clips.set(c.id,button);}
      const row=this.rows.get(c.trackId);if(button.parentElement!==row.lane)row.lane.append(button);const start=clipBeat(c,p),length=clipBeats(c,p);button.style.left=start*zoom+'px';button.style.width=Math.max(3,length*zoom)+'px';button.classList.toggle('is-selected',(this.w.clipTools?this.w.clipTools.selected.has(c.id):this.w.selectedClip===c.id));button.dataset.type=c.type;button.classList.toggle('is-looped',c.type==='midi'&&c.loop);button.style.setProperty('--clip-loop-px',c.type==='midi'?c.loopLength/PPQ*zoom+'px':'0px');button.label.textContent=c.name+(c.type==='midi'&&c.loop?' · Loop × '+Math.ceil(c.length/c.loopLength):'');button.setAttribute('aria-label','Select clip '+c.name);button.setAttribute('aria-pressed',String((this.w.clipTools?this.w.clipTools.selected.has(c.id):this.w.selectedClip===c.id)));button.title=`${c.name} · ${c.type.toUpperCase()} · ${c.position.unit==='seconds'?'seconds anchor':'musical anchor'} · ${musicalPosition(start,p)} · ${length.toFixed(2)} quarter beats`;
    }
    const t=this.w.selectedTrack();this.selection.textContent=t?.name||'Select a track';this.selectedType.textContent=t?t.type.toUpperCase()+(t.type==='midi'?' · '+shortSound(t.instrument?.patch):' · Audio source clips'):'';if(t){this.color.value=t.color;this.icon.value=t.icon;}this.preset.hidden=t?.type!=='midi';if(this.library!==this.w.programs||this.kits!==this.w.drumKits||this.selectedInstrument!==t?.instrument?.patch.join(',')){this.preset.replaceChildren(...this.w.instrumentOptions(shortSound(t?.instrument?.patch)));this.library=this.w.programs;this.kits=this.w.drumKits;this.selectedInstrument=t?.instrument?.patch.join(',');}this.preset.value='';
    for(const field of [this.preset,this.icon,this.color,this.duplicate,this.up,this.down,this.remove])field.disabled=locked||!t;this.preset.disabled=locked||!this.w.running||t?.type!=='midi';this.saveTrackPreset.disabled=this.loadTrackPreset.disabled=locked||!t;this.saveInstrumentPreset.disabled=locked||!t?.instrument;this.addAudio.disabled=locked;this.addClip.disabled=locked||t?.type!=='midi';this.meter.disabled=locked;this.rangeStart.disabled=this.w.busy||this.w.recorder?.busy;this.rangeEnd.disabled=this.w.busy||this.w.recorder?.busy;this.loop.disabled=this.w.busy||this.w.recorder?.busy;
    const transport=this.transport();this.loop.setAttribute('aria-pressed',String(transport.loop));if(this.rangeStart.ownerDocument.activeElement!==this.rangeStart)this.rangeStart.value=transport.start/PPQ+1;if(this.rangeEnd.ownerDocument.activeElement!==this.rangeEnd)this.rangeEnd.value=transport.end/PPQ+1;this.meter.value=p.meter.join('/');this.showRange(transport.start,transport.end);
    this.controls();this.w.paintPosition();this.ensurePeaks();if(!event||!['track.update','master.update','project.update'].includes(event.type))this.drawClipVisuals();
  }
  ensurePeaks(){
    const p=this.w.snapshot;if(this.peakProject!==p.id){clearTimeout(this.peakJob?.timer);this.peakJob?.worker.terminate();this.peakJob=null;this.peakQueue=[];this.peaks.clear();this.peakProject=p.id;}
    const assets=this.w.controller.assets;for(const id of new Set(p.clips.filter(c=>c.type==='audio').map(c=>c.assetId))){const source=assets.get(id),meta=p.assets.find(a=>a.id===id),old=this.peaks.get(id);if(old?.source===source)continue;if(this.peakJob?.id===id){clearTimeout(this.peakJob.timer);this.peakJob.worker.terminate();this.peakJob=null;}const entry={source,frames:meta.frames};this.peaks.set(id,entry);this.peakQueue.push({id,entry});}
    while(this.peaks.size>64){const id=this.peaks.keys().next().value;if(p.assets.some(a=>a.id===id))break;this.peaks.delete(id);}this.nextPeaks();
  }
  nextPeaks(){
    if(this.peakJob)return;let task;while((task=this.peakQueue.shift())){if(this.peaks.get(task.id)===task.entry)break;task=null;}if(!task)return;
    const worker=new Worker(new URL('./daw-media-worker.js',import.meta.url),{type:'module'}),job={...task,worker};this.peakJob=job;
    const finish=(peaks,error)=>{clearTimeout(timer);worker.terminate();if(this.peakJob!==job)return;this.peakJob=null;if(this.peaks.get(job.id)===job.entry){job.entry.peaks=peaks;job.entry.error=error;this.drawClipVisuals(job.id);this.w.editors?.paintAudio();}this.nextPeaks();};
    const timer=setTimeout(()=>finish(null,'Waveform preview timed out'),30000);job.timer=timer;worker.onmessage=({data:m})=>finish(m.peaks,m.error);worker.onerror=e=>{e.preventDefault();finish(null,'Waveform preview failed');};worker.postMessage({kind:'peaks',source:job.entry.source,frames:job.entry.frames});
  }
  drawClipVisuals(assetId){
    for(const clip of this.w.snapshot.clips){if(assetId&&clip.assetId!==assetId)continue;const button=this.clips.get(clip.id);if(!button)continue;const canvas=button.preview,width=Math.max(1,Math.min(512,Math.round(clipBeats(clip,this.w.snapshot)*this.prefs.zoom))),height=36;canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);ctx.fillStyle=clip.type==='midi'?'#e2d4f4aa':'#a4def4bb';
      if(clip.type==='midi'){
        let min=127,max=0;for(const n of clip.notes){min=Math.min(min,n.pitch);max=Math.max(max,n.pitch);}const span=Math.max(12,max-min+1),first=clip.loop?Math.floor((clip.offsetTicks||0)/clip.loopLength):0,count=clip.loop?Math.ceil((clip.length+(clip.offsetTicks||0))/clip.loopLength):1,stride=Math.max(1,Math.ceil((count-first)/256));let drawn=0;
        for(let repeat=first;repeat<count&&drawn<2048;repeat+=stride)for(const n of clip.notes){if(drawn++>=2048)break;const start=repeat*clip.loopLength+n.start-(clip.offsetTicks||0);if(start>=clip.length||start+n.duration<=0)continue;ctx.fillRect(Math.max(0,start)/clip.length*width,(max-n.pitch)/span*(height-3),Math.max(1,(Math.min(start+n.duration,clip.length)-Math.max(0,start))/clip.length*width),3);}
      }else{
        const source=this.peaks.get(clip.assetId),peaks=source?.peaks;if(!peaks){ctx.font='10px sans-serif';ctx.fillText(source?.error||'Loading waveform…',4,20);continue;}const bins=peaks.length/2;
        for(let x=0;x<width;x++){const start=Math.floor((clip.offset+clip.frames*x/width)/source.frames*bins),end=Math.min(bins,Math.max(start+1,Math.ceil((clip.offset+clip.frames*(x+1)/width)/source.frames*bins)));let min=0,max=0;for(let b=start;b<end;b++){min=Math.min(min,peaks[b*2]);max=Math.max(max,peaks[b*2+1]);}ctx.fillRect(x,(1-max)*height/2,1,Math.max(1,(max-min)*height/2));}
      }
    }
  }
  position(frame){this.playhead.style.left=((this.headWidth||246)+frameBeat(frame,this.w.snapshot)*this.prefs.zoom)+'px';}
  meters(){
    this.w.mix?.meters();
    for(const [id,row] of this.rows){
      const source=this.w.player.tracks.get(id)?.meter;
      let peak=0;
      if(source){
        source.getFloatTimeDomainData(this.meterSamples);
        for(const sample of this.meterSamples)if(Number.isFinite(sample))peak=Math.max(peak,Math.abs(sample));
      }
      const label=peak?`${(20*Math.log10(peak)).toFixed(1)} dBFS peak`:'−∞ dBFS peak';
      for(const meter of [row.meter,this.w.rows.get(id)?.meter])if(meter){
        meter.value=Math.min(1,peak);meter.title=label;meter.setAttribute('aria-valuetext',label);
      }
    }
  }
}
