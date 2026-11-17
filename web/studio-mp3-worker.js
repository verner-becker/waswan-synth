// SPDX-License-Identifier: GPL-3.0-only
// Separate, unmodified LGPL encoder. All input/output stays in the local browser.
importScripts('./vendor/lamejs/lame.all.js');
let busy=false;
onmessage=({data:m})=>{
  if(m.t!=='encode'||busy)return;busy=true;
  void(async()=>{
    const file=m.audio,frames=m.frames;
    if(!Number.isSafeInteger(frames)||frames<1||frames>52920000||!file||file.size!==44+frames*4)throw Error('Invalid MP3 source');
    const header=new DataView(await file.slice(0,44).arrayBuffer());
    if(header.getUint32(0)!==0x52494646||header.getUint32(8)!==0x57415645||header.getUint16(20,true)!==1||header.getUint16(22,true)!==2||header.getUint32(24,true)!==44100||header.getUint16(34,true)!==16||header.getUint32(40,true)!==frames*4)throw Error('MP3 source must be canonical stereo PCM16 WAV');
    const encoder=new lamejs.Mp3Encoder(2,44100,192),left=new Int16Array(1152),right=new Int16Array(1152),output=[];
    const batchFrames=1152*128;
    for(let at=0;at<frames;at+=batchFrames){
      const count=Math.min(batchFrames,frames-at),data=new DataView(await file.slice(44+at*4,44+(at+count)*4).arrayBuffer()),chunks=[];
      for(let start=0;start<count;start+=1152){
        const n=Math.min(1152,count-start);
        for(let i=0;i<n;i++){left[i]=data.getInt16((start+i)*4,true);right[i]=data.getInt16((start+i)*4+2,true);}
        const bytes=encoder.encodeBuffer(left.subarray(0,n),right.subarray(0,n));if(bytes.length)chunks.push(bytes);
      }
      output.push(new Blob(chunks));postMessage({t:'progress',frames:at+count,total:frames});
    }
    const last=encoder.flush();if(last.length)output.push(new Blob([last]));
    const audio=new Blob(output,{type:'audio/mpeg'});if(audio.size<32)throw Error('MP3 encoder produced no audio');
    postMessage({t:'finished',audio});
  })().catch(error=>postMessage({t:'error',message:error.message}));
};
