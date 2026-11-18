// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {emptyProject,validateProject} from '../web/daw-project.js';
import {ProjectController} from '../web/daw-controller.js';
import {musicalPosition,beatFrame,frameBeat,readDawLayout,defaultDawLayout} from '../web/daw-arrangement.js';
import {decodeCanonical,canonicalPeaks} from '../web/daw-decode.js';
import {wavHeader} from '../web/studio-format.js';
const p=emptyProject();p.meter=[6,8];assert.equal(musicalPosition(3,p),'2.1.000');assert.equal(musicalPosition(.5,p),'1.2.000');assert(Math.abs(frameBeat(beatFrame(7.5,p),p)-7.5)<1e-4);
const controller=new ProjectController(p);controller.command('project.update',{transport:{loop:true,start:960,end:3840}});assert.equal(controller.snapshot().transport.loop,true);controller.command('undo');assert.deepEqual(controller.snapshot(),p);assert.throws(()=>validateProject({...p,transport:{loop:true,start:960,end:960}}),/interval/);
const old={...p};delete old.transport;validateProject(old);assert(!('transport' in old),'old v3 documents are not silently changed during validation');
assert.deepEqual(readDawLayout({getItem(){throw Error('blocked');}}),defaultDawLayout());assert.equal(readDawLayout({getItem:()=>JSON.stringify({version:1,zoom:999999,panel:'unknown',browserWidth:-2})}).zoom,512);
const source=new Blob([wavHeader(4),new Int16Array([-32768,16384,0,-16384,32767,0,8192,-8192])]),decoded=await decodeCanonical(source,4);assert.deepEqual([...decoded.left],[-1,0,32767/32768,.25]);assert.deepEqual([...decoded.right],[.5,-.5,0,-.25]);assert.deepEqual([...await canonicalPeaks(source,4,2)],[-1,.5,-.25,32767/32768]);
await assert.rejects(()=>decodeCanonical(new Blob([new Uint8Array(source.size)]),4),/canonical/);
console.log('PASS Arrangement: compound meter, ruler conversion, portable transport range/Undo, legacy v3 untouched, bounded local layout, canonical PCM and peaks');
