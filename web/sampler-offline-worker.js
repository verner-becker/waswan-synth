// SPDX-License-Identifier: GPL-3.0-only
import {processWav} from './sampler-offline.js';
import {discoverCandidates, proposeInstrument} from './sampler-auto-instrument.js';
onmessage = async ({data:{file,job}}) => {
  try {
    let value;
    if (job.type === 'discover') value = await discoverCandidates(file,job.character,{
      onProgress: progress => postMessage({progress})});
    else if (job.type === 'propose') value = await proposeInstrument(file,job.range,job.options);
    else value = await processWav(file,job);
    postMessage({ok:true,value});
  }
  catch (error) { postMessage({ok:false,error:error.message}); }
};
