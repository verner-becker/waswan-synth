// SPDX-License-Identifier: GPL-3.0-only
import {processWav} from './sampler-offline.js';
onmessage = async ({data:{file,job}}) => {
  try {
    let value;
    if (job.type === 'discover' || job.type === 'propose') {
      const {discoverCandidates,proposeInstrument} = await import('./sampler-auto-instrument.js');
      value = job.type === 'discover'
        ? await discoverCandidates(file,job.character,{onProgress:progress=>postMessage({progress})})
        : await proposeInstrument(file,job.range,job.options);
    } else value = await processWav(file,job);
    postMessage({ok:true,value});
  }
  catch (error) { postMessage({ok:false,error:error.message}); }
};
