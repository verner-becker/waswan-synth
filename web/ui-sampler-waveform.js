// SPDX-License-Identifier: GPL-3.0-only
import {el, action} from './ui-primitives.js';
import {inspectWav} from './sampler-wav.js';
import {checkFrameRange, rangeWav} from './sampler-waveform.js';
import {createWaveTools} from './ui-sampler-wave-tools.js';
import {createSamplerAudition} from './ui-sampler-audition.js';
import {runOffline} from './sampler-offline.js';

const seconds = (frame, rate) => String(Number((frame / rate).toFixed(6)));

export function createSamplerWaveform({getAudio, audition = createSamplerAudition(getAudio), onCrop, onSelection, onSlices, onLoop, onMarkers} = {}) {
  const node = el('section', 'ww-sampler-waveform');
  node.setAttribute('aria-label', 'Waveform editor');
  const heading = el('div', 'ww-sampler-wave-title');
  const name = el('strong', '', 'Waveform');
  const metadata = el('span', 'ww-muted', 'Open a WAV to select a sample.');
  heading.append(name, metadata);
  const canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Waveform. Drag to select a range, or enter its start and end below.');
  const surface = el('div', 'ww-sampler-wave-surface'), playhead = el('span', 'ww-sampler-playhead');
  playhead.hidden = true;
  surface.append(canvas, playhead);
  const ruler = el('div', 'ww-sampler-wave-ruler');
  const left = el('span'), right = el('span');
  ruler.append(left, right);
  const fields = el('div', 'ww-sampler-wave-fields');
  const unitLabel = el('label', '', 'Selection unit');
  const units = el('select');
  for (const [value, label] of [['frames', 'Frames'], ['seconds', 'Seconds']]) {
    const option = el('option', '', label);
    option.value = value;
    units.append(option);
  }
  unitLabel.append(units);
  fields.append(unitLabel);
  const inputs = {};
  for (const [key, label] of [['start', 'Start'], ['end', 'End (exclusive)']]) {
    const wrap = el('label', '', label);
    const input = el('input');
    input.type = 'number';
    input.onchange = () => {
      try {
        const raw = input.valueAsNumber;
        const frame = units.value === 'seconds' ? Math.round(raw * layout.sampleRate) : raw;
        changeSelection({...selection, [key]: frame}, true);
        status.textContent = '';
      } catch (error) {
        status.textContent = error.message;
        update();
      }
    };
    inputs[key] = input;
    wrap.append(input);
    fields.append(wrap);
  }
  units.onchange = () => update();
  const duration = el('output', 'ww-sampler-wave-duration');
  fields.append(duration);
  const tools = el('div', 'ww-sampler-wave-tools');
  const zoom = action('Zoom to selection', () => showRange(selection));
  const fit = action('Fit file', () => showRange({start: 0, end: layout.frames}));
  const preview = action('Preview selection', () => playSelection());
  const stop = action('Stop preview', () => { audition.stop(); status.textContent = ''; });
  const crop = action('Create Sample from Selection', () => createCrop());
  tools.append(preview, stop, zoom, fit, crop);
  const status = el('p', 'ww-sampler-wave-status');
  status.setAttribute('role', 'status');
  node.append(heading, surface, ruler, fields, tools, status);

  let file, layout, selection, visible, peaks, drag;
  let generation = 0, scan, render, ownsPreview = false, cropEnabled = true;
  let playbackStart = 0, playbackFrame, playbackWindow, pointerGeneration = 0, viewId = 0, playbackView;
  const detail = createWaveTools({state: () => ({file,layout,visible,selection,peaks}), showRange, paint,
    selectRange:range=>changeSelection(range,true),
    play:playSelection, report:message=>{status.textContent=message;}, onSlices, onLoop, onMarkers});
  node.insertBefore(detail.node,status);
  const unsubscribe = audition.subscribe(active => { stop.disabled = !active; });
  function update() {
    for (const input of [units, inputs.start, inputs.end, zoom, fit, preview]) input.disabled = !layout;
    crop.hidden = !cropEnabled;
    crop.disabled = !layout || !onCrop || !cropEnabled || !!render;
    if (!layout) {
      inputs.start.value = inputs.end.value = left.textContent = right.textContent = duration.textContent = '';
    } else {
      const inSeconds = units.value === 'seconds';
      const display = frame => inSeconds ? seconds(frame, layout.sampleRate) : String(frame);
      for (const [key, input] of Object.entries(inputs)) {
        input.setAttribute('aria-label', (key === 'start' ? 'Start ' : 'End ') + (inSeconds ? 'seconds' : 'frame'));
        input.value = display(selection[key]);
        input.step = inSeconds ? 'any' : '1';
        input.min = display(key === 'start' ? 0 : selection.start + 1);
        input.max = display(key === 'end' ? layout.frames : selection.end - 1);
      }
      left.textContent = seconds(visible.start, layout.sampleRate) + ' s';
      right.textContent = seconds(visible.end, layout.sampleRate) + ' s';
      const count = selection.end - selection.start;
      duration.textContent = count.toLocaleString('en-US') + ' frames · ' + seconds(count, layout.sampleRate) + ' s';
      zoom.disabled = selection.start === visible.start && selection.end === visible.end;
      fit.disabled = visible.start === 0 && visible.end === layout.frames;
    }
    paint();
  }
  function paint() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = canvas.ownerDocument.defaultView.devicePixelRatio || 1;
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!layout) return;
    const {channels} = layout, lane = height / channels;
    const x = frame => width * (frame - visible.start) / (visible.end - visible.start);
    ctx.fillStyle = '#204246';
    ctx.fillRect(x(selection.start), 0, x(selection.end) - x(selection.start), height);
    for (let c = 0; c < channels; c++) {
      const middle = (c + .5) * lane;
      ctx.fillStyle = '#50646a';
      ctx.fillRect(0, middle, width, 1);
      if (peaks) {
        ctx.save(); ctx.beginPath(); ctx.rect(0,lane*c,width,lane); ctx.clip();
        const bins = peaks.length / (channels * 2);
        ctx.fillStyle = '#76dcd5';
        for (let i = 0; i < bins; i++) {
          const index = (i * channels + c) * 2;
          const top = middle - peaks[index + 1] / 32768 * lane * .46 * detail.amplitude;
          const bottom = middle - peaks[index] / 32768 * lane * .46 * detail.amplitude;
          ctx.fillRect(i * width / bins, top, Math.max(1, width / bins), Math.max(1, bottom - top));
        }
        ctx.restore();
      }
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#c4d1d5';
      ctx.fillText(channels === 1 ? 'Mono' : c === 0 ? 'L' : 'R', 7, lane * c + 14);
    }
    ctx.fillStyle = '#ba91d8';
    for (const frame of detail.markers) {
      if (frame >= visible.start && frame <= visible.end) ctx.fillRect(x(frame),0,1,height);
    }
    if (detail.regionLoop) {
      const {start,end} = detail.regionLoop;
      ctx.fillStyle = '#67ece1';
      ctx.fillRect(x(start),2,x(end)-x(start),2);
      for (const frame of [start,end]) ctx.fillRect(x(frame),2,2,8);
    }
    ctx.fillStyle = '#f3d18c';
    for (const frame of [selection.start, selection.end]) {
      if (frame >= visible.start && frame <= visible.end) ctx.fillRect(Math.min(width - 2, x(frame)), 0, 2, height);
    }
    const cursor = detail.cursor;
    if (!(ownsPreview && playbackView === viewId) && cursor >= visible.start && cursor <= visible.end) {
      ctx.fillStyle = '#fff'; const at = Math.min(width - 1,x(cursor));
      ctx.fillRect(at,0,1,height);
      ctx.beginPath();ctx.moveTo(at-4,0);ctx.lineTo(at+4,0);ctx.lineTo(at,6);ctx.fill();
    }
  }
  const resize = new ResizeObserver(paint);
  resize.observe(canvas);

  async function showRange(range) {
    scan?.abort();
    const task = new AbortController();
    scan = task;
    visible = {...range};
    peaks = null;
    update();
    canvas.setAttribute('aria-busy', 'true');
    try {
      const result = await runOffline(file, {type: 'waveform', ...range, bins: 2048}, {signal: task.signal});
      if (scan === task) { peaks = result; paint(); }
    } catch (error) {
      if (!task.signal.aborted) status.textContent = error.message;
    } finally {
      if (scan === task) { scan = null; canvas.removeAttribute('aria-busy'); }
    }
  }
  function changeSelection(range, notify = false) {
    checkFrameRange(range, layout.frames);
    if (range.start !== selection.start || range.end !== selection.end) detail.clearSuggestions();
    selection = {start: range.start, end: range.end};
    update();
    if (notify) onSelection?.({...selection, sampleRate: layout.sampleRate});
  }
  const pointerFrame = event => {
    const box = canvas.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    return visible.start + Math.round(fraction * (visible.end - visible.start));
  };
  canvas.onpointerdown = event => {
    if (!layout || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    canvas.focus({preventScroll:true});
    const at = pointerFrame(event);
    const pixels = canvas.getBoundingClientRect().width;
    const distance = Math.abs(selection.start - at) <= Math.abs(selection.end - at) ? 'start' : 'end';
    const edge = Math.abs(selection[distance] - at) * pixels <= 6 * (visible.end - visible.start) ? distance : null;
    drag = {pointer:event.pointerId, frame:at, x:event.clientX, previous:selection, edge, moved:false};
    pointerGeneration++;
    canvas.setPointerCapture(event.pointerId);
  };
  function dragFrame(event) {
    const at=pointerFrame(event);
    return event.shiftKey ? Math.round(drag.frame+(at-drag.frame)/10) : at;
  }
  function dragRange(anchor, at) {
    if (drag.edge === 'start') return {start:Math.min(at,drag.previous.end-1),end:drag.previous.end};
    if (drag.edge === 'end') return {start:drag.previous.start,end:Math.max(at,drag.previous.start+1)};
    const start=Math.min(layout.frames-1,anchor,at);
    return {start,end:Math.max(start+1,anchor,at)};
  }
  canvas.onpointermove = event => {
    if (drag?.pointer !== event.pointerId) return;
    if (Math.abs(event.clientX-drag.x)>=2) drag.moved=true;
    if (drag.moved) changeSelection(dragRange(drag.frame,dragFrame(event)));
  };
  canvas.onpointerup = async event => {
    if (drag?.pointer !== event.pointerId) return;
    canvas.onpointermove(event);
    const gesture=drag, token=pointerGeneration, source=file, at=dragFrame(event);
    const edge=drag.edge;
    drag=null;
    try {
      const [anchor,frame]=await Promise.all([detail.snapFrame(gesture.frame),detail.snapFrame(at)]);
      if (pointerGeneration!==token || file!==source) return;
      detail.moveCursor(frame);
      if (!gesture.moved) return;
      const start=edge==='end'?gesture.previous.start:edge==='start'?Math.min(frame,gesture.previous.end-1):Math.min(layout.frames-1,anchor,frame);
      const end=edge==='start'?gesture.previous.end:edge==='end'?Math.max(start+1,frame):Math.max(start+1,anchor,frame);
      changeSelection({start,end},true);
    } catch(error) {
      if (pointerGeneration===token && file===source) {changeSelection(gesture.previous);status.textContent=error.message;}
    }
  };
  canvas.onlostpointercapture = canvas.onpointercancel = () => {
    if (drag) changeSelection(drag.previous);
    drag = null;
  };
  canvas.onkeydown = event => {
    if (!layout || event.altKey || event.metaKey || event.ctrlKey) return;
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      if (ownsPreview) audition.stop(); else void playSelection();
      return;
    }
    const step=event.shiftKey?1:Math.max(1,Math.round((visible.end-visible.start)/Math.max(1,canvas.clientWidth)));
    const next={ArrowLeft:detail.cursor-step, ArrowRight:detail.cursor+step, Home:visible.start, End:visible.end};
    if (Object.hasOwn(next,event.key)) { event.preventDefault(); detail.moveCursor(next[event.key]); }
  };
  function hidePlayhead() {
    playbackWindow?.cancelAnimationFrame(playbackFrame);
    playhead.hidden = true;
  }

  async function playSelection(range=selection,loop=false) {
    const view = viewId;
    try {
      const playing = audition.play(rangeWav(file, layout, range), reason => {
        ownsPreview = false;
        hidePlayhead();paint();
        if (view === viewId) status.textContent = reason === 'ended' ? 'Preview finished.' : reason === 'error' ? 'Unable to play this WAV selection.' : '';
      },{loop});
      playbackStart=range.start; playbackView=view; ownsPreview = true;
      if (await playing && view === viewId) {
        status.textContent = loop ? 'Repeating selection.' : 'Playing selection.';
        paint();
        const tick=()=>{
          if (!ownsPreview || playbackView !== viewId) return;
          const position = playbackStart + Math.round(audition.time * layout.sampleRate);
          const fraction = (position - visible.start) / (visible.end - visible.start);
          playhead.hidden = fraction < 0 || fraction > 1;
          playhead.style.left = (100 * fraction) + '%';
          playbackWindow = canvas.ownerDocument.defaultView;
          playbackFrame = playbackWindow.requestAnimationFrame(tick);
        };
        tick();
      }
    } catch (error) { ownsPreview = false; if (view === viewId) status.textContent = error.message; }
  }
  async function createCrop() {
    if (render || !layout) return;
    const task = new AbortController();
    render = task;
    const source = file, {start, end} = selection, {sampleRate} = layout;
    crop.disabled = true;
    status.textContent = 'Creating sample…';
    try {
      const {wav} = await runOffline(source, {type: 'edit', recipe: [{type: 'trim', start, end}]}, {signal: task.signal});
      task.signal.throwIfAborted();
      const stem = (source.name || 'Sample').replace(/\.wav$/iu, '');
      const excerpt = new File([wav], stem + '-' + start + '-' + end + '.wav', {type: 'audio/wav'});
      await onCrop({file: excerpt, source, start, end, sampleRate});
      if (!task.signal.aborted) status.textContent = '';
    } catch (error) {
      if (!task.signal.aborted) status.textContent = error.message;
    } finally {
      if (render === task) { render = null; update(); }
    }
  }
  function clear(stopAudio = true) {
    generation++;pointerGeneration++;viewId++;detail.reset();hidePlayhead();
    scan?.abort(); render?.abort();
    if (stopAudio && ownsPreview) audition.stop();
    scan = render = file = layout = selection = visible = peaks = drag = null;
    canvas.removeAttribute('aria-busy');
    name.textContent = 'Waveform';
    metadata.textContent = 'Open a WAV to select a sample.';
    status.textContent = '';
    update();
  }
  async function open(source, options = {}) {
    const token = ++generation;
    const info = await inspectWav(source, {anyRate: true});
    const range = options.selection ?? {start: 0, end: info.frames};
    checkFrameRange(range, info.frames);
    if (generation !== token) return;
    clear(false);
    file = source;
    layout = info;
    name.textContent = source.name || 'Sample waveform';
    metadata.textContent = [info.channels === 2 ? 'Stereo' : 'Mono', info.sampleRate.toLocaleString('en-US') + ' Hz',
      seconds(info.frames, info.sampleRate) + ' s'].join(' · ');
    selection = {start: range.start, end: range.end};
    visible = {start:0,end:layout.frames};
    detail.open(range,options.markers);
    detail.setLoop(options.loop);
    await showRange({start: 0, end: layout.frames});
  }
  clear();
  return {node, open, clear, getMarkers:()=>[...detail.markers],setMarkers:marks=>detail.setMarkers(marks),setLoop:detail.setLoop,setSelection: range => changeSelection(range),
    setCropEnabled(enabled) { cropEnabled = !!enabled; update(); },
    getSelection: () => selection && {...selection, sampleRate: layout.sampleRate},
    destroy() { clear(); unsubscribe(); resize.disconnect(); }};
}


export function createMiniWaveform() {
  const node = el('canvas', 'ww-sampler-mini-waveform');
  node.setAttribute('aria-label', 'Checkpoint audio waveform');
  node.setAttribute('role', 'img');
  node.width = 240;
  node.height = 48;
  const ctx = node.getContext('2d');
  let current;
  function clear() {
    current?.abort();
    current = null;
    ctx.clearRect(0, 0, node.width, node.height);
  }
  async function show(wav) {
    clear();
    const task = new AbortController();
    current = task;
    try {
      const {channels, frames} = await inspectWav(wav, {anyRate: true});
      const bins = Math.min(frames, node.width);
      const peaks = await runOffline(wav, {type:'waveform', bins}, {signal:task.signal});
      if (current !== task) return;
      const lane = node.height / channels;
      ctx.fillStyle = '#76dcd5';
      for (let i = 0; i < bins; i++) for (let c = 0; c < channels; c++) {
        const j = (i * channels + c) * 2;
        const scale = lane * .47 / 32768;
        const top = lane * (c + .5) - peaks[j + 1] * scale;
        ctx.fillRect(i * node.width / bins, top, node.width / bins, Math.max(1, (peaks[j + 1] - peaks[j]) * scale));
      }
    } catch (error) {
      if (!task.signal.aborted) throw error;
    }
  }
  return {node, clear, show};
}
