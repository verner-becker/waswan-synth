// SPDX-License-Identifier: GPL-3.0-only
import {RATE} from './daw-project.js';
import {timelineFrame} from './daw-transport.js';
const integer=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
export class PcmRenderer {
  constructor(){this.assets=new Map();this.clips=[];this.positions=new Int32Array(128);}
  asset(id,left,right){
    if(typeof id!=='string'||!/^[\w-]{1,80}$/.test(id)||!(left instanceof Float32Array)||!(right instanceof Float32Array)||left.length!==right.length||!integer(left.length,1,RATE*1200))throw Error('Invalid decoded source');
    let frames=left.length;for(const [key,a] of this.assets)if(key!==id)frames+=a.left.length;
    if(frames>RATE*1800||!this.assets.has(id)&&this.assets.size>=32)throw Error('Decoded audio budget exceeded');
    this.assets.set(id,{left,right});
  }
  prepare(planId,clips){
    if(typeof planId!=='string'||!/^[\w-]{1,80}$/.test(planId)||!Array.isArray(clips)||clips.length>512)throw Error('Invalid audio plan');
    for(const c of clips){const a=this.assets.get(c.assetId),duration=c.end-c.start;
      if(!a||!integer(c.output,0,31)||!integer(c.start,0,RATE*1200)||!integer(c.end,c.start+1,RATE*1200)||!integer(c.offset,0,a.left.length-duration)||!Number.isFinite(c.gain)||c.gain<0||c.gain>4||!Number.isFinite(c.pan)||Math.abs(c.pan)>1||!integer(c.fadeIn,0,c.envelope?.frames??duration)||!integer(c.fadeOut,0,c.envelope?.frames??duration)||c.envelope!=null&&(!integer(c.envelope.offset,-RATE*1200,RATE*1200)||!integer(c.envelope.frames,1,RATE*1200)))throw Error('Invalid audio clip plan');
    }
    this.clips=clips;this.planId=planId;
  }
  retain(ids){if(!Array.isArray(ids)||ids.length>32||!ids.every(id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id)))throw Error('Invalid source set');const keep=new Set(ids);for(const id of this.assets.keys())if(!keep.has(id))this.assets.delete(id);}
  clear(){this.assets.clear();this.clips=[];this.planId=null;}
  render(outputs,clock,frame){
    // Outputs are fresh zeros supplied by AudioWorklet. No per-quantum allocation.
    if(!clock.playing||clock.planId!==this.planId)return;
    const n=outputs[0]?.[0]?.length||128;if(n>128)return;
    let min=Infinity,max=-1;for(let i=0;i<n;i++){const p=timelineFrame(clock,frame+i);this.positions[i]=p;if(p>=0){min=Math.min(min,p);max=Math.max(max,p);}}
    for(const c of this.clips){
      if(c.start>max||c.end<=min)continue;const out=outputs[c.output];if(!out?.[1])continue;
      const asset=this.assets.get(c.assetId),left=c.pan>0?1-c.pan:1,right=c.pan<0?1+c.pan:1;
      for(let i=0;i<n;i++){
        const at=this.positions[i];if(at<c.start||at>=c.end)continue;const relative=at-c.start,index=c.offset+relative;
        const envelopeAt=(c.envelope?.offset||0)+relative,envelopeFrames=c.envelope?.frames||c.end-c.start,fade=(c.fadeIn?Math.max(0,Math.min(1,envelopeAt/c.fadeIn)):1)*(c.fadeOut?Math.max(0,Math.min(1,(envelopeFrames-envelopeAt)/c.fadeOut)):1),gain=c.gain*fade;
        out[0][i]+=asset.left[index]*gain*left;out[1][i]+=asset.right[index]*gain*right;
      }
    }
  }
}
// Same equal-power stereo panning law as StereoPannerNode; volume is applied once.
export function stereoSample(left,right,volume,pan){
  if(pan<=0){const x=(pan+1)*Math.PI/2;return [(left+right*Math.cos(x))*volume,right*Math.sin(x)*volume];}
  const x=pan*Math.PI/2;return [left*Math.cos(x)*volume,(right+left*Math.sin(x))*volume];
}
export function automationAt(lane,tick,fallback){
  if(!lane?.enabled||!lane.points.length)return fallback;const points=lane.points;
  if(tick<=points[0].tick)return points[0].value;if(tick>=points.at(-1).tick)return points.at(-1).value;
  let low=0,high=points.length-1;while(high-low>1){const mid=(low+high)>>1;if(points[mid].tick<=tick)low=mid;else high=mid;}
  const a=points[low],b=points[high];return lane.curve==='step'?a.value:a.value+(b.value-a.value)*(tick-a.tick)/(b.tick-a.tick);
}
