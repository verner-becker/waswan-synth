// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {DawAudioExport,planAudioExport} from './daw-audio-export.js';
import {RATE} from './daw-project.js';

const scopes=[['Mix','mix'],['Range in/out','range'],['Selected clips','selection'],['Selected track','track'],['All tracks as stems','stems']];
function select(name,options){
  const input=el('select');
  for(const [label,value] of options)input.add(new Option(label,value));
  const field=el('label','',name+' ');
  field.append(input);
  return {field,input};
}
export class DawExportPanel {
  constructor(workspace,transport){
    this.w=workspace;
    this.exporter=new DawAudioExport(workspace);
    this.open=action('Export audio…',()=>this.show('mix'));
    this.range=action('Export range…',()=>this.show('range'));
    this.selection=action('Export selected clips as audio…',()=>this.show('selection'));
    workspace.toolbar.append(this.open);
    transport.append(this.range);
    workspace.clipTools.bar.append(this.selection);
    this.dialog=el('dialog','ww-map-dialog');
    this.dialog.setAttribute('aria-label','Export DAW audio');
    this.scope=select('Export source',scopes);
    this.format=select('Audio format',[['WAV · stereo PCM16','wav'],['MP3 · stereo 192 kbps','mp3']]);
    this.tail=select('Tail',[['No added tail',0],['2 seconds',2],['4 seconds',4],['8 seconds',8]]);
    this.detail=el('p','ww-muted');
    this.status=el('p','', '');
    this.status.setAttribute('role','status');
    this.progress=el('progress');
    this.progress.setAttribute('aria-label','Audio export progress');
    this.progress.max=1;
    this.start=action('Choose destination and export…',()=>this.submit(),'ww-primary');
    this.cancel=action('Cancel audio export',()=>this.abort());
    const controls=el('div','ww-studio-actions');
    controls.append(this.start,this.cancel);
    this.dialog.append(el('h2','','Export audio'),this.scope.field,this.format.field,this.tail.field,this.detail,this.progress,this.status,controls);
    for(const {input} of [this.scope,this.format,this.tail])input.onchange=()=>this.describe();
    this.dialog.oncancel=event=>{event.preventDefault();this.abort();};
    document.body.append(this.dialog);
  }
  options(){
    return {scope:this.scope.input.value,format:this.format.input.value,tail:Number(this.tail.input.value),
      trackId:this.w.selected,clipIds:new Set(this.w.clipTools.selected)};
  }
  describe(){
    const stems=this.scope.input.value==='stems';
    if(stems)this.format.input.value='wav';
    this.format.input.disabled=stems;
    try{
      const plan=planAudioExport(this.w.snapshot,this.options());
      const isolated=plan.scope==='track'||stems;
      const seconds=n=>(n/RATE).toFixed(2)+' s';
      this.detail.textContent=seconds(plan.frames)+' per file. Renders in real time ('+seconds(plan.end+plan.tailFrames)+'). '+
        (isolated?'Track effects, volume and pan. Includes muted tracks.':'Includes DAW Master effects and volume.');
      this.start.disabled=false;
    }catch(error){this.detail.textContent=error.message;this.start.disabled=true;}
  }
  show(scope){
    if(this.dialog.open)return;
    this.scope.input.value=scope;
    this.format.input.value='wav';
    this.tail.input.value=scope==='mix'?'2':'0';
    this.scope.input.disabled=false;
    this.tail.input.disabled=false;
    this.status.textContent='';
    this.progress.hidden=true;
    this.cancel.textContent='Cancel audio export';
    this.describe();
    this.dialog.showModal();
  }
  abort(){
    if(this.exporter.busy){this.cancel.disabled=true;this.status.textContent='Cancelling export…';this.exporter.cancel();}
    else this.dialog.close();
  }
  submit(){
    const options=this.options();
    void this.w.run(async()=>{
      this.start.disabled=this.scope.input.disabled=this.format.input.disabled=this.tail.input.disabled=true;
      this.progress.hidden=false;this.progress.value=0;
      this.status.textContent='Choose a destination';
      try{
        const result=await this.exporter.choose(options,(message,fraction)=>{
          if(this.exporter.job?.signal.aborted)return;
          this.status.textContent=message;this.progress.value=fraction;
        });
        this.dialog.close();
        this.w.status.textContent=(result.files===1?'Exported ':'Exported '+result.files+' files to ')+result.name+
          (result.clipped.some(Number)?' · Peaks clipped. Lower the mix level and export again for unclipped audio.':'');
      }catch(error){
        this.status.textContent=error.name==='AbortError'?'Audio export cancelled':error.message;
        this.progress.hidden=true;
        this.scope.input.disabled=this.tail.input.disabled=false;
        this.describe();
      }finally{this.cancel.disabled=false;}
    });
  }
  refresh(locked){
    const enabled=!locked&&this.w.running&&this.w.snapshot.tracks.length>0;
    this.open.disabled=this.range.disabled=!enabled;
    this.selection.disabled=!enabled||!this.w.clipTools.selected.size;
  }
}
