// SPDX-License-Identifier: GPL-3.0-only
import {validToneBytes} from './fm-patch.js';

export const TONE_FILE_EXTENSION='.wstone';

function toneFile(name,patch){
  const cleanName=typeof name==='string'?name.trim():'';
  if(!cleanName||cleanName.length>80||/[\u0000-\u001f\u007f]/.test(cleanName)||!validToneBytes(patch))
    throw Error('Invalid WASWAN tone file');
  return {format:'waswan-tone',version:1,name:cleanName,patch};
}

export async function readToneFile(file){
  if(file.size>4096)throw Error('Tone file exceeds 4 KiB');
  const data=JSON.parse(await file.text());
  if(data?.format!=='waswan-tone'||data.version!==1)throw Error('Unsupported WASWAN tone file');
  return toneFile(data.name,data.patch);
}

export async function readToneFolder(directory){
  const tones=[];
  let skipped=0;
  for await(const handle of directory.values()){
    if(handle.kind!=='file'||!handle.name.toLowerCase().endsWith(TONE_FILE_EXTENSION))continue;
    try{
      const file=await handle.getFile();
      tones.push({fileName:handle.name,modified:file.lastModified,...await readToneFile(file)});
    }catch{skipped++;}
  }
  tones.sort((a,b)=>a.name.localeCompare(b.name)||a.modified-b.modified||a.fileName.localeCompare(b.fileName));
  return {tones,skipped};
}

export async function saveToneFile(directory,name,patch){
  const tone=toneFile(name,patch);
  const slug=tone.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/gi,'-').slice(0,48);
  const fileName=`${slug||'tone'}-${crypto.randomUUID()}${TONE_FILE_EXTENSION}`;
  const handle=await directory.getFileHandle(fileName,{create:true});
  try{
    const writer=await handle.createWritable();
    try{
      await writer.write(JSON.stringify(tone,null,2)+'\n');
      await writer.close();
    }catch(error){
      await writer.abort().catch(()=>{});
      throw error;
    }
  }catch(error){
    await directory.removeEntry(fileName).catch(()=>{});
    throw error;
  }
  return fileName;
}
