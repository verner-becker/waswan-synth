// SPDX-License-Identifier: GPL-3.0-only

import {SamplerError, validSamplerId, validSamplerRef, validateInstrument} from './sampler-instrument.js';

export const samplerPresetFormat = 'waswan-sampler-preset';
const ranges = {gainDb: [-144, 48], pan: [-1, 1], cents: [-9600, 9600]};

export function samplerLabel(name, fallback) {
  if (name === undefined) return fallback;
  if (typeof name !== 'string' || !name.trim() || name.length > 256) {
    throw new SamplerError('invalid-metadata', 'Choose a nonempty name up to 256 characters.', {field: 'name'});
  }
  return name.trim();
}

export function samplerTags(tags = []) {
  if (!Array.isArray(tags) || tags.length > 100 || tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 256)) {
    throw new SamplerError('invalid-metadata', 'Use up to 100 nonempty tags.', {field: 'tags'});
  }
  return [...new Set(tags.map(tag => tag.trim()))];
}

export function createSamplerPreset(options = {}) {
  const {id = globalThis.crypto.randomUUID(), ...settings} = options;
  return validateSamplerPreset({
    format: samplerPresetFormat, version: 1, id,
    revision: 0, name: 'Sampler preset', ...settings,
  });
}

export function validateSamplerPreset(value) {
  if (value?.format !== samplerPresetFormat || value.version !== 1) {
    throw new SamplerError('unsupported-feature', 'This sampler preset version is unavailable.');
  }
  if (!validSamplerId(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      value.name === undefined || !validSamplerRef(value.ref)) {
    throw new SamplerError('invalid-preset', 'A sampler preset requires an ID, name and a pinned instrument revision.', {field: 'ref'});
  }
  const {controls = {}} = value;
  if (!controls || typeof controls !== 'object' || Array.isArray(controls)) {
    throw new SamplerError('invalid-preset', 'Choose a sampler control object.', {field: 'controls'});
  }
  const normalized = {};
  for (const [key, adjustment] of Object.entries(controls)) {
    if (key === 'initialArticulations') {
      if (!adjustment || typeof adjustment !== 'object' || Array.isArray(adjustment) ||
          Object.entries(adjustment).some(([group, id]) => !validSamplerId(group) || !validSamplerId(id))) {
        throw new SamplerError('invalid-preset', 'Map selector groups to articulation IDs.', {field: 'controls.initialArticulations'});
      }
      normalized[key] = {...adjustment};
    } else {
      const range = Object.hasOwn(ranges, key) && ranges[key];
      if (!range || !Number.isFinite(adjustment) || adjustment < range[0] || adjustment > range[1]) {
        throw new SamplerError('invalid-preset', 'Choose a supported sampler control and value.', {field: 'controls.' + key});
      }
      normalized[key] = adjustment;
    }
  }
  const {type, libraryId, instrumentId, revision, path} = value.ref;
  return {...value, name: samplerLabel(value.name), tags: samplerTags(value.tags),
    ref: {type, libraryId, instrumentId, revision, path}, controls: normalized};
}

export function applySamplerPreset(model, document) {
  const instrument = validateInstrument(model);
  const preset = validateSamplerPreset(document);
  if (instrument.id !== preset.ref.instrumentId || instrument.revision !== preset.ref.revision) {
    throw new SamplerError('preset-mismatch', 'The preset applies to its pinned instrument revision.', {ref: preset.ref});
  }
  const {initialArticulations, ...controls} = preset.controls;
  if (!initialArticulations) return validateInstrument({...instrument, ...controls});
  const {initialArticulation, ...defaults} = instrument;
  return validateInstrument({...defaults, ...controls, initialArticulations: {...defaults.initialArticulations, ...initialArticulations}});
}
