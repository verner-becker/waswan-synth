// SPDX-License-Identifier: GPL-3.0-only
import {PPQ,RATE,clipSeconds,clipDuration} from './daw-project.js';
export const clipBeat=(clip,project)=>clipSeconds(clip,project.bpm)*project.bpm/60;
export const clipBeats=(clip,project)=>clipDuration(clip,project.bpm)*project.bpm/60;
export const arrangementBeats=project=>Math.max(project.length/PPQ,...project.clips.map(c=>clipBeat(c,project)+clipBeats(c,project)));
export const frameBeat=(frame,project)=>frame*project.bpm/(RATE*60);
export const beatFrame=(beat,project)=>Math.max(0,Math.round(beat*60*RATE/project.bpm));
export function musicalPosition(beat,project){
  const ticks=Math.max(0,Math.round(beat*PPQ)),meter=project.meter,unit=PPQ*4/meter[1],bar=unit*meter[0];
  return `${Math.floor(ticks/bar)+1}.${Math.floor(ticks%bar/unit)+1}.${String(ticks%unit).padStart(3,'0')}`;
}
export function secondsPosition(seconds){const minutes=Math.floor(seconds/60);return `${minutes}:${(seconds%60).toFixed(2).padStart(5,'0')}`;}
export const snapBeat=(beat,grid,snap)=>Math.max(0,snap?Math.round(beat/grid)*grid:Math.round(beat*PPQ)/PPQ);
export const defaultDawLayout=()=>({version:1,zoom:60,browser:false,browserWidth:220,bottom:true,bottomHeight:260,panel:'clip',ruler:'music',trackHeight:88,folded:[],maximized:null});
export function readDawLayout(storage){
  const result=defaultDawLayout();try{const p=JSON.parse(storage.getItem('waswan-daw-layout-v1'));if(p?.version!==1)return result;
    for(const [key,min,max] of [['zoom',.01,512],['browserWidth',160,480],['bottomHeight',160,800],['trackHeight',56,180]])if(Number.isFinite(p[key]))result[key]=Math.max(min,Math.min(max,p[key]));
    for(const key of ['browser','bottom'])if(typeof p[key]==='boolean')result[key]=p[key];if(['clip','mixer'].includes(p.panel))result.panel=p.panel;if(['music','time'].includes(p.ruler))result.ruler=p.ruler;
    if(Array.isArray(p.folded))result.folded=p.folded.filter(id=>typeof id==='string'&&id.length<=80).slice(0,256);
  }catch{}return result;
}
