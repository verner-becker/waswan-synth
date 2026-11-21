// SPDX-License-Identifier: GPL-3.0-only

const defaultBinary=new URL('./sampler-pitch.wasm',import.meta.url);
let modulePromise;

async function load(url) {
  const response=await fetch(url);
  if(!response.ok)throw Error('Build the offline pitch module to use Signalsmith Stretch.');
  return WebAssembly.compile(await response.arrayBuffer());
}

export async function shiftSignalsmith(audio,{semitones,fundamentalHz,formants},{wasm}={}) {
  const refuse=()=>{throw Error('Signalsmith Stretch stopped while processing the excerpt.');};
  const module=wasm?await WebAssembly.compile(wasm):await (modulePromise??=load(defaultBinary).catch(error=>{
    modulePromise=null;throw error;
  }));
  const engine=(await WebAssembly.instantiate(module,{wasi_snapshot_preview1:{
    fd_write:refuse,fd_seek:refuse,fd_close:refuse,
  }})).exports;
  engine._initialize();
  const {pcm,sampleRate}=audio;
  const input=engine.malloc(pcm.byteLength),output=engine.malloc(pcm.byteLength);
  try{
    if(!input||!output)throw Error('Signalsmith Stretch exceeds the offline memory budget.');
    new Float32Array(engine.memory.buffer,input,pcm.length).set(pcm);
    const start=performance.now();
    const status=engine.shift_mono(input,output,pcm.length,sampleRate,semitones,fundamentalHz,Number(formants));
    if(status)throw Error('Signalsmith Stretch could not process the given format or parameters.');
    const renderMs=performance.now()-start,memoryBytes=engine.memory.buffer.byteLength;
    return {audio:{...audio,pcm:new Float32Array(engine.memory.buffer,output,pcm.length).slice()},renderMs,memoryBytes};
  }finally{
    if(input)engine.free(input);
    if(output)engine.free(output);
  }
}
