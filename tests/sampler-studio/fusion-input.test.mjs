// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {createFusionInput} from '../../web/sampler-fusion-input.js';

const commands = [], errors = [];
const make = name => ({
  note: async ({owner,channel,note,velocity}) => { commands.push([name,'note',owner,channel,note,velocity]); },
  pedal: async ({owner,channel,down}) => { commands.push([name,'pedal',owner,channel,down]); },
  releaseOwner: async (owner,channel) => { commands.push([name,'release',owner,channel]); },
});
const input = createFusionInput({onError:error=>errors.push(error.message)});
const source = 'keyboard A', first = make('first'), next = make('next');
const midi = (st,d1,d2) => input.routeMidi([st,d1,d2],source);
assert.equal(midi(0x95,48,115),false);
input.bind(first);
assert(midi(0x95,48,115)); assert(midi(0xb5,64,127));
assert(input.virtual('screen',0,true,90)); assert(input.virtual('computer',0,true,69));
assert(midi(0x95,48,0));
assert(input.virtual('screen',0,false,90));
assert.deepEqual(commands.slice(0,6),[
  ['first','note','midi:'+source,5,48,115],['first','pedal','midi:'+source,5,true],
  ['first','note','screen',0,48,90],['first','note','computer',0,48,69],
  ['first','note','midi:'+source,5,48,0],['first','note','screen',0,48,0],
]);
assert.equal(midi(0xb5,71,56),false);
assert.equal(input.routeMidi([0x90,162,12],source),false);
assert.equal(input.routeMidi([0x90,60],source),false);
assert(midi(0x95,49,100)); assert(input.midiDown(49));
input.releaseBrowser();
assert(input.midiDown(49));
assert(!commands.slice(7).some(c => c[1]==='release' && c[2]==='midi:'+source));
input.unbind(first);
input.bind(next);
assert.equal(input.midiDown(49),false);
let emitted = commands.length;
assert(midi(0x85,49,77)); assert(midi(0xb5,64,0)); assert(input.virtual('computer',0,false,100));
assert.equal(commands.length,emitted,'late releases cannot reach a replacement lease');
assert(midi(0x92,60,110)); assert(midi(0x91,60,50)); assert(midi(0xb2,123,0));
assert(input.midiDown(60),'other channel is still held');
assert.deepEqual(commands.at(-1),['next','release','midi:'+source,2]);
assert(input.releaseMidi());
assert.deepEqual(commands.at(-1),['next','release','midi:'+source,undefined]);
assert.equal(input.midiDown(60),false);
assert(midi(0x91,61,120)); input.unbind(next);
assert.equal(midi(0x91,61,120),false);
assert.equal(midi(0x81,61,0),false,'a newer native attack keeps its own release');
input.unbind(first);
assert.equal(input.releaseMidi(),false);
let reject;
const late = {...make('late'),note:() => new Promise((_,fail)=>{reject=fail;})};
input.bind(late);
assert(midi(0x91,61,110));
input.unbind(late);
input.bind(next);
reject(Error('obsolete')); await Promise.resolve();
assert.deepEqual(errors,[]);
console.log('PASS isolated hardware/screen/computer ownership, sustain, channel-scoped release, hot unplug, stale releases after lease replacement, new native attack, stale errors');
