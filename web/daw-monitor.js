// SPDX-License-Identifier: GPL-3.0-only
import {DawMidiRouter} from './daw-input.js';
import {assignSlots} from './daw-playback.js';
import {instrumentBinding} from './daw-player.js';
const samePatch=(a,b)=>a===b||!!a&&a.length===b?.length&&a.every((v,i)=>v===b[i]);
export class DawMonitor {
  constructor(workspace){
    this.w=workspace;this.enabled=false;this.ready=false;this.channel=null;
    this.router=new DawMidiRouter({controller:workspace.bridge.midi,target:()=>this.target(),command:(type,data)=>this.command(type,data),protect:()=>workspace.player.playing||workspace.player.starting||workspace.audition?.busy,onRelease:()=>workspace.recorder?.inputReleased(),onChange:()=>this.inputChanged()});workspace.bridge.midi.dawRouter=this.router;
  }
  track(){const recording=this.w.recorder;return recording?.busy&&recording.track?.type==='midi'?this.w.snapshot.tracks.find(t=>t.id===recording.track.id):this.w.selectedTrack();}
  allowed(track){return track?.monitor==='in'||track?.monitor==='auto'&&(!this.w.player.playing||this.w.recorder?.busy&&this.w.recorder?.track?.id===track.id);}
  target(){const track=this.track();if(track?.type!=='midi')return null;const part=this.w.player.slots.get(track.id);return {trackId:track.id,part,audible:this.ready&&Number.isInteger(part)&&this.allowed(track),channel:this.channel,sampler:track.instrument?.type==='sampler'};}
  command(type,data){if(!this.token)return;void this.w.player.requests().request(type,{...data,token:this.token,projectId:this.w.controller.snapshot().id}).catch(error=>this.w.error(error));}
  async ensureSession(){
    await this.closing;
    if(this.token)return;
    if(this.w.bridge.isStudioBusy?.())throw Error('Stop Studio before enabling a DAW input');
    if(!this.w.running)throw Error('Start audio before enabling a DAW input');
    const token=crypto.randomUUID();
    await this.w.player.openLive(this.w.controller,token);
    this.token=token;
  }
  async releaseUnusedSession(){
    if(this.enabled||this.w.recorder?.audioTrackId)return;
    const token=this.token;
    if(token){
      this.token=null;
      this.closing=this.w.player.closeLive(token).catch(error=>this.w.error(error));
    }
    await this.closing;
  }
  async enable(){
    if(this.enabled){await this.refresh();return;}
    await this.ensureSession();
    this.enabled=true;this.ready=true;this.router.enable();this.updateMix();this.w.refreshControls();
  }
  async disable(){
    if(this.enabled&&this.w.recorder?.audioTrackId){
      for(const part of new Set(this.router.parts.flatMap(parts=>[...parts])))this.router.dropPart(part);
    }
    this.enabled=false;this.ready=false;this.router.disable();
    this.updateMix();
    await this.releaseUnusedSession();
    this.w.refreshControls();
  }
  invalidate(){this.enabled=false;this.ready=false;this.router.disable();this.token=null;this.w.player.liveSessionToken=null;}
  needsPreparation(project){
    const slots=assignSlots(project),player=this.w.player;if(player.projectId!==project.id||slots.size!==player.slots.size||project.tracks.length!==player.tracks.size)return true;
    return project.tracks.some(t=>t.type==='midi'&&t.instrument&&(!samePatch(instrumentBinding(t.instrument),player.boundPatches.get(t.id))||slots.get(t.id)!==player.slots.get(t.id)));
  }
  async refresh(){
    this.updateMix();
    if(!this.enabled)return;if(this.preparing){this.pending=true;return;}
    const project=this.w.controller.snapshot();if(this.w.player.playing||this.w.player.starting||this.w.audition?.busy)return;
    let needed;try{needed=this.needsPreparation(project);}catch(error){this.ready=false;this.w.error(error);return;}if(!needed){this.ready=true;return;}
    this.preparing=true;this.ready=false;
    try{
      for(const [id,part] of this.w.player.slots){const track=project.tracks.find(t=>t.id===id);if(!track||!samePatch(instrumentBinding(track.instrument),this.w.player.boundPatches.get(id)))this.router.dropPart(part);}
      await this.w.player.prepareLive(this.w.controller);this.ready=true;this.updateMix();
    }catch(error){this.w.error(error);}finally{this.preparing=false;this.w.refreshControls();if(this.pending){this.pending=false;queueMicrotask(()=>void this.refresh());}}
  }
  inputChanged(){this.updateMix();if(this.preparing)this.pending=true;else if(this.enabled&&!this.ready)void this.refresh();}
  updateMix(){
    if(!this.token)return;
    const project=this.w.snapshot,ids=new Set(),selected=this.track();
    if(this.enabled){
      for(const [id,part] of this.w.player.slots){const track=project.tracks.find(t=>t.id===id);if(!track||!this.allowed(track)){if(this.router.parts.some(set=>set.has(part)))this.router.dropPart(part);continue;}if(this.router.parts.some(set=>set.has(part)))ids.add(id);}
      if(selected?.type==='midi'&&this.allowed(selected))ids.add(selected.id);
    }
    const audioTrack=project.tracks.find(t=>t.id===this.w.recorder?.audioTrackId);
    if(audioTrack&&this.allowed(audioTrack))ids.add(audioTrack.id);
    this.w.player.liveMix(ids);
  }
}
