// SPDX-License-Identifier: GPL-3.0-only
let listener;
export function listenStudioInput(next){listener=next;}
export function observeStudioInput(data,timeStamp,meta){
  if(listener&&data?.length===3)listener({data:Array.from(data),timeStamp,...meta});
}
