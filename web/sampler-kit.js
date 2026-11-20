// SPDX-License-Identifier: GPL-3.0-only
import {createInstrument} from './sampler-instrument.js';
import {splitFrames} from './sampler-edit.js';

// Pad controls live on its group. Each recording becomes an ordinary sampler
// region, so the sequencer and the hardware use exactly the same instrument.
export function createKit({name, id, pads, samples, layers=[], variations=[], ...instrument}) {
  if (!Array.isArray(pads) || pads.length<1 || pads.length>16) throw Error('Choose 1 to 16 kit pads');
  const groups=[], mapping=[], regions=[];
  for (const pad of pads) {
    const {index,note,recordings,label,mode='oneShot',...controls}=pad;
    if (!Array.isArray(recordings)||!recordings.length) throw Error('Choose recordings for pad '+index);
    const group='pad-'+index;
    groups.push({...controls,id:group,output:'main'});
    mapping.push({id:group,index,note,groups:[group],name:label??group});
    recordings.forEach((recording,slot)=>{
      regions.push({...recording,id:recording.id??group+'-'+(slot+1),group,key:[note,note],
        root:recording.root??note,mode:recording.mode??mode});
    });
  }
  return createInstrument({...instrument,...(id?{id}:{}),name,kind:'kit',samples,layers,variations,groups,pads:mapping,regions});
}

export function kitFromSlices(sample, markers, {name=sample.id,firstNote=36}={}) {
  const slices=splitFrames(sample.frames,markers);
  if (slices.length>16 || !Number.isInteger(firstNote) || firstNote<0 || firstNote+slices.length>128)
    throw Error('Choose at most 16 slices within the MIDI note range');
  const pads=slices.map((frames,i)=>({index:i+1,note:firstNote+i,recordings:[{sample:sample.id,frames}]}));
  return createKit({name,samples:[sample],pads});
}
