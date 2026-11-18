// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {DawAssetRetention} from '../web/daw-asset-retention.js';
import {DawRecorder} from '../web/daw-recording.js';

const old=new Blob(['old']),current=new Blob(['current']),recent=new Blob(['recent']);
const w={controller:{assets:new Map()},snapshot:{id:'project'},player:{starting:false}};
const cache=new DawAssetRetention(w);
let unblock,disposedCurrent=0,disposedRecent=0;
cache.hold(new Map([['old',old]]),()=>new Promise(resolve=>{unblock=resolve;}));
cache.hold(new Map([['current',current]]),async()=>{disposedCurrent++;});
const cleaning=cache.collect();
w.controller.assets.set('current',current);w.controller.assets.set('recent',recent);
cache.hold(new Map([['recent',recent]]),async()=>{disposedRecent++;});
unblock();await cleaning;
assert.equal(disposedCurrent,0,'Refresh references before removing the next store');
assert.equal(disposedRecent,0,'Newly added stores were not candidates for the previous collection');
w.controller.assets.clear();
await cache.collect();
assert.equal(disposedCurrent,1);assert.equal(disposedRecent,1);
clearTimeout(cache.timer);

let finish,stoppedNew=false;
const other={context:{currentTime:.01},node:{}},original={context:{currentTime:19.8},node:{}};
const r=new DawRecorder({bridge:{getAudio:()=>other},status:{},refreshControls(){},error(){},
  player:{stop:async()=>{stoppedNew=true;return {frame:441};}}});
r.busy=true;r.state='recording';r.track={name:'Piano',type:'midi'};
r.takeContext=original.context;r.takeNode=original.node;
r.meta={startFrame:441000,lastFrame:800000,limit:441000};r.lastClockFrame=870000;
r.worker={postMessage:m=>{if(m.t==='finish')finish=m;}};
r.finished=Promise.resolve({status:'incomplete'});r.store={release:async()=>{}};r.cleanup=async()=>{};
await r.stop('instrument-reboot');
assert.equal(stoppedNew,false);
assert.equal(finish.endFrame,873180,'Reboot keeps the prior context clock for the recovery journal');
console.log('PASS DAW retention: concurrent imports remain live and interrupted recordings keep their original clock');
