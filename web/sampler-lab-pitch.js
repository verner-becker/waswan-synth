// SPDX-License-Identifier: GPL-3.0-only
import {pitchShift} from './sampler-transform.js';
import {labLevels,labMaxSeconds} from './sampler-lab-analysis.js';

const report=audio=>({frames:audio.pcm.length/audio.channels,levels:labLevels(audio),
  overRange:audio.pcm.reduce((sum,value)=>sum+Number(Math.abs(value)>1),0)});
const native=Object.freeze({id:'native-hermite',version:1,name:'Native Resampling',
  parameters:Object.freeze({}),validate(){},render:audio=>({audio,report:report(audio)})});
const wsola=Object.freeze({id:'wsola',version:1,name:'WSOLA + Pitch Shift',
  parameters:Object.freeze({semitones:[-12,12]}),
  validate({semitones}) {
    if(!Number.isFinite(semitones)||semitones<-12||semitones>12)
      throw Error('WSOLA supports a total shift from −12 to +12 semitones.');
  },
  render(source,parameters) {
    this.validate(parameters);
    const frames=source.pcm.length/source.channels;
    if(frames<source.sampleRate*.08||frames>source.sampleRate*labMaxSeconds)
      throw Error('Choose an excerpt between 80 ms and 16 seconds for WSOLA.');
    const audio=pitchShift(source,parameters.semitones);
    return {audio,report:report(audio)};
  },
});

export const pitchAdapters=Object.freeze({[native.id]:native,[wsola.id]:wsola});

export function pitchRecipe(adapter,parameters) {
  adapter.validate(parameters);
  return {type:'pitchShift',semitones:parameters.semitones,algorithm:adapter.id,algorithmVersion:adapter.version};
}
