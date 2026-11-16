// SPDX-License-Identifier: GPL-3.0-only
// Deliberately small pitch-class recognizer, not harmonic analysis.
const names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const shapes=[['',[0,4,7]],['m',[0,3,7]],['dim',[0,3,6]],['aug',[0,4,8]],['sus2',[0,2,7]],['sus4',[0,5,7]],['7',[0,4,7,10]],['maj7',[0,4,7,11]],['m7',[0,3,7,10]]];
export function chordLabel(notes) {
  const pcs=[...new Set(notes.map(n=>((n%12)+12)%12))].sort((a,b)=>a-b);
  if (!pcs.length) return {name:'—',notes:'No gated notes'};
  const list=pcs.map(p=>names[p]).join(' · ');
  if (pcs.length<3) return {name:pcs.map(p=>names[p]).join(' + '),notes:list};
  const matches=[];
  for(const root of pcs)for(const [suffix,intervals] of shapes)
    if(intervals.length===pcs.length&&intervals.every(i=>pcs.includes((root+i)%12)))matches.push(names[root]+suffix);
  return {name:matches.length===1?matches[0]:matches.length?'Ambiguous':'Note set',notes:list};
}
