// SPDX-License-Identifier: GPL-3.0-only
import {processWav} from './sampler-offline.js';
onmessage = async ({data:{file,job}}) => {
  try { postMessage({ok:true,value:await processWav(file,job)}); }
  catch (error) { postMessage({ok:false,error:error.message}); }
};
