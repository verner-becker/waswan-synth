// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';
import {FM_HEADER,FM_OP_BYTES} from './fm-patch.js';

// The DSP supplies its routing flags in front-panel order, OP1..OP6.
// Follow the two modulation buses from OP6 down to the audio output.
function routing(flags) {
  const buses=[[],[],[]],inputs=Array.from({length:6},()=>[]);
  let feedbackIn,feedbackOut;
  for(let op=5;op>=0;op--){
    const f=flags[op],input=(f>>4)&3,dest=f&3;
    if(input)inputs[op]=[...buses[input]];
    buses[dest]=f&4?[...buses[dest],op]:[op];
    if(f&64)feedbackIn=op;
    if(f&128)feedbackOut=op;
  }
  return {inputs,carriers:buses[0],feedbackIn,feedbackOut};
}

export class FmEditor {
  constructor(edit){
    this.edit=edit;this.op=0;this.fields=[];
    this.node=el('section','ww-fm-panel');
    this.graph=el('div','ww-fm-graph');this.graph.setAttribute('aria-label','Operator routing');
    this.feedbackPath=el('small','ww-muted');
    const routingPanel=el('div','ww-fm-routing');
    this.algorithm=el('select');this.algorithm.setAttribute('aria-label','FM algorithm');
    for(let n=1;n<=32;n++)this.algorithm.add(new Option(String(n),String(n-1)));
    this.algorithm.onchange=()=>edit(1,Number(this.algorithm.value));
    const algo=el('label','','Algorithm ');algo.append(this.algorithm);
    routingPanel.append(algo,this.graph,this.feedbackPath);
    this.operator=el('fieldset','ww-fm-fields');
    this.title=el('legend');this.operator.append(this.title);
    const mode=el('select');mode.add(new Option('Ratio','0'));mode.add(new Option('Fixed','1'));
    this.add(this.operator,'Frequency mode',0,mode,true);
    for(const [name,field,max] of [['Coarse',1,31],['Fine',2,99],['Detune',3,14],['Output level',4,99],['Velocity sensitivity',5,7]])
      this.numeric(this.operator,name,field,max,true);
    this.frequency=el('output','ww-muted');this.operator.append(this.frequency);
    const envelope=el('fieldset','ww-fm-envelope');envelope.append(el('legend','','Operator envelope'));
    for(const [label,base] of [['Rate',6],['Level',10]]){
      for(let i=0;i<4;i++)this.numeric(envelope,label+' '+(i+1),base+i,99,true);
    }
    const global=el('div','ww-fm-globals');
    this.numeric(global,'Feedback',2,7);this.numeric(global,'FM level',4,127);
    this.silentHint=el('small','ww-muted','Raise FM level to hear this layer.');
    global.append(this.silentHint);
    this.node.append(routingPanel,this.operator,envelope,global);
    this.mix=el('section','ww-fm-mix');
    this.numeric(this.mix,'Analog level',3,127,false,true);this.numeric(this.mix,'FM level',4,127,false,true);
  }
  numeric(parent,name,field,max,perOp=false,slider=false){
    const input=el('input');input.type=slider?'range':'number';input.min=field===3&&perOp?-7:0;input.max=field===3&&perOp?7:max;input.step=1;
    this.add(parent,name,field,input,perOp);
  }
  add(parent,name,field,input,perOp){
    const label=el('label','',name),offset=field===3&&perOp?7:0;
    const apply=()=>{
      if(input.value!==''&&input.checkValidity())this.edit(field+(perOp?FM_HEADER+this.op*FM_OP_BYTES:0),Number(input.value)+offset);
    };
    if(input.type==='range')input.oninput=apply;else input.onchange=apply;
    label.append(input);parent.append(label);
    const meter=input.type==='range'?el('output'):null;if(meter)label.append(meter);
    this.fields.push({field,input,perOp,offset,meter});
  }
  draw(flags){
    const {inputs,carriers,feedbackIn,feedbackOut}=routing(flags);
    const layers=Array(6).fill(0),rows=[];
    for(let op=0;op<6;op++)for(const src of inputs[op])layers[src]=Math.max(layers[src],layers[op]+1);
    for(let op=0;op<6;op++)(rows[layers[op]]??=[]).push(op);
    const pos=layers.map((depth,op)=>({x:100*(rows[depth].indexOf(op)+.5)/rows[depth].length,y:100*(rows.length-depth-.5)/(rows.length+1)}));
    this.graph.replaceChildren();this.buttons=[];
    const ns='http://www.w3.org/2000/svg',lines=document.createElementNS(ns,'svg');
    lines.setAttribute('viewBox','0 0 100 100');lines.setAttribute('preserveAspectRatio','none');lines.setAttribute('aria-hidden','true');this.graph.append(lines);
    const edge=(from,to)=>{
      const path=document.createElementNS(ns,'line');
      for(const [k,v] of Object.entries({x1:from.x,y1:from.y,x2:to.x,y2:to.y}))path.setAttribute(k,String(v));
      lines.append(path);
    };
    const output={x:50,y:100*(rows.length+.5)/(rows.length+1)};
    inputs.forEach((sources,dest)=>sources.forEach(src=>edge(pos[src],pos[dest])));
    for(const op of carriers)edge(pos[op],output);
    for(let op=0;op<6;op++){
      const b=action(String(op+1),()=>{this.op=op;this.update(this.state,this.available);});
      b.setAttribute('aria-label','Operator '+(op+1));const sources=inputs[op].map(i=>'OP '+(i+1)).join(', ');
      b.title=(carriers.includes(op)?'Carrier':'Modulator')+(sources?' · input from '+sources:'');
      b.setAttribute('aria-description',b.title);
      b.style.left=pos[op].x+'%';b.style.top=pos[op].y+'%';this.graph.append(b);this.buttons.push(b);
    }
    const out=el('span','','Out');out.style.left='50%';out.style.top=output.y+'%';this.graph.append(out);
    this.feedbackPath.textContent='Feedback · OP '+(feedbackOut+1)+' → OP '+(feedbackIn+1);
  }
  update(state,available){
    this.state=state;this.available=available;if(!state)return;
    const bytes=state.bytes,base=FM_HEADER+this.op*FM_OP_BYTES;
    if(this.algorithmKey!==bytes[1]){this.algorithmKey=bytes[1];this.draw(state.route);}
    this.silentHint.hidden=bytes[4]!==0;
    this.algorithm.value=String(bytes[1]);this.algorithm.disabled=!available;
    this.title.textContent='Operator '+(this.op+1);
    this.buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===this.op)));
    for(const {field,input,offset,perOp,meter} of this.fields){
      const value=String(bytes[(perOp?base:0)+field]-offset);
      if(input!==document.activeElement||input.type!=='number')input.value=value;
      input.disabled=!available;if(meter)meter.value=value;
    }
    const coarse=bytes[base+1],fine=bytes[base+2];
    this.frequency.textContent=bytes[base]?(10**((coarse%4)+fine/100)).toFixed(1)+' Hz':((coarse||.5)*(1+fine/100)).toFixed(2)+' × note';
  }
}
