// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';import fs from 'node:fs';
import {Engine} from '../.local/www/simulator/engine.js';
const wasm=fs.readFileSync('.local/build/waswan-256.wasm'),seed=fs.readFileSync('upstream/SMKSYNTH/web/simulator/factory-session.bin');
function fixture(){const e=new Engine(wasm,seed.buffer.slice(seed.byteOffset,seed.byteOffset+seed.byteLength));e.advance(5000);return e;}
const e=fixture(),x=e.ex,ctx=()=>x.waswan_knob_context()>>>0,val=k=>x.waswan_knob_value(k);
const abs=(k,value,revision=1,context=ctx())=>e.input({t:'enc-fine-absolute',e:k,value,revision,context});
assert.equal(val(1),20);assert.equal(x.waswan_knob_bound(1,0),0);assert.equal(x.waswan_knob_bound(1,1),127);
// Physical repro: initial MIDI53 / RESO20 must not create the legacy -33 offset.
for(const v of [53,54,100,127,127]){abs(1,v);assert.equal(val(1),20);}
assert.equal(e.fineAbsolute[1].picked,false);abs(1,20);assert.equal(e.fineAbsolute[1].picked,true);
for(let v=21;v<=127;v++){abs(1,v);assert.equal(val(1),v);}for(let v=126;v>=0;v--){abs(1,v);assert.equal(val(1),v);}
for(let pass=0;pass<10;pass++){abs(1,127);assert.equal(val(1),127);abs(1,0);assert.equal(val(1),0);}
// Rearm on profile release/reconnect/mode change, retaining the patch value until pickup.
abs(1,80);abs(1,20,2);assert.equal(val(1),80);abs(1,50,2);assert.equal(val(1),80);abs(1,90,2);assert.equal(val(1),90,'crossing target catches even when a CC value was skipped');
// External editor/CC changes rearm takeover rather than snapping back.
e.input({t:'midi',st:0xb0,d1:71,d2:40});e.advance(30);abs(1,91,2);assert.equal(val(1),40);abs(1,40,2);abs(1,41,2);assert.equal(val(1),41);
// Cutoff keeps original internal scale and exact unit resolution after takeover.
e.input({t:'midi',st:0xb0,d1:74,d2:40});e.advance(30);abs(0,90);assert.equal(val(0),40);abs(0,40);for(const v of [41,43,40,127,0]){abs(0,v);assert.equal(val(0),v);}
const old=ctx();e.input({t:'enc',e:6,steps:1});abs(0,127);e.advance(100);assert.notEqual(ctx(),old);const current=val(0);abs(0,0,1,old);assert.equal(val(0),current);
// Small-range parameters spread the same original values across full physical travel.
e.input({t:'btn',b:13,down:true});e.advance(80);e.input({t:'btn',b:13,down:false});e.advance(150);
assert.equal(x.waswan_knob_bound(0,1),4);const wave=val(0);abs(0,Math.round(127*wave/4),3);abs(0,127,3);assert.equal(val(0),4);abs(0,0,3);assert.equal(val(0),0);
const report={result:'PASS',physicalCase:{startCC:53,startResonance:20,pickupCC:20},fullRange:[0,127],roundTrips:10,cutoffUnitSteps:true,skippedValueCrossing:true,revisionRearms:true,externalEditRearms:true,staleContextRejected:true,smallParameterRange:[0,4]};
fs.writeFileSync('.local/validation/knob-pickup-native.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
