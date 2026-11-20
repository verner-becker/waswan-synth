// SPDX-License-Identifier: GPL-3.0-only

import {preparePair} from './mellotron-library.js';
import {maxRegions, pairFrames} from './mellotron-settings.js';
import {SamplerError, compile, fade, validateInstrument, velocityGain} from './sampler-instrument.js';
import {load, readSampleFile} from './sampler-library.js';
import {decodeWav} from './sampler-wav.js';
import {editSample, levels} from './sampler-edit.js';
import {encodeSample} from './sampler-offline.js';
import {assertAvailable, exportName, writeBundle} from './sampler-export-files.js';

const tapeRate = 44100;
const maxSeconds = 8;
const minFrames = 4;

function diagnostic(diagnostics, severity, code, message, details = {}) {
  diagnostics.push({severity, code, message, ...details});
}

function result(diagnostics, data) {
  return {...data, ok: !diagnostics.some(entry => entry.severity === 'error'), diagnostics};
}

function confirm(plan, acceptLosses) {
  if (!plan.ok || (!acceptLosses && plan.diagnostics.some(entry => entry.severity === 'loss'))) {
    throw new SamplerError('tape-plan-required', 'Review the Mellotron export report before writing files.', {diagnostics: plan.diagnostics});
  }
}

function validInteger(value, min, max, field) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new SamplerError('invalid-mapping', `Expected ${field} from ${min} through ${max}.`, {field});
  }
  return value;
}

function weightAt(region, root, velocity) {
  if (velocity < region.velocity[0] || velocity > region.velocity[1]) return 0;
  return fade(root, region.keyFadeIn, true, region.keyFadeLaw) * fade(root, region.keyFadeOut, false, region.keyFadeLaw) *
    fade(velocity, region.fadeIn, true, region.fadeLaw) * fade(velocity, region.fadeOut, false, region.fadeLaw);
}

export function planTapeBank(instrument, {
  roots, velocity, articulations = {}, variants = {}, regions = {}, seconds = maxSeconds, otherFrames = 0, otherRegions = 0,
} = {}) {
  const validated = validateInstrument(instrument);
  const plan = compile(validated, {outputs: validated.outputs.map(out => out.id)});
  if (!Number.isFinite(seconds) || seconds < minFrames / tapeRate || seconds > maxSeconds) {
    throw new SamplerError('invalid-mapping', 'Choose a tape length up to eight seconds.', {field: 'seconds'});
  }
  validInteger(otherFrames, 0, pairFrames, 'partner frames');
  validInteger(otherRegions, 0, maxRegions, 'partner regions');
  const diagnostics = [], entries = [];
  const err = (code, message, details) => diagnostic(diagnostics, 'error', code, message, details);
  const loss = (code, message, details) => diagnostic(diagnostics, 'loss', code, message, details);
  const model = plan.instrument;
  const attacks = model.regions.filter(region => region.trigger === 'attack');
  if (roots === undefined) {
    const defaults = model.pads?.length ? model.pads.map(pad => pad.note) : attacks.map(region => region.root);
    roots = [...new Set(defaults)].sort((a, b) => a - b);
  }
  if (!Array.isArray(roots)) throw new SamplerError('invalid-mapping', 'Provide an array of MIDI roots.');
  const selectedRoots = new Set();
  for (const root of roots) {
    validInteger(root, 0, 127, 'MIDI root');
    if (selectedRoots.has(root)) err('duplicate-root', 'A tape bank can contain only one WAV per root.', {root});
    selectedRoots.add(root);
  }
  if (!selectedRoots.size) err('empty-bank', 'The instrument has no selected tape roots.');
  if (selectedRoots.size + otherRegions > maxRegions) {
    err('region-budget', 'Both tape banks must fit within 48 regions.', {regions: selectedRoots.size + otherRegions, limit: maxRegions});
  }
  if (velocity === undefined) {
    if (model.layers.length || attacks.some(region => region.velocity?.[0] !== 1 || region.velocity?.[1] !== 127 || region.velocityCurve !== 'fixed')) {
      err('velocity-choice', 'Choose a velocity for the tape conversion.');
    }
    velocity = 127;
  }
  validInteger(velocity, 1, 127, 'MIDI velocity');
  if (model.articulations.length) loss('articulations', 'The exported tape uses fixed articulation and has no keyswitches.');
  if (model.variations.length) loss('variations', 'The exported tape uses one take per root.');
  if (model.layers.length || attacks.some(region => region.velocity[0] !== 1 || region.velocity[1] !== 127 || region.velocityCurve !== 'fixed')) {
    loss('velocity-layers', 'The selected velocity gain is baked into each WAV.', {velocity});
  }
  if (selectedRoots.size > 1 || attacks.some(region => region.key[0] !== 0 || region.key[1] !== 127 || region.keyFadeIn || region.keyFadeOut)) {
    loss('key-map', 'The Mellotron chooses the closest root throughout the MIDI range. Key zones and fades are discarded.');
  }
  if (model.regions.some(region => region.trigger !== 'attack')) loss('release-regions', 'The exported tape has no separate release samples.');
  if (model.modulation?.length || model.pads?.length) loss('performance-mapping', 'Modulation and physical pad behavior are discarded.');
  for (const root of [...selectedRoots].sort((a, b) => a - b)) {
    const candidates = plan.notes.attack[root].filter(region => weightAt(region, root, velocity) > 0);
    const artChoiceMissing = candidates.some(region => {
      const art = plan.articulations.get(region.articulation);
      if (!art) return false;
      const selected = Object.hasOwn(articulations, art.selectorGroup) && plan.articulations.get(articulations[art.selectorGroup]);
      if (selected?.selectorGroup === art.selectorGroup) return false;
      err('articulation-choice', 'Choose an articulation for this selector group.', {root, selectorGroup: art.selectorGroup});
      return true;
    });
    if (artChoiceMissing) continue;
    const articulated = candidates.filter(region => {
      const art = plan.articulations.get(region.articulation);
      return !art || articulations[art.selectorGroup] === art.id;
    });
    const exact = Object.hasOwn(regions, root) ? regions[root] : undefined;
    const matching = articulated.filter(region => {
      if (exact !== undefined && region.id !== exact) return false;
      if (!region.variation) return true;
      const {set, member} = region.variation;
      if (Object.hasOwn(variants, set)) return variants[set] === member;
      return exact === region.id;
    });
    if (exact === undefined && articulated.some(region => region.variation && !Object.hasOwn(variants, region.variation.set))) {
      err('variation-choice', 'Choose a take in each eligible variation set or select a region for this root.', {root});
      continue;
    }
    if (matching.length !== 1) {
      err(matching.length ? 'ambiguous-root' : 'missing-root',
        matching.length ? 'Choose one region for this root.' : 'No region matches the root and selected performance.', {
          root, candidates: articulated.map(region => region.id),
        });
      continue;
    }
    const [region] = matching;
    if (plan.keyswitches.has(root)) {
      err('keyswitch-root', 'Choose a playable MIDI root outside the keyswitches.', {root});
      continue;
    }
    const sample = plan.dependencies.find(entry => entry.id === region.sample);
    const cents = (region.fixedPitch ? 0 : (root - region.root) * 100) + region.cents;
    const conversionRate = Math.round(tapeRate / (2 ** (cents / 1200)));
    if (conversionRate < 8000 || conversionRate > 192000) {
      err('transposition-range', 'Choose a root closer to the source pitch for the offline converter.', {root, cents});
      continue;
    }
    const sourceFrames = region.frames[1] - region.frames[0];
    const naturalFrames = Math.max(1, Math.round(sourceFrames * conversionRate / tapeRate));
    const frames = Math.min(naturalFrames, Math.floor(seconds * tapeRate));
    if (frames < minFrames) {
      err('sample-too-short', 'The resulting tape must contain at least four frames.', {root, frames});
      continue;
    }
    const group = model.groups.find(entry => entry.id === region.group);
    if (region.output !== 'main') loss('output-route', 'The Mellotron uses its tape mix output.', {root, output: region.output});
    const fields = ['envelope', 'filterEnvelope', 'auxEnvelope', 'filter', 'lfo', 'loop', 'reverse'].filter(field => region[field]);
    if (region.modulation?.length) fields.push('modulation');
    if (group.choke) fields.push('choke');
    if (group.voiceLimit != null) fields.push('voiceLimit');
    if (group.retrigger === 'cut') fields.push('retrigger');
    if (region.mode === 'oneShot') fields.push('oneShot');
    if (fields.length) {
      loss('playback-behavior', 'The Mellotron uses its tape playback settings for this root.', {root, regionId: region.id, fields});
    }
    if (sample.channels === 2) loss('downmix', 'Stereo is reduced to the average of the left and right channels after pan.', {root});
    if (region.pan) loss('pan', 'Pan balance is baked into the mono average.', {root, pan: region.pan});
    if (frames < naturalFrames) loss('truncated', 'The end of this tape will be cropped.', {root, fromFrames: naturalFrames, toFrames: frames});
    const gain = weightAt(region, root, velocity) * velocityGain(velocity, region.velocityCurve) * 10 ** (region.gainDb / 20);
    entries.push({
      root, fileName: root + '.wav', regionId: region.id, sample, source: region.frames, frames, conversionRate, cents, gain, pan: region.pan,
    });
  }
  const frames = entries.reduce((total, item) => total + item.frames, otherFrames);
  if (frames > pairFrames) err('pcm-budget', 'Both tape banks must fit within 16 MiB of PCM.', {frames, limit: pairFrames});
  return result(diagnostics, {entries, frames, otherFrames, velocity, seconds, regions: selectedRoots.size + otherRegions});
}

async function renderRegion(root, entry, signal) {
  const file = await readSampleFile(root, entry.sample, {signal, maxFileBytes: 80 * 1024 * 1024});
  const {pcm, channels, sampleRate} = await decodeWav(file);
  signal?.throwIfAborted();
  const [start, end] = entry.source;
  const ratio = entry.conversionRate / tapeRate;
  // Retain enough source past a cut for the symmetric resampling kernel.
  const last = Math.min(end, start + Math.ceil(entry.frames / ratio) + Math.ceil(32 / Math.min(1, ratio)));
  const left = Math.min(1, 1 - entry.pan);
  const right = Math.min(1, 1 + entry.pan);
  const monoPan = (left + right) / 2;
  const input = new Float32Array((last - start) * channels);
  for (let i = 0; i < input.length; i++) {
    const balance = channels === 1 ? monoPan : i % 2 ? right : left;
    input[i] = pcm[start * channels + i] / 32768 * balance * entry.gain;
  }
  const recipe = [{type: 'channels', channels: 1}, {type: 'rate', sampleRate: entry.conversionRate}];
  const {audio} = editSample({channels, sampleRate, pcm: input}, recipe);
  if (audio.pcm.length < entry.frames) throw new SamplerError('invalid-export', 'The conversion produced fewer frames than planned.', {root: entry.root});
  const output = {pcm: audio.pcm.subarray(0, entry.frames), sampleRate: tapeRate, channels: 1};
  return {wav: encodeSample(output), levels: levels(output.pcm)};
}

export async function renderTapeBank(root, ref, mapping, {signal} = {}) {
  const plan = planTapeBank(await load(root, ref), mapping);
  const files = [];
  if (!plan.ok) return {...plan, files};
  for (const entry of plan.entries) {
    signal?.throwIfAborted();
    const rendered = await renderRegion(root, entry, signal);
    if (rendered.levels.clipped) {
      diagnostic(plan.diagnostics, 'loss', 'clipping', 'The rendered tape reaches PCM full scale.', {
        root: entry.root, peak: rendered.levels.peak, frames: rendered.levels.clipped,
      });
    }
    files.push({path: entry.fileName, content: rendered.wav, levels: rendered.levels});
  }
  return {...plan, files};
}

export async function exportTapeBank(root, ref, mapping, destination, {name, partner, acceptLosses = false, signal} = {}) {
  exportName(name);
  await assertAvailable(destination, name);
  let partnerFrames = 0, partnerRegions = 0;
  if (partner !== undefined) {
    exportName(partner);
    try {
      const existing = await preparePair(destination, [partner, partner]);
      partnerFrames = existing.regions.reduce((frames, region) => frames + region.pcm.length, 0);
      partnerRegions = existing.regions.length;
    } catch (cause) {
      if (['NotAllowedError', 'SecurityError'].includes(cause.name)) {
        throw new SamplerError('permission-required', 'Grant access to the existing Mellotron bank.', {path: partner, cause});
      }
      throw new SamplerError('invalid-partner', 'The selected Mellotron partner bank could not be opened.', {path: partner, cause});
    }
  }
  const plan = await renderTapeBank(root, ref, {...mapping, otherFrames: partnerFrames, otherRegions: partnerRegions}, {signal});
  confirm(plan, acceptLosses);
  const metadata = {
    source: ref, partner, velocity: plan.velocity,
    samples: plan.entries.map(({fileName, sample, root, regionId, frames, cents, gain}) => ({
      fileName, root, regionId, frames, cents, gain, sourcePath: sample.path, sha256: sample.sha256,
      provenance: sample.provenance, license: sample.license,
    })),
    diagnostics: plan.diagnostics,
  };
  const files = [...plan.files, {path: 'waswan-tape.json', content: JSON.stringify(metadata, null, 2) + '\n'}];
  const checked = await writeBundle(destination, name, files, {signal, async reopen() {
    const loaded = await preparePair(destination, [name, partner ?? name]);
    const bank = loaded.regions.filter(region => region.bank === 0);
    if (bank.length !== plan.entries.length || bank.some((region, index) =>
      region.root !== plan.entries[index].root || region.pcm.length !== plan.entries[index].frames)) {
      throw new SamplerError('invalid-export', 'The exported bank differs from the Mellotron conversion plan.');
    }
    for (const [index, region] of bank.entries()) {
      const {pcm} = await decodeWav(plan.files[index].content);
      if (!region.pcm.every((value, frame) => value === pcm[frame])) {
        throw new SamplerError('invalid-export', 'The exported tape PCM changed during publication.', {root: region.root});
      }
    }
    return {id: loaded.id, frames: loaded.regions.reduce((total, region) => total + region.pcm.length, 0), regions: loaded.regions.length};
  }});
  return {name, partner, ...checked, diagnostics: plan.diagnostics};
}
