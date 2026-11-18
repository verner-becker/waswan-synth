// SPDX-License-Identifier: GPL-3.0-only
const listeners=new Set();
export function subscribeDawInput(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
export function observeDawInput(data,timeStamp,meta){if(data?.length!==3)return;const event={data:Array.from(data),timeStamp,...meta};for(const listener of listeners)listener(event);}
