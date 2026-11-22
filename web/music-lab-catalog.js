// SPDX-License-Identifier: GPL-3.0-only
import right from './music-lab/scale-c-major-rh-1oct.json' with {type:'json'};
import left from './music-lab/scale-c-major-lh-1oct.json' with {type:'json'};
import gMajor from './music-lab/scale-g-major-rh-1oct.json' with {type:'json'};
import fMajor from './music-lab/scale-f-major-rh-1oct.json' with {type:'json'};
import harmonic from './music-lab/scale-a-harmonic-minor-rh.json' with {type:'json'};
import chord from './music-lab/chord-c-major-rh.json' with {type:'json'};
import inversion from './music-lab/chord-c-first-inversion-rh.json' with {type:'json'};
import together from './music-lab/hands-together-c-basic.json' with {type:'json'};
import progression from './music-lab/progression-c-g-am-f-rh.json' with {type:'json'};
import pop from './music-lab/accompany-pop-two-hands.json' with {type:'json'};
import improv from './music-lab/improv-am-pentatonic-phrase.json' with {type:'json'};
import additional from './music-lab/additional-lessons.json' with {type:'json'};
import advanced from './music-lab/advanced-lessons.json' with {type:'json'};

const entry=(data,detail,options={})=>({data,label:data.title,detail,level:'application',...options});
const authored=Object.fromEntries(additional.map(lesson=>[lesson.id,lesson]));
const next=Object.fromEntries(advanced.map(lesson=>[lesson.id,lesson]));
export const LAB_LESSONS=[
  entry(right,'Mão direita · 1 oitava',{label:'Escala de Dó maior',level:'foundation'}),
  entry(left,'Mão esquerda · 1 oitava',{label:'Escala de Dó maior',level:'foundation'}),
  entry(chord,'Posição fundamental · mão direita',{label:'Tríade de Dó maior',level:'foundation',quality:''}),
  entry(gMajor,'Armadura com sustenido',{label:'Escala de Sol maior',level:'foundation'}),
  entry(fMajor,'Armadura com bemol',{label:'Escala de Fá maior',level:'foundation'}),
  entry(authored['scale-a-natural-minor-rh'],'Menor natural',{level:'foundation'}),
  entry(authored['chord-a-minor-rh'],'Posição fundamental · mão direita',{level:'foundation',quality:'m'}),
  entry(inversion,'Mi no baixo',{label:'Tríade de Dó maior · primeira inversão',quality:''}),
  entry(authored['chord-c-second-inversion-rh'],'Sol no baixo',{quality:''}),
  entry(harmonic,'Sétimo grau elevado',{label:'Escala de Lá menor harmônica'}),
  entry(authored['scale-a-melodic-minor-rh'],'Subida e descida'),
  entry(authored['scale-c-major-pentatonic-rh'],'Cinco graus · maior'),
  entry(authored['scale-a-minor-pentatonic-rh'],'Cinco graus · menor'),
  entry(authored['arpeggio-c-major-rh'],'Tríade maior · ataques separados'),
  entry(authored['arpeggio-a-minor-rh'],'Tríade menor · ataques separados'),
  entry(authored['chord-c-major-seventh-rh'],'Quatro notas',{quality:'maj7'}),
  entry(authored['chord-c-dominant-seventh-rh'],'Quatro notas',{quality:'7'}),
  entry(authored['chord-c-diminished-seventh-rh'],'Sétima dobrado bemol',{quality:'dim7'}),
  entry(together,'Baixo e melodia · duas pautas',{label:'Duas mãos: baixo e melodia',level:'coordination'}),
  entry(progression,'C · G · Am · F',{label:'Progressão pop',backing:'pop'}),
  entry(pop,'Baixo e acordes alternados',{label:'Acompanhamento pop',level:'coordination',backing:'pop'}),
  entry(improv,'Pergunta e resposta · prática livre',{label:'Improvisação pentatônica',backing:'minor'}),
  entry(next['mode-d-dorian-rh'],'Escala modal',{level:'advanced'}),
  entry(next['mode-g-mixolydian-rh'],'Escala modal',{level:'advanced'}),
  entry(next['voice-leading-c-am7-dm7-g7'],'Alturas comuns e inversões',{level:'advanced'}),
  entry(next['independence-c-f-two-hands'],'Mínimas e semínimas',{level:'advanced'}),
  entry(next['ear-echo-c-four-notes'],'Ouvido · repita no MIDI',{level:'advanced',ear:{type:'echo'}}),
  entry(next['ear-quality-c-major'],'Ouvido · maior ou menor',{
    level:'advanced',label:'Qualidade da tríade',ear:{type:'quality',prompt:'Escute e identifique a qualidade da tríade.',
      choices:['Maior','Menor'],trials:[next['ear-quality-c-major'],next['ear-quality-c-minor']]}
  }),
  entry(next['ear-cadence-tonic'],'Ouvido · dois finais',{
    level:'advanced',label:'Destino da cadência',ear:{type:'cadence',prompt:'Escute a frase e identifique onde termina.',
      choices:['Na tônica','Na relativa menor'],trials:[next['ear-cadence-tonic'],next['ear-cadence-relative']]}
  })
];

export function lessonChordSymbol(lesson,quality) {
  if(quality===undefined)return '';
  const bass=lesson.notes.reduce((lowest,note)=>note.pitch.midi<lowest.midi?note.pitch:lowest,lesson.notes[0].pitch);
  const pitch=bass.step+(bass.alter<0?'b'.repeat(-bass.alter):'#'.repeat(bass.alter));
  const tonic=lesson.key.tonic;
  return tonic+quality+(pitch===tonic?'':'/'+pitch);
}
