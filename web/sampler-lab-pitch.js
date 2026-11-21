// SPDX-License-Identifier: GPL-3.0-only
import {detectPitch} from './sampler-analysis.js';
import {shiftSignalsmith} from './sampler-signalsmith.js';
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

const signalsmith=Object.freeze({id:'signalsmith-stretch',version:1,name:'Signalsmith Stretch · experimental',
  parameters:Object.freeze({semitones:[-3,3],formants:true}),
  validate({semitones,fundamentalHz,formants}) {
    if(!Number.isFinite(semitones)||Math.abs(semitones)>3)throw Error('The Signalsmith trial supports a total shift within ±3 semitones.');
    if(!Number.isFinite(fundamentalHz)||fundamentalHz<45||fundamentalHz>1800||typeof formants!=='boolean')
      throw Error('Signalsmith needs a stable fundamental between 45 and 1800 Hz.');
  },
  async render(source,parameters,options) {
    if(source.channels!==1||source.pcm.length<source.sampleRate*.25||source.pcm.length>source.sampleRate*labMaxSeconds)
      throw Error('Choose a sustained mono selection from 250 ms to 16 seconds for Signalsmith.');
    const measured=detectPitch(source);
    if(!measured.hz||measured.confidence<.85)
      throw Error('No stable source pitch for the Signalsmith trial. Try WSOLA or a sustained vowel.');
    const settings={...parameters,fundamentalHz:parameters.fundamentalHz??Math.round(measured.hz*1000)/1000};
    this.validate(settings);
    const {audio,renderMs,memoryBytes}=settings.semitones===0?{audio:source}:await shiftSignalsmith(source,settings,options);
    const pitch=detectPitch(audio);
    const expected=measured.hz*2**(settings.semitones/12);
    const driftCents=pitch.hz?1200*Math.log2(pitch.hz/expected):null;
    return {audio,report:{...report(audio),pitch,driftCents,renderMs,memoryBytes},
      parameters:settings};
  },
});

export const pitchAdapters=Object.freeze({[native.id]:native,[wsola.id]:wsola,[signalsmith.id]:signalsmith});

export function pitchRecipe(adapter,parameters) {
  adapter.validate(parameters);
  return {type:'pitchShift',...parameters,algorithm:adapter.id,algorithmVersion:adapter.version};
}
