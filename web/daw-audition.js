// SPDX-License-Identifier: GPL-3.0-only
// Owner3 preview is serialized and stopped-only; physical MIDI keeps its owners.
export class DawAudition {
  constructor(workspace){this.w=workspace;this.busy=false;this.chain=Promise.resolve();this.pending=0;addEventListener('blur',()=>void this.release());}
  state(){this.busy=!!(this.desired||this.current||this.pending);this.w.refreshControls();if(!this.busy)void this.w.monitor?.refresh();}
  enqueue(task){this.pending++;this.state();this.chain=this.chain.catch(()=>{}).then(task).finally(()=>{this.pending--;this.state();});return this.chain;}
  async close(){const current=this.current;if(!current)return;try{await this.w.player.requests().request('daw-preview-close',{token:current.token});}finally{if(this.current===current)this.current=null;}}
  press(note){const w=this.w,track=w.selectedTrack();if(w.player.playing||w.player.starting||w.recorder.busy||w.importer.busy||w.bridge.isStudioBusy?.())return Promise.reject(Error('Stop DAW/Studio playback and recording before piano audition'));if(track?.type!=='midi'||!track.instrument)return Promise.reject(Error('Choose a track instrument before audition'));const token=crypto.randomUUID();this.desired={token,note,trackId:track.id};this.state();
    return this.enqueue(async()=>{try{await this.close();if(this.desired?.token!==token)return;await w.player.prepareLive(w.controller);if(this.desired?.token!==token)return;const part=w.player.slots.get(track.id);await w.player.requests().request('daw-preview-open',{projectId:w.snapshot.id,token,part});this.current={token,part};if(this.desired?.token!==token){await this.close();return;}await w.player.tracks.get(track.id).gateRpc.request('preview-session',{token});if(this.desired?.token!==token){await this.close();return;}await w.player.requests().request('daw-preview-note',{token,note,velocity:96});}catch(error){if(this.current?.token===token)await this.close().catch(()=>{});if(this.desired?.token===token){this.desired=null;w.error(error);}}finally{this.state();}});
  }
  release(){if(!this.busy)return this.chain;this.desired=null;this.state();return this.enqueue(async()=>{try{await this.close();}catch(error){this.w.error(error);}finally{this.state();}});}
}
