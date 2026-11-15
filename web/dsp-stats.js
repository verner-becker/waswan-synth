// SPDX-License-Identifier: GPL-3.0-only
export const BIN_MS=0.025, BINS=1024, MAX_WINDOWS=3600;
export function accumulator(){return {blocks:0,measured:0,sumMs:0,maxMs:0,overBudget:0,budgetSumMs:0,frames:0,minFrames:Infinity,maxFrames:0,peakVoices:0,overflow:0,invalid:0,hist:new Uint32Array(BINS)};}
export function block(a,ms,frames,rate){
 a.blocks++;a.frames=frames;a.minFrames=Math.min(a.minFrames,frames);a.maxFrames=Math.max(a.maxFrames,frames);a.budgetSumMs+=1000*frames/rate;
 if(ms===null)return;
 if(!Number.isFinite(ms)||ms<0){a.invalid++;return;}
 a.measured++;a.sumMs+=ms;a.maxMs=Math.max(a.maxMs,ms);if(ms>1000*frames/rate)a.overBudget++;
 const bin=Math.floor(ms/BIN_MS);if(bin>=BINS)a.overflow++;a.hist[Math.min(BINS-1,bin)]++;
}
export function merge(a,b){
 for(const k of ['blocks','measured','sumMs','overBudget','budgetSumMs','overflow','invalid'])a[k]+=b[k];
 a.maxMs=Math.max(a.maxMs,b.maxMs);a.peakVoices=Math.max(a.peakVoices,b.peakVoices);if(b.blocks)a.frames=b.frames;a.minFrames=Math.min(a.minFrames,b.minFrames);a.maxFrames=Math.max(a.maxFrames,b.maxFrames);
 for(let i=0;i<BINS;i++)a.hist[i]+=b.hist[i];
}
function percentile(a,q){if(!a.measured)return null;let sum=0;for(let i=0;i<BINS;i++){sum+=a.hist[i];if(sum>=Math.ceil(q*a.measured))return i===BINS-1?null:(i+1)*BIN_MS;}return null;}
export function metrics(a){const mean=a.measured?a.sumMs/a.measured:null,budget=a.blocks?a.budgetSumMs/a.blocks:null;
 return {blocks:a.blocks,measuredBlocks:a.measured,meanMs:mean,p95Ms:percentile(a,.95),p99Ms:percentile(a,.99),maxMs:a.measured?a.maxMs:null,overBudget:a.measured?a.overBudget:null,budgetMs:budget,budgetUsedPercent:mean===null?null:100*mean/budget,frames:a.frames,minFrames:a.blocks?a.minFrames:null,maxFrames:a.maxFrames,peakVoices:a.peakVoices,histogramOverflow:a.overflow,invalidDurationBlocks:a.invalid};}
