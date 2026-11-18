// SPDX-License-Identifier: GPL-3.0-only
class DawBus extends AudioWorkletProcessor {
 static get parameterDescriptors(){return [{name:'gain',defaultValue:1,minValue:0,maxValue:2,automationRate:'k-rate'}];}
 constructor(){super();this.gain=0;this.alive=true;this.port.onmessage=({data:m})=>{if(m.t==='dispose')this.alive=false;};}
 process(inputs,outputs,parameters){
  if(!this.alive)return false;
  const target=parameters.gain[0],out=outputs[0],input=inputs[0],n=out[0].length,from=this.gain;
  for(let c=0;c<out.length;c++)for(let i=0;i<n;i++)out[c][i]=(input?.[c]?.[i]??0)*(from+(target-from)*(i+1)/n);
  this.gain=target;return true;
 }
}
registerProcessor('waswan-daw-bus',DawBus);
