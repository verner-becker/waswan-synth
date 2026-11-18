// SPDX-License-Identifier: GPL-3.0-only
const p=(name,min,max,value,step=.01)=>({name,min,max,value,step});
export const FX={
 eq:{name:'EQ',params:{low:p('Low gain dB',-12,12,0,.1),lowHz:p('Low shelf Hz',20,2000,120,1),mid:p('Mid gain dB',-12,12,0,.1),midHz:p('Mid Hz',40,16000,1000,1),q:p('Mid Q',.1,12,1,.1),high:p('High gain dB',-12,12,0,.1),highHz:p('High shelf Hz',1000,20000,6000,1)}},
 compressor:{name:'Compressor',params:{threshold:p('Threshold dB',-60,0,-24,.1),ratio:p('Ratio',1,20,4,.1),attack:p('Attack ms',.1,200,5,.1),release:p('Release ms',10,2000,250,1),knee:p('Knee dB',0,30,6,.1)}},
 reverb:{name:'Reverb',params:{mix:p('Wet mix',0,1,.2),decay:p('Decay seconds',.1,4,1.5,.1)}},
 delay:{name:'Delay',params:{mix:p('Wet mix',0,1,.25),time:p('Delay seconds',.001,2,.25,.001),feedback:p('Feedback',0,.9,.3)}},
 chorus:{name:'Chorus',params:{mix:p('Wet mix',0,1,.3),rate:p('Rate Hz',.05,8,.8,.05),depth:p('Depth ms',0,10,3,.1)}},
 limiter:{name:'Sample peak limiter',params:{ceiling:p('Ceiling dBFS',-12,0,-1,.1),release:p('Release ms',10,2000,80,1)}},
 saturation:{name:'Saturation',params:{drive:p('Drive',1,20,2,.1),mix:p('Wet mix',0,1,.5)}}
};
export function effect(type){if(!Object.hasOwn(FX,type))throw Error('Unknown effect');return {id:crypto.randomUUID(),type,bypass:false,parameters:Object.fromEntries(Object.entries(FX[type].params).map(([key,p])=>[key,p.value]))};}
export function resolveEffect(e){const spec=Object.hasOwn(FX,e.type)?FX[e.type]:null;if(!spec)throw Error('Unsupported effect: '+e.type);for(const key of Object.keys(e.parameters))if(!Object.hasOwn(spec.params,key))throw Error('Unsupported '+spec.name+' parameter: '+key+'; project data preserved');const params={};for(const [key,p] of Object.entries(spec.params)){const value=e.parameters[key]??p.value;if(!Number.isFinite(value)||value<p.min||value>p.max)throw Error(spec.name+' '+p.name+' is outside its supported range');params[key]=value;}return {...e,parameters:params};}
export function validateEffects(project){if(project.master.fx.length+project.tracks.reduce((n,t)=>n+t.fx.length,0)>64)throw Error('FX processing budget: 64 effects in total');for(const e of [...project.master.fx,...project.tracks.flatMap(t=>t.fx)])resolveEffect(e);}
