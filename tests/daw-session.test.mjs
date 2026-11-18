// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {AudioOwner,SessionObserver} from '../web/daw-session.js';
let held=false;
const locks={async request(name,options,callback){
  assert.equal(options.ifAvailable,true);
  if(held)return callback(null);
  held=true;try{return await callback({name});}finally{held=false;}
}};
const owners=Array.from({length:32},()=>new AudioOwner(locks));
const results=await Promise.all(owners.map(o=>o.acquire()));
assert.equal(results.filter(Boolean).length,1);
assert(owners[0].owned);
assert.equal(await owners[0].acquire(),true);
assert.equal(await owners[1].acquire(),false,'no timed takeover of an existing host');
await owners[0].release();
assert.equal(await owners[1].acquire(),true);
await owners[1].release();
const a=new AudioOwner(locks);
assert.deepEqual(await Promise.all([a.acquire(),a.acquire()]),[true,true]);
await a.release();
await assert.rejects(new AudioOwner({}).acquire(),/Web Locks/);
await assert.rejects(new AudioOwner({request:async()=>{throw Error('denied');}}).acquire(),/denied/);
class Channel {
  static peers=new Set();
  constructor(){Channel.peers.add(this);}
  postMessage(m){for(const p of Channel.peers)if(p!==this)queueMicrotask(()=>p.onmessage?.({data:structuredClone(m)}));}
  close(){Channel.peers.delete(this);}
}
const states=[],host=new SessionObserver({owned:true},()=>{},new Channel()),view=new SessionObserver({owned:false},s=>states.push(s),new Channel());
host.publish({t:'frame',ms:1000,master:724,track:0,programs:[1,2,3,4],engines:[0,0,0,0],fb:new Uint8Array(100)});
await new Promise(resolve=>setTimeout(resolve,0));
assert(states.length>0);assert.equal(states.at(-1).state.ms,1000);assert(!('fb' in states.at(-1).state));
const before=states.length;view.publish({t:'frame',ms:0});
await new Promise(resolve=>setTimeout(resolve,0));assert.equal(states.length,before,'a view cannot publish host state');
host.close();view.close();
console.log('PASS audio ownership: exclusive races, reentry, explicit release, no heartbeat takeover, API failure');
