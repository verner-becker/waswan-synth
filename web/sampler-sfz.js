// SPDX-License-Identifier: GPL-3.0-only

import {createInstrument, SamplerError, samplerLimits, samplerPath, validSamplerId, validateInstrument} from './sampler-instrument.js';
import {importOriginal, inspectWav, load, publish, readSampleFile} from './sampler-library.js';
import {exportName, openRelativeFile, writeBundle} from './sampler-export-files.js';

const supported = new Set(['sample', 'key', 'lokey', 'hikey', 'pitch_keycenter', 'lovel', 'hivel', 'tune', 'volume',
  'amp_veltrack', 'loop_mode', 'loop_start', 'loop_end', 'offset', 'end']);
const sequences = new Set(['seq_position', 'seq_length', 'lorand', 'hirand']);
const maxTextLength = 2 * 1024 * 1024;

function issue(diagnostics, severity, code, message, details = {}) {
  diagnostics.push({severity, code, message, ...details});
}

function result(diagnostics, values) {
  return {ok: !diagnostics.some(entry => entry.severity === 'error'), diagnostics, ...values};
}

function confirm(plan, acceptLosses) {
  if (!plan.ok || (!acceptLosses && plan.diagnostics.some(entry => entry.severity === 'loss'))) {
    throw new SamplerError('sfz-plan-required', 'Review the SFZ report before writing files.', {diagnostics: plan.diagnostics});
  }
}

function midi(value) {
  const note = /^([a-g])([#b]?)(-?\d+)$/iu.exec(value);
  if (!note) return numeric(value, 0, 127, true);
  const [, letter, accidental, octave] = note;
  const semitone = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}[letter.toUpperCase()];
  return numeric(String((Number(octave) + 1) * 12 + semitone + (accidental === '#' ? 1 : accidental ? -1 : 0)), 0, 127, true);
}

function numeric(raw, first, end, integer = false) {
  const value = /^[+-]?\d+(?:\.\d+)?$/u.test(raw) || /^[+-]?\.\d+$/u.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < first || value > end || (integer && !Number.isSafeInteger(value))) {
    throw new SamplerError('invalid-opcode', `Expected ${integer ? 'an integer' : 'a number'} from ${first} through ${end}.`);
  }
  return value;
}

function portableSample(raw) {
  const value = (raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw).replaceAll('\\', '/').replace(/^(?:\.\/)+/u, '');
  samplerPath(value);
  if (!/\.wav$/iu.test(value) || value.includes('=')) throw new SamplerError('unsupported-sample', 'Use a relative PCM WAV path.');
  return value;
}

function valueOf(ops, opcode, fallback, parse, diagnostics) {
  const entry = ops.get(opcode);
  if (!entry) return fallback;
  try {
    return parse(entry.value);
  } catch (cause) {
    issue(diagnostics, 'error', cause.code, cause.message, {opcode, line: entry.line, value: entry.value});
    return fallback;
  }
}

function decodeRegion(ops, group, line, diagnostics) {
  const get = (key, fallback, parse) => valueOf(ops, key, fallback, parse, diagnostics);
  const sample = get('sample', undefined, portableSample);
  if (!sample && !ops.has('sample')) issue(diagnostics, 'error', 'missing-sample', 'This region has no sample opcode.', {line});
  const key = [get('lokey', 0, midi), get('hikey', 127, midi)];
  const root = get('pitch_keycenter', 60, midi);
  const velocity = [get('lovel', 1, value => Math.max(1, numeric(value, 0, 127, true))),
    get('hivel', 127, value => numeric(value, 1, 127, true))];
  if (key[0] > key[1] || velocity[0] > velocity[1]) {
    issue(diagnostics, 'error', 'invalid-region', 'The region has an inverted key or velocity range.', {line});
  }
  const cents = get('tune', 0, value => numeric(value, -100, 100, true));
  const gainDb = get('volume', 0, value => numeric(value, -144, 6));
  const tracking = get('amp_veltrack', 100, value => numeric(value, -100, 100));
  if (tracking !== 0 && tracking !== 100) {
    issue(diagnostics, 'loss', 'velocity-curve', 'This profile approximates velocity tracking with the SFZ default curve.', {
      line: ops.get('amp_veltrack').line, value: tracking,
    });
  }
  const loopMode = get('loop_mode', 'no_loop', String);
  let mode = 'gate';
  if (loopMode === 'one_shot') mode = 'oneShot';
  else if (!['no_loop', 'loop_continuous'].includes(loopMode)) {
    issue(diagnostics, 'error', 'unsupported-loop', 'Use no_loop, one_shot or loop_continuous in this profile.', {
      line: ops.get('loop_mode').line, value: loopMode,
    });
  }
  const frameNumber = value => numeric(value, 0, 0x7ffffffe, true);
  const start = get('offset', 0, frameNumber);
  const end = get('end', undefined, value => frameNumber(value) + 1);
  let loop;
  if (loopMode === 'loop_continuous') {
    const loopStart = get('loop_start', undefined, frameNumber);
    const loopEnd = get('loop_end', undefined, value => frameNumber(value) + 1);
    if (loopStart === undefined || loopEnd === undefined || loopStart >= loopEnd) {
      issue(diagnostics, 'error', 'invalid-loop', 'The forward loop needs explicit inclusive SFZ endpoints.', {line});
    } else loop = {start: loopStart, end: loopEnd, mode: 'forward'};
  }
  return {sample, group, line, key, root, velocity, cents, gainDb, mode, velocityCurve: tracking === 0 ? 'fixed' : 'convex',
    range: [start, end], implicitLoop: !ops.has('loop_mode'), loop};
}

export function parseSfz(text) {
  if (typeof text !== 'string' || text.length > maxTextLength) {
    throw new SamplerError('invalid-sfz', 'Choose an SFZ text document up to 2 MiB.');
  }
  const diagnostics = [], regions = [];
  let group = 0, defaults = new Map(), current;
  let header;
  const finish = () => {
    if (!current) return;
    regions.push(decodeRegion(current.ops, current.group, current.line, diagnostics));
    current = undefined;
  };
  const tokenize = /<([^<>\s]+)>|([a-z_][a-z_0-9]*)\s*=\s*/giu;
  for (const [index, raw] of text.replace(/^\uFEFF/u, '').split(/\r?\n/u).entries()) {
    const line = index + 1;
    const comment = raw.indexOf('//');
    const source = (comment >= 0 ? raw.slice(0, comment) : raw).trim();
    if (!source) continue;
    if (/(?:^|\s)#(?:include|define)\b/iu.test(source)) {
      issue(diagnostics, 'error', 'unsupported-directive', 'This profile does not load includes or macros.', {line});
      continue;
    }
    const tokens = [...source.matchAll(tokenize)];
    if (!tokens.length || tokens[0].index !== 0) issue(diagnostics, 'error', 'invalid-syntax', 'Expected an SFZ header or opcode.', {line});
    for (const [offset, token] of tokens.entries()) {
      const next = tokens[offset + 1]?.index ?? source.length;
      const value = source.slice(token.index + token[0].length, next).trim();
      if (token[1]) {
        finish();
        header = token[1].toLowerCase();
        if (header === 'group') {
          defaults = new Map();
          group++;
        } else if (header === 'region') {
          current = {ops: new Map(defaults), group: `group-${group}`, line};
        } else {
          issue(diagnostics, 'loss', 'unsupported-header', 'Settings in this header will be omitted.', {header, line});
          defaults = new Map();
        }
        if (value) issue(diagnostics, 'error', 'invalid-syntax', 'Unexpected text after an SFZ header.', {line, value});
        continue;
      }
      const opcode = token[2].toLowerCase();
      if (!value) {
        issue(diagnostics, 'error', 'invalid-syntax', 'An opcode is missing its value.', {opcode, line});
        continue;
      }
      if (opcode === 'default_path') {
        issue(diagnostics, 'error', 'unsupported-path', 'Use paths relative to the SFZ file instead of default_path.', {opcode, line});
        continue;
      }
      if (sequences.has(opcode)) {
        issue(diagnostics, 'error', 'unsupported-sequence', 'This profile does not convert region sequences or random selection.', {opcode, line});
        continue;
      }
      if (!supported.has(opcode)) {
        issue(diagnostics, 'loss', 'unsupported-opcode', 'This opcode will be omitted.', {opcode, line});
        continue;
      }
      const active = header === 'group' ? defaults : current?.ops;
      if (!active) {
        if (!header) issue(diagnostics, 'error', 'missing-header', 'A <group> or <region> must precede its opcodes.', {opcode, line});
        continue;
      }
      if (opcode === 'key') {
        for (const part of ['lokey', 'hikey', 'pitch_keycenter']) active.set(part, {line, value});
      } else active.set(opcode, {line, value});
    }
  }
  finish();
  if (!regions.length) issue(diagnostics, 'error', 'empty-map', 'The SFZ contains no regions.');
  if (regions.length > samplerLimits.regions) issue(diagnostics, 'error', 'budget-exceeded', 'The SFZ exceeds the sampler region limit.');
  return result(diagnostics, {regions});
}

export async function inspectSfzImport(source, text, {signal} = {}) {
  const parsed = parseSfz(text);
  const {diagnostics, regions} = parsed;
  const samples = new Map();
  if (!parsed.ok) return {...parsed, samples};
  for (const path of new Set(regions.map(region => region.sample))) {
    signal?.throwIfAborted();
    try {
      const file = await openRelativeFile(source, path);
      const metadata = await inspectWav(file, {sampleLoops: true});
      samples.set(path, {file, ...metadata});
    } catch (cause) {
      let code = 'filesystem-error';
      if (cause instanceof SamplerError) code = cause.code;
      else if (cause.name === 'NotFoundError') code = 'missing-sample';
      else if (['NotAllowedError', 'SecurityError'].includes(cause.name) || ['EACCES', 'EPERM'].includes(cause.code)) code = 'permission-required';
      issue(diagnostics, 'error', code, `Unable to open the SFZ sample: ${cause.message}`, {path});
    }
  }
  for (const region of regions) {
    const sample = samples.get(region.sample);
    if (!sample) continue;
    const [start, end = sample.frames] = region.range;
    if (start >= end || end > sample.frames) {
      issue(diagnostics, 'error', 'invalid-region', 'The selected frames fall outside the WAV.', {line: region.line, path: region.sample});
    }
    if (sample.sampleLoops && region.implicitLoop) {
      issue(diagnostics, 'error', 'embedded-loop', 'Declare loop_mode and endpoints explicitly for a WAV with embedded loops.', {
        line: region.line, path: region.sample,
      });
    }
    if (region.loop && (region.loop.start < start || region.loop.end > end)) {
      issue(diagnostics, 'error', 'invalid-loop', 'The loop falls outside its region.', {line: region.line, path: region.sample});
    }
  }
  const bytes = [...samples.values()].reduce((total, sample) => total + sample.frames * sample.channels * 2, 0);
  if (bytes > samplerLimits.memoryBytes) issue(diagnostics, 'error', 'budget-exceeded', 'These WAVs exceed the prepared PCM budget.', {bytes});
  return result(diagnostics, {regions, samples});
}

export async function importSfz(root, source, text, {
  id, name, path, expectedRevision = 0, acceptLosses = false, provenance, license, signal, beforePublish,
} = {}) {
  if (!validSamplerId(id)) throw new SamplerError('invalid-instrument', 'Choose a stable identifier for the imported instrument.');
  const parts = samplerPath(path);
  if (parts[0] !== 'Instruments' || parts.length < 2 || parts.slice(1).some(part => /^revisions$/iu.test(part)) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
    throw new SamplerError('invalid-reference', 'Choose an instrument folder and an expected revision.');
  }
  const label = name ?? parts.at(-1);
  if (typeof label !== 'string' || !label.trim() || label.length > 256) {
    throw new SamplerError('invalid-instrument', 'Choose a name for the imported instrument.');
  }
  const plan = await inspectSfzImport(source, text, {signal});
  confirm(plan, acceptLosses);
  const samples = new Map();
  for (const [original, {file}] of plan.samples) {
    signal?.throwIfAborted();
    const index = samples.size + 1;
    const destination = `Samples/Originals/SFZ/${id}-r${expectedRevision + 1}/${index}.wav`;
    samples.set(original, await importOriginal(root, file, destination, {id: `s${index}`, provenance: {format: 'SFZ', path: original, source: provenance}, license}));
  }
  const groups = [...new Set(plan.regions.map(region => region.group))].map(group => ({id: group}));
  const regions = plan.regions.map(({sample, range: [first, last], line, implicitLoop, ...mapping}, index) => {
    const descriptor = samples.get(sample);
    return {...mapping, sample: descriptor.id, id: `r${index + 1}`, frames: [first, last ?? descriptor.frames]};
  });
  signal?.throwIfAborted();
  const instrument=createInstrument({id,name:label,groups,samples:[...samples.values()],regions});
  if(beforePublish)await beforePublish(instrument);
  signal?.throwIfAborted();
  const ref = await publish(root,instrument,{path,expectedRevision});
  return {ref, diagnostics: plan.diagnostics};
}

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function decimal(value) {
  return value.toFixed(10).replace(/\.?0+$/u, '');
}

export function planSfzExport(source, {articulations = {}, variants = {}} = {}) {
  const model = validateInstrument(source);
  const {groups, layers} = model;
  const diagnostics = [], samples = new Map(), lines = ['// WASWAN Sampler Studio SFZ exchange'];
  const write = (opcode, value) => `${opcode}=${value}`;
  const loss = (code, message, regionId, more) => issue(diagnostics, 'loss', code, message, {regionId, ...more});
  const selection = (code, message, regionId, more) => issue(diagnostics, 'error', code, message, {regionId, ...more});
  const rendered = [];
  if (model.articulations.length) loss('selectors', 'Keyswitch and control selection will be replaced by a fixed articulation.');
  if (model.pads?.length) loss('pads', 'MIDI pad notes will be preserved with fixed tuning. Physical pad assignments will be omitted.');
  for (const region of model.regions) {
    if (region.trigger !== 'attack') {
      loss('release-region', 'Release regions will be omitted.', region.id);
      continue;
    }
    const art = model.articulations.find(entry => entry.id === region.articulation);
    if (art) {
      const selected = Object.hasOwn(articulations, art.selectorGroup) && articulations[art.selectorGroup];
      if (!model.articulations.some(entry => entry.id === selected && entry.selectorGroup === art.selectorGroup)) {
        selection('articulation-choice', 'Select one articulation in this group before export.', region.id, {selectorGroup: art.selectorGroup});
        continue;
      }
      loss('articulation', 'The SFZ will use the chosen fixed articulation.', region.id, {selected});
      if (art.id !== selected) continue;
    }
    if (region.variation) {
      const {set, member} = region.variation;
      const selected = Object.hasOwn(variants, set) && variants[set];
      if (!model.variations.find(entry => entry.id === set).order.includes(selected)) {
        selection('variant-choice', 'Select one take from this variation set before export.', region.id, {set});
        continue;
      }
      loss('round-robin', 'The SFZ will use one take from this variation set.', region.id, {set, selected});
      if (member !== selected) continue;
    }
    const layer = layers.find(entry => entry.id === region.layer);
    const velocity = layer?.velocity ?? region.velocity;
    if (layer?.fadeIn || layer?.fadeOut || region.keyFadeIn || region.keyFadeOut) {
      loss('crossfade', 'The SFZ will keep the key and velocity bounds as hard edges.', region.id);
    }
    const group = groups.find(entry => entry.id === region.group);
    if (group.output !== 'main') loss('output-route', 'The SFZ will omit the group destination.', region.id, {output: group.output});
    const sound = [model, group, region].flatMap(scope =>
      ['envelope', 'filterEnvelope', 'auxEnvelope', 'filter', 'lfo'].filter(field => scope[field] != null));
    if ([model, group, region].some(scope => scope.modulation?.length)) sound.push('modulation');
    if (group.choke) sound.push('choke');
    if (group.voiceLimit != null) sound.push('voiceLimit');
    if (group.retrigger === 'cut') sound.push('retrigger');
    if (region.reverse) sound.push('reverse');
    if (sound.length) loss('group-behavior', 'These sound and group settings will be omitted.', region.id, {fields: [...new Set(sound)]});
    if (clamp(model.pan + group.pan + region.pan, -1, 1) !== 0) loss('pan', 'The SFZ will use centered panorama.', region.id);
    const tracking = region.velocityCurve === 'convex' ? 100 : 0;
    if (!['fixed', 'convex'].includes(region.velocityCurve)) loss('velocity-curve', 'The SFZ will use a fixed velocity gain.', region.id);
    const totalGain = model.gainDb + group.gainDb + region.gainDb;
    const totalCents = model.cents + group.cents + region.cents;
    const gain = clamp(totalGain, -144, 6);
    const tune = clamp(Math.round(totalCents), -100, 100);
    if (gain !== totalGain) loss('gain-range', 'Region gain will be limited to the portable SFZ dB range.', region.id, {from: totalGain, to: gain});
    if (tune !== totalCents) loss('tune-range', 'Region tuning will be rounded to cents and limited to one semitone.', region.id, {from: totalCents, to: tune});
    const sample = model.samples.find(entry => entry.id === region.sample);
    const maps = model.pads?.length ? model.pads
      .filter(pad => pad.groups.includes(region.group) && pad.note >= region.key[0] && pad.note <= region.key[1])
      .map(pad => ({key: [pad.note, pad.note], root: pad.note})) : [{key: region.key, root: region.root}];
    if (!maps.length) continue;
    if (!samples.has(sample.id)) samples.set(sample.id, {sample, path: `Samples/${samples.size + 1}.wav`});
    const soundOpcodes = [
      write('sample', samples.get(sample.id).path), write('lovel', velocity[0]), write('hivel', velocity[1]),
      write('tune', tune), write('volume', decimal(gain)), write('amp_veltrack', tracking),
    ];
    if (region.frames[0]) soundOpcodes.push(write('offset', region.frames[0]));
    if (region.frames[1] !== sample.frames) soundOpcodes.push(write('end', region.frames[1] - 1));
    if (region.loop?.mode === 'forward' && !region.loop.crossfade) {
      soundOpcodes.push(write('loop_mode', 'loop_continuous'), write('loop_start', region.loop.start), write('loop_end', region.loop.end - 1));
    } else {
      if (region.loop) loss('loop-mode', 'The SFZ will play without this loop mode or loop crossfade.', region.id);
      soundOpcodes.push(write('loop_mode', region.mode === 'oneShot' ? 'one_shot' : 'no_loop'));
    }
    for (const {key, root} of maps) {
      const keyOpcodes = [write('lokey', key[0]), write('hikey', key[1]), write('pitch_keycenter', root)];
      rendered.push({group: group.id, line: '<region> ' + [...keyOpcodes, ...soundOpcodes].join(' ')});
    }
  }
  if (rendered.length > samplerLimits.regions) selection('budget-exceeded', 'The exported map would exceed the sampler region limit.');
  if (!samples.size) selection('empty-map', 'The selected instrument has no representable attack regions.');
  // Preserve original region order, including distinct runs of the same group.
  let currentGroup;
  for (const {group, line} of rendered) {
    if (group !== currentGroup) lines.push('<group>');
    currentGroup = group;
    lines.push(line);
  }
  return result(diagnostics, {text: lines.join('\n') + '\n', samples: [...samples.values()]});
}

export async function exportSfz(root, ref, destination, {folder, name = 'instrument.sfz', acceptLosses = false, signal, ...choices} = {}) {
  exportName(folder);
  exportName(name);
  if (!/\.sfz$/iu.test(name)) throw new SamplerError('invalid-path', 'The exported instrument needs an .sfz filename.', {path: name});
  const instrument = await load(root, ref);
  const plan = planSfzExport(instrument, choices);
  confirm(plan, acceptLosses);
  const files = [];
  for (const {sample, path} of plan.samples) files.push({path, content: await readSampleFile(root, sample, {signal})});
  files.push({path: 'provenance.json', content: JSON.stringify({source: ref, samples: plan.samples.map(({sample, path}) => ({
    path, source: sample.path, sha256: sample.sha256, license: sample.license, provenance: sample.provenance,
  })), diagnostics: plan.diagnostics}, null, 2) + '\n'});
  files.push({path: name, content: plan.text});
  await writeBundle(destination, folder, files, {signal, async reopen(target) {
    const saved = await openRelativeFile(target, name);
    const text = await saved.text();
    if (text !== plan.text) throw new SamplerError('invalid-export', 'The exported SFZ text changed during publication.');
    const checked = await inspectSfzImport(target, text, {signal});
    if (!checked.ok) throw new SamplerError('invalid-export', 'The exported SFZ could not be reopened.', {diagnostics: checked.diagnostics});
    for (const {sample, path} of plan.samples) await readSampleFile(target, {...sample, path}, {signal});
  }});
  return {folder, name, diagnostics: plan.diagnostics};
}
