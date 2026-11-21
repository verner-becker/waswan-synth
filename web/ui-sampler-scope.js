// SPDX-License-Identifier: GPL-3.0-only
import {el} from './ui-primitives.js';
import {OutputMonitor} from './ui-output-monitor.js';

export function createSamplerScope(studio) {
  const node=studio.section('Oscilloscope',false);
  const label=el('label','','Scope input '),input=el('select');
  input.append(new Option('Shared output · post-master','output'),new Option('WAV preview only','preview'));
  label.append(input);node.append(label);
  let monitor,observer,visible=false,frame,view,owner;

  function draw(now) {
    if(!monitor) {
      monitor=new OutputMonitor({title:'Signal monitor',detail:'Mono',zoomId:'ww-sampler-scope-zoom'});
      node.append(monitor.node);
    }
    const {context,gain}=studio.bridge.getAudio()??{};
    const preview=input.value==='preview';
    const source=preview?studio.audition.source:gain;
    if(source && source!==monitor.source) monitor.attach(context,source);
    else if(!source && monitor.source) monitor.detach();
    const description=(preview?'WAV preview':'Shared output')+(monitor.spectrum?' spectrogram':' waveform');
    if(monitor.canvas.getAttribute('aria-label')!==description) monitor.canvas.setAttribute('aria-label',description);
    if(!source){
      const waiting=preview?'Play a WAV selection to see its waveform':'Waiting for audio';
      if(monitor.status.textContent!==waiting) monitor.status.textContent=waiting;
    }
    monitor.draw(now);
    frame=view.requestAnimationFrame(draw);
  }
  function refresh() {
    view.cancelAnimationFrame(frame);
    if(visible && node.open && !node.ownerDocument.hidden) frame=view.requestAnimationFrame(draw);
    else monitor?.detach();
  }
  function observe() {
    observer?.disconnect();
    if(view) {
      view.cancelAnimationFrame(frame);
      owner.removeEventListener('visibilitychange',refresh);
    }
    owner=node.ownerDocument;view=owner.defaultView;
    visible=false;
    observer=new view.IntersectionObserver(([entry])=>{visible=entry.isIntersecting;refresh();});
    observer.observe(node);
    view.document.addEventListener('visibilitychange',refresh);
    refresh();
  }
  node.addEventListener('toggle',refresh);
  observe();
  return {node,observe};
}
