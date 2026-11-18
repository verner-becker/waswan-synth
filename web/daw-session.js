// SPDX-License-Identifier: GPL-3.0-only
// The lock, not a timer or a BroadcastChannel heartbeat, owns the audio host.
export const AUDIO_OWNER_LOCK='waswan-audio-owner-v1';
export class AudioOwner {
  constructor(locks=globalThis.navigator?.locks){this.locks=locks;this.owned=false;this.pending=null;}
  acquire(){
    if(this.owned)return Promise.resolve(true);
    if(this.pending)return this.pending;
    if(!this.locks?.request)return Promise.reject(Error('Chrome Web Locks is required to coordinate the audio session'));
    this.pending=new Promise((resolve,reject)=>{
      this.task=this.locks.request(AUDIO_OWNER_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
        if(!lock){resolve(false);return;}
        this.owned=true;
        await new Promise(release=>{this.releaseLock=release;resolve(true);});
        this.owned=false;this.releaseLock=null;
      }).catch(reject);
    }).finally(()=>{this.pending=null;});
    return this.pending;
  }
  // Call only after the host AudioContext has closed. A suspended host still owns audio.
  async release(){
    if(this.pending)await this.pending;
    this.releaseLock?.();
    await this.task;
  }
}

// Read-only musical status for secondary surfaces. Commands are deliberately not
// accepted here: the project controller will own validation and transactions.
export class SessionObserver {
  constructor(owner,onState=()=>{},channel=new BroadcastChannel('waswan-session-state-v1')){
    this.owner=owner;this.onState=onState;this.channel=channel;this.id=crypto.randomUUID();this.revision=0;
    channel.onmessage=({data:m})=>{
      if(m?.protocol!==1||m.sender===this.id)return;
      if(m.type==='request-state'&&owner.owned&&this.last)this.channel.postMessage(this.last);
      if(m.type==='state'&&typeof m.sender==='string'&&Number.isSafeInteger(m.revision)&&m.state)this.onState(m);
    };
    channel.postMessage({protocol:1,sender:this.id,type:'request-state'});
  }
  publish(frame){
    if(!this.owner.owned||frame.t!=='frame')return;
    const state={ms:frame.ms,master:frame.master,part:frame.track,programs:frame.programs,engines:frame.engines};
    this.last={protocol:1,sender:this.id,type:'state',revision:++this.revision,state};
    this.channel.postMessage(this.last);
  }
  close(){this.channel.close();}
}
