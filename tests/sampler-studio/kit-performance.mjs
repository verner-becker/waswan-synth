// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {Engine} from '../../.local/www/simulator/engine.js';
import {prepareSampler} from '../../web/sampler.js';
import {SamplerRuntime} from '../../web/sampler-runtime.js';
import {toneBytes} from '../../web/fm-patch.js';
import {pcmWav} from './fixtures.mjs';

export async function renderKitDemonstration(root, ref) {
  const engine = new Engine(await readFile('.local/build/waswan-256.wasm'),
    await readFile('upstream/SMKSYNTH/web/simulator/factory-session.bin'));
  engine.advance(4000);
  const x = engine.ex, runtime = new SamplerRuntime(x);
  const rpc = {async request(t, data) {
    if (t === 'daw-sampler-patch') {
      assert(x.waswan_mel_patch());
      return {patch:toneBytes(x,0,true)};
    }
    return runtime.command({...data,t,request:crypto.randomUUID()});
  }};
  const instrument = await prepareSampler({requests:()=>rpc},root,ref);
  assert(x.waswan_daw_apply(1,x.waswan_daw_token()));
  x.waswan_daw_taps(1);
  runtime.applySlots(runtime.prepareSlots([{...instrument,part:0,trackId:'drums'}]));
  const pcm = [];
  // Four beats with alternating strokes and open/closed hat pairs.
  for (const notes of [[36,40],[41],[38,40],[41],[36],[36,40],[38,41],[37]]) {
    for (const note of notes) assert(x.waswan_daw_note(0,note,105));
    let peak = 0;
    for (let i=0; i<76; i++) {
      engine.render(128);
      const left = new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,0),128);
      const right = new Float32Array(x.memory.buffer,x.waswan_daw_owned_output(0,1),128);
      for (let j=0; j<128; j++) {
        peak = Math.max(peak,Math.abs(left[j]),Math.abs(right[j]));
        pcm.push(Math.round(32767*left[j]),Math.round(32767*right[j]));
      }
      if (i===1) for (const note of notes) assert(x.waswan_daw_note(0,note,0));
    }
    assert(peak>.02);
  }
  const output = '.local/validation/sampler-studio-3';
  await mkdir(output,{recursive:true});
  await writeFile(output+'/kit-demo.wav',pcmWav(pcm));
}
