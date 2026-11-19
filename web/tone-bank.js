// SPDX-License-Identifier: GPL-3.0-only
import {validToneBytes} from './fm-patch.js';

export const TONE_FILE_EXTENSION='.wstone';

export function toneFile(name,patch){
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

export async function saveToneFile(directory,name,patch,slot){
  const tone=toneFile(name,patch);
  const slug=tone.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/gi,'-').slice(0,48);
  const prefix=slot===undefined?'':String(slot).padStart(2,'0')+'-';
  const fileName=`${prefix}${slug||'tone'}-${crypto.randomUUID()}${TONE_FILE_EXTENSION}`;
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
    try{await directory.removeEntry(fileName);}
    catch(cleanup){
      if(cleanup.name!=='NotFoundError')throw Error(`Write failed. Check “${fileName}” in “${directory.name}” before retrying. ${error.message}`);
    }
    throw error;
  }
  return fileName;
}

// Keep the structured-cloneable directory handle and bank names together.
// The cached names can be shown before Chrome grants access to the folder again.
export async function libraryBanks(root){
  const banks=[];
  let rootTones=false;
  for await(const entry of root.values()){
    if(entry.kind==='directory')banks.push({key:'folder:'+entry.name,name:entry.name});
    else if(entry.name.toLowerCase().endsWith(TONE_FILE_EXTENSION))rootTones=true;
  }
  banks.sort((a,b)=>a.name.localeCompare(b.name));
  if(rootTones||!banks.length)banks.unshift({key:'root',name:root.name});
  return banks;
}

export async function librarySetting(value,key='library'){
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('waswan-tone-library',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('settings');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('settings',value?'readwrite':'readonly');
      const store=tx.objectStore('settings');
      const request=value?store.put(value,key):store.get(key);
      tx.oncomplete=()=>resolve(request.result);
      tx.onabort=()=>reject(tx.error||Error('Library storage unavailable.'));
    });
  }finally{db.close();}
}
