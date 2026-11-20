// SPDX-License-Identifier: GPL-3.0-only
import {el, action} from './ui-primitives.js';
import {inspectWav} from './sampler-wav.js';
import {checkFrameRange, rangeWav} from './sampler-waveform.js';
import {runOffline} from './sampler-offline.js';

const seconds = (frame, rate) => String(Number((frame / rate).toFixed(6)));

export function createSamplerWaveform({getAudio, onCrop, onSelection} = {}) {
  const node = el('section', 'ww-sampler-waveform');
  node.setAttribute('aria-label', 'Waveform editor');
  const heading = el('div', 'ww-sampler-wave-title');
  const name = el('strong', '', 'Waveform');
  const metadata = el('span', 'ww-muted', 'Open a WAV to select a sample.');
  heading.append(name, metadata);
  const canvas = el('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Waveform. Drag to select a range, or enter its start and end below.');
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
  const preview = action('Preview selection', () => audition());
  const stop = action('Stop preview', () => { stopAudition(); status.textContent = ''; });
  const crop = action('Create Sample from Selection', () => createCrop());
  tools.append(preview, stop, zoom, fit, crop);
  const status = el('p', 'ww-sampler-wave-status');
  status.setAttribute('role', 'status');
  node.append(heading, canvas, ruler, fields, tools, status);

  let file, layout, selection, visible, peaks, drag;
  let generation = 0, scan, render, auditionState;
  function update() {
    for (const input of [units, inputs.start, inputs.end, zoom, fit, preview]) input.disabled = !layout;
    crop.disabled = !layout || !onCrop || !!render;
    stop.disabled = !auditionState;
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
    const dpr = window.devicePixelRatio || 1;
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
        const bins = peaks.length / (channels * 2);
        ctx.fillStyle = '#76dcd5';
        for (let i = 0; i < bins; i++) {
          const index = (i * channels + c) * 2;
          const top = middle - peaks[index + 1] / 32768 * lane * .46;
          const bottom = middle - peaks[index] / 32768 * lane * .46;
          ctx.fillRect(i * width / bins, top, Math.max(1, width / bins), Math.max(1, bottom - top));
        }
      }
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#c4d1d5';
      ctx.fillText(channels === 1 ? 'Mono' : c === 0 ? 'L' : 'R', 7, lane * c + 14);
    }
    ctx.fillStyle = '#f3d18c';
    for (const frame of [selection.start, selection.end]) {
      if (frame >= visible.start && frame <= visible.end) ctx.fillRect(Math.min(width - 2, x(frame)), 0, 2, height);
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
    drag = {pointer: event.pointerId, frame: pointerFrame(event), previous: selection};
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (drag?.pointer !== event.pointerId) return;
    const frame = pointerFrame(event);
    const start = Math.min(layout.frames - 1, drag.frame, frame);
    changeSelection({start, end: Math.max(start + 1, drag.frame, frame)});
  };
  canvas.onpointerup = event => {
    if (drag?.pointer !== event.pointerId) return;
    canvas.onpointermove(event);
    drag = null;
    onSelection?.({...selection, sampleRate: layout.sampleRate});
  };
  canvas.onlostpointercapture = canvas.onpointercancel = () => {
    if (drag) changeSelection(drag.previous);
    drag = null;
  };

  function stopAudition() {
    const state = auditionState;
    auditionState = null;
    if (state?.audio) {
      state.audio.onended = state.audio.onerror = null;
      state.audio.pause();
      state.audio.removeAttribute('src');
      state.audio.load();
      state.source?.disconnect();
      URL.revokeObjectURL(state.url);
    }
    stop.disabled = true;
  }
  async function audition() {
    stopAudition();
    const state = {};
    auditionState = state;
    stop.disabled = false;
    try {
      const {context, gain} = getAudio?.() || {};
      if (!context || !gain) throw Error('Start audio in the Synth to preview this selection.');
      const wav = rangeWav(file, layout, selection);
      await context.resume();
      if (auditionState !== state) return;
      state.audio = new Audio();
      state.url = URL.createObjectURL(wav);
      state.audio.src = state.url;
      state.source = context.createMediaElementSource(state.audio);
      state.source.connect(gain);
      state.audio.onended = () => { stopAudition(); status.textContent = 'Preview finished.'; };
      state.audio.onerror = () => { stopAudition(); status.textContent = 'Unable to play this WAV selection.'; };
      await state.audio.play();
      if (auditionState === state) status.textContent = 'Playing selection.';
    } catch (error) {
      if (auditionState === state) { stopAudition(); status.textContent = error.message; }
    }
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
  function clear() {
    generation++;
    scan?.abort(); render?.abort(); stopAudition();
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
    clear();
    file = source;
    layout = info;
    name.textContent = source.name || 'Sample waveform';
    metadata.textContent = [info.channels === 2 ? 'Stereo' : 'Mono', info.sampleRate.toLocaleString('en-US') + ' Hz',
      seconds(info.frames, info.sampleRate) + ' s'].join(' · ');
    selection = {start: range.start, end: range.end};
    await showRange({start: 0, end: layout.frames});
  }
  clear();
  return {node, open, clear, setSelection: range => changeSelection(range),
    getSelection: () => selection && {...selection, sampleRate: layout.sampleRate},
    destroy() { clear(); resize.disconnect(); }};
}
