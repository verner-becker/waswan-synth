// SPDX-License-Identifier: GPL-3.0-only
import {decodeCanonical,canonicalPeaks} from './daw-decode.js';
self.onmessage=async({data:m})=>{
  try{if(m.kind==='peaks'){const peaks=await canonicalPeaks(m.source,m.frames);self.postMessage({ok:true,peaks},[peaks.buffer]);}else{const {left,right}=await decodeCanonical(m.source,m.frames);self.postMessage({ok:true,left,right},[left.buffer,right.buffer]);}}
  catch(error){self.postMessage({ok:false,error:error.message});}
};
