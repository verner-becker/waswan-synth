// SPDX-License-Identifier: GPL-3.0-only
import {action, el} from './ui-primitives.js';
import {runOffline} from './sampler-offline.js';

const field = (key, label, value, min, max, step = 'any') => ({key, label, value, min, max, step});
const frame = (key, label, value, min = 0) => field(key, label, value, min, undefined, 1);
const db = (key, label, value) => field(key, label, value, -144, 0);
const operations = {
  fade: ['Fade', [field('inFrames', 'Fade in (ms)', 0, 0), field('outFrames', 'Fade out (ms)', 0, 0)]],
  pitchShift: ['Pitch shift', [field('semitones', 'Pitch shift (semitones)', 0, -12, 12)]],
  trim: ['Trim range', [frame('start', 'Start frame in stage', 0), frame('end', 'End frame in stage (exclusive)', null, 1)]],
  trimSilence: ['Trim silence', [db('thresholdDb', 'Silence threshold (dBFS)', -50), frame('minFrames', 'Minimum silence (frames)', 1, 1), frame('marginFrames', 'Retain margin (frames)', 0)]],
  gain: ['Gain', [field('db', 'Gain (dB)', 0, -144, 60)]],
  normalizePeak: ['Normalize peak', [db('targetDb', 'Peak target (dBFS)', -1), db('ceilingDb', 'Peak ceiling (dBFS)', 0)]],
  normalizeRms: ['Normalize RMS', [db('targetDb', 'RMS target (dBFS)', -18), db('ceilingDb', 'Peak ceiling (dBFS)', 0)]],
  reverse: ['Reverse', []],
  channels: ['Convert channels', [field('channels', 'Output channels', 1, 1, 2, 1)]],
  rate: ['Resample', [field('sampleRate', 'Output sample rate (Hz)', 44100, 8000, 192000, 1)]],
  loopCrossfade: ['Loop crossfade', [frame('start', 'Loop start frame', 1, 1), frame('end', 'Loop end frame (exclusive)', null, 2), frame('frames', 'Crossfade length (frames)', 1, 1)]],
  stretch: ['Time stretch', [field('factor', 'Duration factor', 1, .5, 2)]],
  granular: ['Granular texture', [field('seconds', 'Output duration (s)', 1, .02, 120), field('grainMs', 'Grain length (ms)', 70, 5, 500),
    field('density', 'Grains per second', 25, 1, 150), field('jitter', 'Position jitter (0–1)', .1, 0, 1),
    field('positions', 'Position curve (0–1, comma separated)', [.5]), field('semitones', 'Grain pitch (semitones)', 0, -24, 24),
    field('detuneCents', 'Random detune (cents)', 0, 0, 1200), field('seed', 'Random seed', 1, undefined, undefined, 1)]],
};

function inputLayout(draft, index) {
  let rate = draft.source.sampleRate, frames = draft.selection[1] - draft.selection[0];
  for (const op of draft.recipe.slice(0, index)) {
    if (op.bypass) continue;
    if (op.type === 'trim') frames = op.end - op.start;
    if (op.type === 'stretch') frames = Math.max(1, Math.round(frames * op.factor));
    if (op.type === 'granular') frames = Math.round(rate * (op.seconds ?? 1));
    if (op.type === 'rate') {
      frames = Math.max(1, Math.round(frames * op.sampleRate / rate));
      rate = op.sampleRate;
    }
    // Silence removal is content-dependent. Its exact result is checked on render.
  }
  return {rate, frames};
}
function validateOperation(op, frames) {
  if (op.type === 'trim' && (op.start >= op.end || op.end > frames)) throw Error('Choose a nonempty trim range within this stage.');
  if (op.type === 'fade' && (op.inFrames > frames || op.outFrames > frames)) throw Error('Each fade must fit within this stage.');
  if (op.type === 'loopCrossfade' && (op.start + 1 >= op.end || op.end > frames || op.frames > Math.min(op.start, op.end - op.start))) {
    throw Error('The loop needs two frames and enough pre-roll for its crossfade.');
  }
}
const dbText = x => x ? (20 * Math.log10(x)).toFixed(1) + ' dBFS' : '−∞ dBFS';

export function createProcessingStack({change, run, preview, audition}) {
  const node = el('section', 'ww-sampler-processing');
  node.setAttribute('aria-label', 'Offline Processing');
  const controls = el('fieldset');
  const caption = el('legend', '', 'Offline Processing');
  const tools = el('div', 'ww-sampler-actions');
  const label = el('label', '', 'Processing operation ');
  const types = el('select');
  types.setAttribute('aria-label', 'Processing operation');
  for (const [value, [title]] of Object.entries(operations)) types.append(new Option(title, value));
  label.append(types);
  const add = action('Add stage', () => void run(() => {
    const type = types.value;
    const {frames} = inputLayout(draft, draft.recipe.length);
    const params = Object.fromEntries(operations[type][1].map(f => [f.key, f.value ?? frames]));
    const op = {type, ...params};
    validateOperation(op, frames);
    change([...draft.recipe, op]);
  }));
  const analyze = action('Analyze processed selection', () => void run(async () => {
    const audio = await preview(draft.recipe.length);
    const result = await runOffline(audio, {type:'analyze'});
    const {pitch, transients, clipping} = result;
    const measurements = [
      result.duration.toFixed(3) + ' s · ' + result.frames.toLocaleString('en-US') + ' frames',
      'Peak ' + dbText(result.peak) + ' · RMS ' + dbText(result.rms),
      'Clipped frames ' + clipping.map(c => c.frames).join(' / '),
      Number.isInteger(pitch.root) ? 'MIDI ' + pitch.root + ' · ' + pitch.hz.toFixed(1) + ' Hz · ' +
        (pitch.confidence * 100).toFixed(0) + '% confidence' : 'Pitch unavailable · ' + pitch.reason,
      transients.length + ' detected attack' + (transients.length === 1 ? '' : 's'),
    ];
    analysis.textContent = measurements.join('    /    ');
    markers.textContent = transients.length ? 'Attack frames in processed audio · ' + transients.join(', ') : '';
    details.hidden = !transients.length;
  }));
  const list = el('ol', 'ww-sampler-stages');
  const empty = el('p', 'ww-muted', 'The selection plays without processing.');
  const status = el('output', 'ww-sampler-stage-status');
  const analysis = el('p', 'ww-sampler-analysis');
  analysis.setAttribute('role', 'status');
  const details = el('details'), markers = el('p', 'ww-sampler-markers');
  details.hidden = true;
  details.append(el('summary', '', 'Detected attacks'), markers);
  const stop = action('Stop stage preview', () => audition.stop());
  audition.subscribe(active => { stop.disabled = !active; });
  tools.append(label, add, analyze, stop);
  controls.append(caption, tools, list, empty, status, analysis, details);
  node.append(controls);
  let draft, signature;
  function replace(index, op) {
    const next = [...draft.recipe];
    next[index] = op;
    change(next);
  }
  function stageButton(text, fn, disabled = false) {
    const button = action(text, () => void run(fn));
    button.disabled = disabled;
    return button;
  }
  function move(index, delta) {
    const next = [...draft.recipe];
    const [op] = next.splice(index, 1);
    next.splice(index + delta, 0, op);
    change(next);
    list.children[index + delta]?.querySelector('button')?.focus();
  }
  function remove(index) {
    change(draft.recipe.filter((_, i) => i !== index));
    (list.children[Math.min(index, list.children.length - 1)]?.querySelector('button') || add).focus();
  }
  function compare(index, after) {
    return async () => {
      const wav = await preview(index + Number(after));
      const where = (after ? 'After' : 'Before') + ' stage ' + (index + 1);
      const playing = await audition.play(wav, reason => {
        status.textContent = reason === 'error' ? 'Unable to play stage preview.' : '';
      });
      if (playing) status.textContent = where + ' · previewing';
    };
  }
  function stageRow(op, index) {
    const params = operations[op.type];
    const item = el('li');
    const title = el('strong', '', params?.[0] ?? op.type);
    const tools = el('div', 'ww-sampler-actions');
    const bypass = stageButton('Bypass', () => replace(index, {...op, bypass: !op.bypass}));
    bypass.setAttribute('aria-pressed', String(!!op.bypass));
    tools.append(title, bypass, stageButton('Move up', () => move(index, -1), index === 0),
      stageButton('Move down', () => move(index, 1), index === draft.recipe.length - 1),
      stageButton('Remove', () => remove(index)),
      stageButton('Listen before', compare(index, false)), stageButton('Listen after', compare(index, true)));
    item.append(tools);
    const {rate, frames} = inputLayout(draft, index);
    const grid = el('div', 'ww-sampler-fields');
    for (const f of params?.[1] ?? []) {
      const label = el('label', '', f.label);
      const input = el('input');
      const curve = f.key === 'positions';
      const millis = op.type === 'fade';
      const value = op[f.key] ?? f.value ?? frames;
      input.type = curve ? 'text' : 'number';
      input.required = true;
      if (!curve) {
        if (f.min !== undefined) input.min = f.min;
        if (f.max !== undefined) input.max = f.max;
        input.step = f.step;
      }
      input.value = curve ? value.join(', ') : millis ? Number((value * 1000 / rate).toFixed(5)) : value;
      input.onchange = () => void run(() => {
        try {
          if (!input.checkValidity()) throw Error('Choose a valid value for ' + f.label + '.');
          let value = input.valueAsNumber;
          if (curve) {
            const parts = input.value.split(',').map(s => s.trim());
            if (!parts.length || parts.length > 1024 || parts.some(s => !s || !Number.isFinite(Number(s)) || Number(s) < 0 || Number(s) > 1)) {
              throw Error('Enter up to 1,024 positions from 0 to 1, separated by commas.');
            }
            value = parts.map(Number);
          } else if (millis) value = Math.round(value * rate / 1000);
          const edited = {...op, [f.key]:value};
          validateOperation(edited, frames);
          replace(index, edited);
        } catch (error) {
          input.value = curve ? value.join(', ') : millis ? Number((value * 1000 / rate).toFixed(5)) : value;
          throw error;
        }
      });
      label.append(input);
      grid.append(label);
    }
    item.append(grid);
    return item;
  }
  function sync(next) {
    draft = next;
    controls.disabled = !draft || !!draft.instrument;
    const key = JSON.stringify([draft?.id, draft?.source?.sha256, draft?.selection, draft?.recipe]);
    if (signature === key) return;
    signature = key;
    list.replaceChildren(...(draft?.recipe ?? []).map(stageRow));
    empty.hidden = !!draft?.recipe?.length;
    analysis.textContent = markers.textContent = status.textContent = '';
    details.hidden = true;
  }
  sync(null);
  return {node, sync, stop: () => audition.stop()};
}
