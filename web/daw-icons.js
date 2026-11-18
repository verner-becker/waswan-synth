// SPDX-License-Identifier: GPL-3.0-only
const shapes={
  keyboard:['M2 5h20v14H2z','M6 5v14m4-14v14m4-14v14m4-14v14','M5 5v7m4-7v7m8-7v7'],
  piano:['M3 15V6c0-3 5-5 10-4 6 1 8 5 8 9v8H3z','M3 15h18M7 15v4m4-4v4m4-4v4m4-4v4'],
  bass:['M14 2h4v5l-3 5c4 5 2 10-3 10-6 0-9-6-5-10 1-1 3-1 4 0l3-5z','M7 18 16 4'],
  guitar:['M14 2h4v5l-3 5c4 5 2 10-3 10-6 0-9-6-5-10 1-1 3-1 4 0l3-5z','M7 18 16 4','M9 15h3v3H9z'],
  acoustic:['M15 2h3v4l-3 7c3 4 2 9-3 9-7 0-9-5-6-8 2-2 4-1 5 0z','M10 16a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0','M8 19 16 5'],
  organ:['M3 3h4v14H3zM10 6h4v11h-4zM17 2h4v15h-4z','M2 18h20v4H2zm4 0v4m4-4v4m4-4v4m4-4v4'],
  drums:['M3 8c0-4 18-4 18 0s-18 4-18 0zm0 0v10c0 4 18 4 18 0V8','M3 12l6 8 6-10 6 8M2 2l9 5m11-5-9 5'],
  percussion:['M3 5h18L12 21z','M12 1v8M2 15l17-8'],
  voice:['M8 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0','M3 22v-4c0-6 18-6 18 0v4','M7 18v4m10-4v4'],
  backing:['M6 8a3 3 0 1 0 6 0 3 3 0 1 0-6 0M14 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0','M2 22v-5c0-4 12-4 12 0v5m0-8c4-4 8-1 8 2v6'],
  strings:['M11 2h3v6c5 1 5 4 1 6 5 6 1 10-3 8-7-2-6-6-2-9-4-2-4-5 1-6z','M5 22 21 2M12 8v12'],
  fx:['M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z'],
  mic:['M8 6a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z','M4 10v2a8 8 0 0 0 16 0v-2M12 20v3m-4 0h8'],
  audio:['M2 12h3l2-8 3 16 3-14 3 12 2-6h4'],
  generic:['M4 4h16v16H4z','M8 8h8m-8 4h8m-8 4h5']
};
export function trackIcon(name){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'18',height:'18',fill:'none',stroke:'currentColor','stroke-width':'1.4','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
  for(const d of shapes[name]||shapes.generic){const path=document.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path);}return svg;
}
