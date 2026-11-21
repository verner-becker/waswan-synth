// SPDX-License-Identifier: GPL-3.0-only
import {action,CompactMeter,el,Panel} from './ui-primitives.js';

const FRAME_MS=50, METER_SAMPLES=1024, WAVE_SAMPLES=2048;
const HISTORY_SECONDS=10, HISTORY_WIDTH=HISTORY_SECONDS*1000/FRAME_MS, HISTORY_HEIGHT=128;
const FREQUENCIES=[16000,4000,1000,250,62.5];
const MIN_DB=-100, MAX_DB=-20;
const PALETTE=[[12,21,25],[39,49,115],[23,166,167],[249,221,116]];
const spectrumColors=Array.from({length:256},(_,i)=>{
  const position=i*(PALETTE.length-1)/255, index=Math.min(PALETTE.length-2,Math.floor(position));
  return PALETTE[index].map((value,channel)=>Math.round(value+(PALETTE[index+1][channel]-value)*(position-index)));
});

export class OutputMonitor {
  constructor({title='Synth output',detail='Post-master · mono',zoomId='ww-scope-zoom'}={}) {
    this.node=Panel(title,detail);
    this.node.classList.add('ww-output-monitor');
    this.lastDraw=-Infinity;
    this.autoGain=1;

    const modes=el('div','ww-output-modes');
    modes.setAttribute('role','group');
    modes.setAttribute('aria-label','Output visualization');
    this.waveButton=action('Oscilloscope',()=>this.setMode(false));
    this.spectrumButton=action('Spectrogram',()=>this.setMode(true));
    modes.append(this.waveButton,this.spectrumButton);
    this.node.firstElementChild.append(modes);

    this.canvas=el('canvas','ww-scope');
    this.canvas.setAttribute('role','img');
    this.brush=this.canvas.getContext('2d');
    this.frequencyAxis=el('div','ww-frequency-axis');
    this.frequencyAxis.setAttribute('aria-hidden','true');
    for(const [i,hz] of FREQUENCIES.entries()){
      const label=hz>=1000?`${hz/1000}k`:String(hz);
      this.frequencyAxis.append(el('span','',i===0?'16 kHz':i===FREQUENCIES.length-1?`${label} Hz`:label));
    }
    const chart=el('div','ww-output-chart');chart.append(this.frequencyAxis,this.canvas);

    this.zoom=el('div','ww-output-zoom');
    const zoomLabel=el('label','','Y zoom');
    zoomLabel.htmlFor=zoomId;
    this.zoomControl=el('select');
    this.zoomControl.id=zoomLabel.htmlFor;
    this.zoomControl.title='Waveform display gain only';
    for(const [value,label] of [['auto','Auto'],['1','1×'],['2','2×'],['4','4×'],['8','8×'],['16','16×'],['32','32×']]){
      this.zoomControl.add(new Option(label,value));
    }
    this.zoomControl.onchange=()=>this.paint();
    this.zoom.append(zoomLabel,this.zoomControl);

    this.legend=el('div','ww-spectrum-legend');
    this.legend.append(el('span','','−100 dB'),el('span','ww-spectrum-color'),el('span','','−20 dB'));
    this.legend.setAttribute('aria-label','Color intensity from −100 to −20 dB');
    this.status=el('small','ww-muted','Waiting for audio');
    const footer=el('div','ww-output-footer');footer.append(this.legend,this.status);

    this.rms=CompactMeter('RMS');
    this.peak=CompactMeter('Peak');
    this.rms.update(null);
    this.peak.update(null);
    const levels=el('div','ww-output-levels');levels.append(this.rms.node,this.peak.node,this.zoom);
    const plot=el('div','ww-output-plot');plot.append(chart,footer);
    const display=el('div','ww-output-display');display.append(plot,levels);
    this.node.append(display);
    this.setMode(false);
    new ResizeObserver(()=>this.paint()).observe(this.canvas);
  }

  attach(context,gain) {
    if(this.source)this.source.disconnect(this.analyser);
    this.source=gain;
    this.analyser=context.createAnalyser();
    this.analyser.fftSize=4096;
    this.analyser.smoothingTimeConstant=0;
    gain.connect(this.analyser);
    this.wave=new Float32Array(this.analyser.fftSize);
    this.frequency=new Float32Array(this.analyser.frequencyBinCount);
    this.binRanges=Array.from({length:HISTORY_HEIGHT},(_,row)=>{
      const high=FREQUENCIES[0],low=FREQUENCIES.at(-1),binHz=context.sampleRate/this.analyser.fftSize;
      const first=high*(low/high)**(row/HISTORY_HEIGHT)/binHz;
      const last=high*(low/high)**((row+1)/HISTORY_HEIGHT)/binHz;
      const max=this.frequency.length-1;
      return [Math.min(max,Math.round(last)),Math.min(max,Math.round(first))];
    });
    this.autoGain=1;
    this.history?.getContext('2d').clearRect(0,0,HISTORY_WIDTH,HISTORY_HEIGHT);
    this.lastColumn=null;
  }

  detach() {
    this.source?.disconnect(this.analyser);
    this.source=this.analyser=null;
    this.rms.update(null);this.peak.update(null);
    this.history?.getContext('2d').clearRect(0,0,HISTORY_WIDTH,HISTORY_HEIGHT);
    this.updateStatus();this.paint();
  }

  setMode(spectrum) {
    this.spectrum=spectrum;
    this.waveButton.setAttribute('aria-pressed',String(!spectrum));
    this.spectrumButton.setAttribute('aria-pressed',String(spectrum));
    this.canvas.setAttribute('aria-label',spectrum
      ? 'Output spectrogram, 62.5 Hz to 16 kHz over the last 10 seconds, newest on the right'
      : 'Main output waveform');
    this.zoom.hidden=spectrum;
    this.frequencyAxis.hidden=!spectrum;
    this.legend.hidden=!spectrum;
    this.updateStatus();
    this.paint();
  }

  updateStatus() {
    const context=this.analyser?.context;
    const text=context?.state==='running'
      ? (this.spectrum?'Last 10 s →':`${Math.round(1000*WAVE_SAMPLES/context.sampleRate)} ms`)
      : (context?`Audio ${context.state}`:'Waiting for audio');
    if(this.status.textContent!==text)this.status.textContent=text;
  }

  draw(now) {
    const slot=Math.floor(now/FRAME_MS);
    if(!this.analyser||slot===this.lastDraw)return;
    this.lastDraw=slot;
    this.updateStatus();
    if(this.analyser.context.state!=='running'){
      this.rms.update(null);
      this.peak.update(null);
      this.paint();
      return;
    }
    this.analyser.getFloatTimeDomainData(this.wave);
    let sum=0,peak=0;
    for(let i=this.wave.length-METER_SAMPLES;i<this.wave.length;i++){
      const sample=this.wave[i];
      sum+=sample*sample;
      peak=Math.max(peak,Math.abs(sample));
    }
    this.rms.update(Math.sqrt(sum/METER_SAMPLES));
    this.peak.update(peak);
    if(this.spectrum)this.appendSpectrum(slot);
    this.paint();
  }

  appendSpectrum(slot) {
    if(!this.history){
      this.history=el('canvas');
      this.history.width=HISTORY_WIDTH;
      this.history.height=HISTORY_HEIGHT;
      this.column=this.history.getContext('2d').createImageData(1,HISTORY_HEIGHT);
    }
    const advance=this.lastColumn===null?HISTORY_WIDTH:Math.min(HISTORY_WIDTH,slot-this.lastColumn);
    this.lastColumn=slot;
    const width=HISTORY_WIDTH-advance, brush=this.history.getContext('2d');
    if(width)brush.drawImage(this.history,advance,0,width,HISTORY_HEIGHT,0,0,width,HISTORY_HEIGHT);
    brush.clearRect(width,0,advance,HISTORY_HEIGHT);
    this.analyser.getFloatFrequencyData(this.frequency);
    for(let row=0;row<HISTORY_HEIGHT;row++){
      const [first,last]=this.binRanges[row];
      let db=MIN_DB;
      for(let i=first;i<=last;i++)db=Math.max(db,this.frequency[i]);
      const color=spectrumColors[Math.round(Math.min(1,(db-MIN_DB)/(MAX_DB-MIN_DB))*255)];
      this.column.data.set(color,row*4);
      this.column.data[row*4+3]=255;
    }
    brush.putImageData(this.column,HISTORY_WIDTH-1,0);
  }

  paint() {
    const {canvas,brush}=this;
    const scale=devicePixelRatio||1;
    const width=Math.round(canvas.clientWidth*scale),height=Math.round(canvas.clientHeight*scale);
    if(!width||!height)return;
    if(canvas.width!==width||canvas.height!==height){
      canvas.width=width;
      canvas.height=height;
    }
    brush.clearRect(0,0,width,height);
    if(this.spectrum&&this.history){
      brush.imageSmoothingEnabled=false;
      brush.drawImage(this.history,0,0,width,height);
    }
    brush.strokeStyle=this.spectrum?'#a9b8bf32':'#293e45';
    brush.lineWidth=scale;
    brush.beginPath();
    for(let col=1;col<10;col++){
      brush.moveTo(width*col/10,0);
      brush.lineTo(width*col/10,height);
    }
    for(let row=1;row<4;row++){
      brush.moveTo(0,height*row/4);
      brush.lineTo(width,height*row/4);
    }
    brush.stroke();
    if(!this.spectrum&&this.analyser?.context.state==='running')this.paintWave(width,height,scale);
  }

  paintWave(width,height,scale) {
    // Find a recent rising zero crossing with a full window of audio after it.
    const latest=this.wave.length-WAVE_SAMPLES;
    let start=latest;
    for(let i=latest;i>0;i--){
      if(this.wave[i-1]<=0&&this.wave[i]>0){
        start=i;
        break;
      }
    }
    let peak=0;
    for(let i=start;i<start+WAVE_SAMPLES;i++)peak=Math.max(peak,Math.abs(this.wave[i]));
    const target=Math.min(32,Math.max(1,.85/Math.max(peak,.001)));
    this.autoGain=Math.min(target,this.autoGain+(target-this.autoGain)*.35);
    const zoom=this.zoomControl.value==='auto'?this.autoGain:Number(this.zoomControl.value);
    const c=this.brush;
    c.strokeStyle='#27e3dd';
    c.lineWidth=1.5*scale;
    c.beginPath();
    c.moveTo(0,height/2-this.wave[start]*zoom*height*.45);
    for(let i=1;i<WAVE_SAMPLES;i++){
      c.lineTo(i*width/(WAVE_SAMPLES-1),height/2-this.wave[start+i]*zoom*height*.45);
    }
    c.stroke();
  }
}
