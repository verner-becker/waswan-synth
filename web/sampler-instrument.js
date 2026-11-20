// SPDX-License-Identifier: GPL-3.0-only

export const samplerFormat = 'waswan-sampler-instrument';
export const samplerLimits = Object.freeze({
  memoryBytes: 64 * 1024 * 1024,
  regions: 128,
  variations: 16,
  variationMembers: 16,
  articulations: 16,
  voices: 256,
});

export class SamplerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SamplerError';
    this.code = code;
    Object.assign(this, details);
  }
}

export const validSamplerId = value => typeof value === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value);

export function samplerPath(path) {
  if (typeof path !== 'string' || !path || path.length > 4096) {
    throw new SamplerError('invalid-path', 'Choose a path inside the sampler library.', {path});
  }
  const segments = path.split('/');
  for (const name of segments) {
    if (!name || name.length > 255 || /[<>:"\\|?*\u0000-\u001f\u007f]/u.test(name) ||
        /[. ]$/u.test(name) || /^(?:con|aux|prn|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) {
      throw new SamplerError('invalid-path', 'Each component must be a portable file or folder name.', {path});
    }
  }
  return segments;
}

export function validSamplerRef(ref) {
  if (ref?.type !== 'sampler' || !validSamplerId(ref.libraryId) || !validSamplerId(ref.instrumentId) ||
      !Number.isSafeInteger(ref.revision) || ref.revision < 1) return false;
  try {
    const segments = samplerPath(ref.path);
    return segments.length >= 2 && ['Instruments', 'Kits'].includes(segments[0]) &&
      !segments.some(name => name.normalize('NFC').toLowerCase() === 'revisions');
  } catch {
    return false;
  }
}

function check(condition, field, message, code = 'invalid-instrument') {
  if (!condition) throw new SamplerError(code, message, {field});
}

function object(value, field) {
  check(value && typeof value === 'object' && !Array.isArray(value), field, 'Expected an object.');
  return value;
}

function integer(value, min, max, field) {
  check(Number.isSafeInteger(value) && value >= min && value <= max, field, `Expected an integer from ${min} through ${max}.`);
  return value;
}

function number(value, min, max, field) {
  check(Number.isFinite(value) && value >= min && value <= max, field, `Expected a number from ${min} through ${max}.`);
  return value;
}

function text(value, field) {
  check(typeof value === 'string' && value.trim() && value.length <= 256, field, 'Expected a nonempty name up to 256 characters.');
  return value;
}

function option(value, options, field) {
  check(options.includes(value), field, `Supported values are ${options.join(', ')}.`, 'unsupported-feature');
  return value;
}

function interval(value, min, max, field, exclusive = false) {
  check(Array.isArray(value) && value.length === 2, field, 'Expected a two-value interval.');
  const start = integer(value[0], min, max, `${field}.0`);
  const end = integer(value[1], min, max, `${field}.1`);
  check(start + Number(exclusive) <= end, field, 'The interval ends before its first usable value.');
  return [start, end];
}

function items(value, field, normalize) {
  check(Array.isArray(value), field, 'Expected an array.');
  const seen = new Set();
  return value.map((entry, index) => {
    const at = `${field}.${index}`;
    object(entry, at);
    check(validSamplerId(entry.id) && !seen.has(entry.id), `${at}.id`, 'Expected a unique identifier.');
    seen.add(entry.id);
    return normalize(entry, at);
  });
}

function reference(index, id, field) {
  check(index.has(id), field, 'The referenced identifier is missing.');
  return index.get(id);
}

const byId = list => new Map(list.map(entry => [entry.id, entry]));

function fades(entry, range, field) {
  const result = {fadeLaw: option(entry.fadeLaw ?? 'equalPower', ['equalPower', 'linear'], `${field}.fadeLaw`)};
  for (const key of ['fadeIn', 'fadeOut']) {
    if (entry[key] !== undefined) result[key] = interval(entry[key], ...range, `${field}.${key}`, true);
  }
  return result;
}

function tone(entry, field) {
  return {
    gainDb: number(entry.gainDb ?? 0, -144, 48, `${field}.gainDb`),
    pan: number(entry.pan ?? 0, -1, 1, `${field}.pan`),
    cents: number(entry.cents ?? 0, -9600, 9600, `${field}.cents`),
  };
}

function requireSupported(entry, fields, path) {
  for (const field of fields) {
    if (entry[field] != null && (!Array.isArray(entry[field]) || entry[field].length)) {
      throw new SamplerError('unsupported-feature', `${field} requires a later sampler version.`, {field: `${path}.${field}`});
    }
  }
}

export function createInstrument(options = {}) {
  return validateInstrument({
    format: samplerFormat,
    version: 1,
    revision: 0,
    kind: 'instrument',
    id: options.id ?? globalThis.crypto.randomUUID(),
    name: 'Untitled instrument',
    groups: [{id: 'main', output: 'main'}],
    outputs: [{id: 'main', channels: 2}],
    ...options,
  });
}

export function validateInstrument(model) {
  object(model, 'instrument');
  check(model.format === samplerFormat && model.version === 1, 'format', 'This sampler instrument version is unavailable.', 'unsupported-feature');
  requireSupported(model, ['requires', 'modulation', 'pads'], 'instrument');
  check(validSamplerId(model.id), 'id', 'Expected an instrument identifier.');
  integer(model.revision, 0, Number.MAX_SAFE_INTEGER, 'revision');
  text(model.name, 'name');
  const kind = option(model.kind, ['instrument', 'kit'], 'kind');
  const tags = model.tags ?? [];
  check(Array.isArray(tags), 'tags', 'Expected an array of tags.');
  tags.forEach((tag, i) => text(tag, `tags.${i}`));
  const outputs = items(model.outputs, 'outputs', (out, at) => {
    option(out.channels, [2], `${at}.channels`);
    return {...out};
  });
  check(outputs.length > 0 && outputs[0].id === 'main', 'outputs.0.id', 'The first output must be main.');
  const outputIndex = byId(outputs);
  const groups = items(model.groups ?? [], 'groups', (group, at) => {
    requireSupported(group, ['envelope', 'filter', 'voiceLimit', 'choke', 'modulation', 'retrigger'], at);
    const output = group.output ?? 'main';
    reference(outputIndex, output, `${at}.output`);
    return {...group, output, ...tone(group, at)};
  });
  const groupIndex = byId(groups);
  const samples = items(model.samples ?? [], 'samples', (sample, at) => {
    samplerPath(sample.path);
    check(/\.wav$/iu.test(sample.path), `${at}.path`, 'Expected a library-relative WAV path.');
    check(typeof sample.sha256 === 'string' && /^[0-9a-f]{64}$/.test(sample.sha256), `${at}.sha256`, 'Expected a lowercase SHA-256 digest.');
    option(sample.sampleRate, [44100], `${at}.sampleRate`);
    option(sample.channels, [1, 2], `${at}.channels`);
    integer(sample.frames, 1, 0x7fffffff, `${at}.frames`);
    if (sample.size !== undefined) integer(sample.size, 44 + sample.frames * sample.channels * 2, 0xffffffff + 8, `${at}.size`);
    return {...sample};
  });
  const sampleIndex = byId(samples);
  const layers = items(model.layers ?? [], 'layers', (layer, at) => {
    const velocity = interval(layer.velocity, 1, 127, `${at}.velocity`);
    return {...layer, velocity, ...fades(layer, velocity, at)};
  });
  const layerIndex = byId(layers);
  const variations = items(model.variations ?? [], 'variations', (variation, at) => {
    const mode = option(variation.mode, ['sequential', 'random'], `${at}.mode`);
    const seed = integer(variation.seed ?? 0, 0, 0xffffffff, `${at}.seed`);
    const avoidRepeat = variation.avoidRepeat ?? false;
    check(typeof avoidRepeat === 'boolean', `${at}.avoidRepeat`, 'Expected a boolean.');
    const {order} = variation;
    check(Array.isArray(order) && order.length && order.every(validSamplerId) && new Set(order).size === order.length,
      `${at}.order`, 'Expected a nonempty ordered list of unique variant identifiers.');
    return {...variation, mode, seed, avoidRepeat, order: [...order]};
  });
  const variationIndex = byId(variations);
  const keyswitches = new Set();
  const articulations = items(model.articulations ?? [], 'articulations', (articulation, at) => {
    const selectorGroup = articulation.selectorGroup ?? 'default';
    check(validSamplerId(selectorGroup), `${at}.selectorGroup`, 'Expected an articulation group identifier.');
    const mode = option(articulation.mode ?? 'persistent', ['persistent'], `${at}.mode`);
    object(articulation.select, `${at}.select`);
    requireSupported(articulation.select, ['cc'], `${at}.select`);
    const keyswitch = integer(articulation.select.keyswitch, 0, 127, `${at}.select.keyswitch`);
    check(!keyswitches.has(keyswitch), `${at}.select.keyswitch`, 'A keyswitch can select only one articulation.');
    keyswitches.add(keyswitch);
    return {...articulation, selectorGroup, mode, select: {keyswitch}};
  });
  const artIndex = byId(articulations);
  const initialArticulations = {...object(model.initialArticulations ?? {}, 'initialArticulations')};
  if (model.initialArticulation !== undefined) {
    const art = reference(artIndex, model.initialArticulation, 'initialArticulation');
    check(!Object.hasOwn(initialArticulations, art.selectorGroup) || initialArticulations[art.selectorGroup] === art.id,
      'initialArticulation', 'The initial articulation conflicts with the selection for its group.');
    Object.defineProperty(initialArticulations, art.selectorGroup, {value: art.id, enumerable: true});
  }
  for (const [group, id] of Object.entries(initialArticulations)) {
    check(reference(artIndex, id, `initialArticulations.${group}`).selectorGroup === group,
      `initialArticulations.${group}`, 'The articulation has a different selection group.');
  }
  const regions = items(model.regions ?? [], 'regions', (region, at) => {
    const sample = reference(sampleIndex, region.sample, `${at}.sample`);
    reference(groupIndex, region.group, `${at}.group`);
    const key = interval(region.key ?? [0, 127], 0, 127, `${at}.key`);
    const root = integer(region.root, 0, 127, `${at}.root`);
    const trigger = option(region.trigger ?? 'attack', ['attack', 'release'], `${at}.trigger`);
    const mode = option(region.mode === 'one-shot' ? 'oneShot' : region.mode ?? 'gate',
      ['gate', 'oneShot'], `${at}.mode`);
    const frames = interval(region.frames ?? [0, sample.frames], 0, sample.frames, `${at}.frames`, true);
    const velocityCurve = option(region.velocityCurve ?? 'fixed', ['fixed', 'linear', 'concave', 'convex'], `${at}.velocityCurve`);
    const velocity = region.layer === undefined ? interval(region.velocity ?? [1, 127], 1, 127, `${at}.velocity`) : undefined;
    if (region.layer !== undefined) {
      check(region.velocity === undefined, `${at}.velocity`, 'Choose a named velocity layer or a region velocity range.');
      reference(layerIndex, region.layer, `${at}.layer`);
    }
    if (region.articulation !== undefined) reference(artIndex, region.articulation, `${at}.articulation`);
    if (region.variation !== undefined) {
      object(region.variation, `${at}.variation`);
      const set = reference(variationIndex, region.variation.set, `${at}.variation.set`);
      check(set.order.includes(region.variation.member), `${at}.variation.member`, 'The variant is missing from the set order.');
    }
    requireSupported(region, ['reverse', 'envelope', 'modulation'], at);
    const normalized = {...region, key, root, trigger, mode, frames, velocityCurve, ...tone(region, at)};
    if (velocity) normalized.velocity = velocity;
    if (region.keyFadeIn !== undefined) normalized.keyFadeIn = interval(region.keyFadeIn, ...key, `${at}.keyFadeIn`, true);
    if (region.keyFadeOut !== undefined) normalized.keyFadeOut = interval(region.keyFadeOut, ...key, `${at}.keyFadeOut`, true);
    normalized.keyFadeLaw = option(region.keyFadeLaw ?? 'equalPower', ['equalPower', 'linear'], `${at}.keyFadeLaw`);
    if (region.loop != null) {
      object(region.loop, `${at}.loop`);
      requireSupported(region.loop, ['crossfade'], `${at}.loop`);
      option(region.loop.mode ?? 'forward', ['forward'], `${at}.loop.mode`);
      const [start, end] = interval([region.loop.start, region.loop.end], ...frames, `${at}.loop`, true);
      check(mode === 'gate' && trigger === 'attack', `${at}.loop`, 'A forward loop requires an attack region in gate mode.');
      normalized.loop = {start, end, mode: 'forward'};
    }
    return normalized;
  });
  return {...model, kind, tags: [...tags], outputs, groups, samples, layers, variations, articulations, initialArticulations, regions, ...tone(model, 'instrument')};
}

export function applyEdits(draft, edits) {
  const result = structuredClone(draft);
  check(Array.isArray(edits), 'edits', 'Expected an array of edits.');
  for (const [index, edit] of edits.entries()) {
    const field = `edits.${index}`;
    object(edit, field);
    const {op, collection, id, value} = edit;
    check(['samples', 'regions', 'groups', 'articulations', 'layers', 'variations', 'outputs'].includes(collection),
      `${field}.collection`, 'Choose a sampler entity collection.');
    check(['add', 'replace', 'remove'].includes(op), `${field}.op`, 'Choose add, replace or remove.');
    const key = id ?? value?.id;
    check(validSamplerId(key), `${field}.id`, 'Expected an entity identifier.');
    const entries = result[collection] ??= [];
    const position = entries.findIndex(entry => entry.id === key);
    check(op === 'add' ? position < 0 : position >= 0, `${field}.id`, 'The identifier is incompatible with this edit.');
    if (op === 'remove') {
      entries.splice(position, 1);
    } else {
      check(value?.id === key, `${field}.value.id`, 'The edit cannot change an identifier.');
      if (op === 'add') entries.push(structuredClone(value));
      else entries[position] = structuredClone(value);
    }
  }
  return validateInstrument(result);
}

export function compile(model, capabilities = {}, requestedLimits = {}) {
  const instrument = validateInstrument(model);
  const limits = {...samplerLimits, ...requestedLimits};
  for (const key of Object.keys(samplerLimits)) integer(limits[key], 0, Number.MAX_SAFE_INTEGER, `limits.${key}`);
  const groups = byId(instrument.groups);
  const layers = byId(instrument.layers);
  const articulations = byId(instrument.articulations);
  const variations = byId(instrument.variations);
  const notes = {attack: Array.from({length: 128}, () => []), release: Array.from({length: 128}, () => [])};
  const used = new Set();
  const destinations = capabilities.outputs ?? ['main'];
  check(instrument.regions.length <= limits.regions, 'regions', 'The instrument exceeds the region limit.', 'budget-exceeded');
  check(instrument.articulations.length <= limits.articulations, 'articulations', 'The instrument exceeds the articulation limit.', 'budget-exceeded');
  check(instrument.variations.length <= limits.variations, 'variations', 'The instrument exceeds the variation set limit.', 'budget-exceeded');
  for (const variation of instrument.variations) {
    check(variation.order.length <= limits.variationMembers, `variations.${variation.id}.order`, 'The set exceeds the variant limit.', 'budget-exceeded');
  }
  for (const region of instrument.regions) {
    const group = groups.get(region.group);
    const layer = layers.get(region.layer);
    check(destinations.includes(group.output), `groups.${group.id}.output`, 'The host has no matching output.', 'unsupported-feature');
    const resolved = {
      ...region,
      velocity: layer?.velocity ?? region.velocity,
      fadeIn: layer?.fadeIn,
      fadeOut: layer?.fadeOut,
      fadeLaw: layer?.fadeLaw,
      output: group.output,
      gainDb: instrument.gainDb + group.gainDb + region.gainDb,
      cents: instrument.cents + group.cents + region.cents,
      pan: Math.max(-1, Math.min(1, instrument.pan + group.pan + region.pan)),
    };
    used.add(region.sample);
    for (let key = region.key[0]; key <= region.key[1]; key++) notes[region.trigger][key].push(resolved);
  }
  const dependencies = instrument.samples.filter(sample => used.has(sample.id));
  const hashes = new Map();
  for (const sample of dependencies) {
    const duplicate = hashes.get(sample.sha256);
    check(!duplicate || ['frames', 'channels', 'sampleRate'].every(key => duplicate[key] === sample[key]),
      `samples.${sample.id}`, 'Samples sharing a digest must have the same PCM layout.');
    hashes.set(sample.sha256, sample);
  }
  const memoryBytes = Array.from(hashes.values(), sample => sample.frames * sample.channels * 2)
    .reduce((total, bytes) => total + bytes, 0);
  if (memoryBytes > limits.memoryBytes) {
    throw new SamplerError('budget-exceeded', 'The instrument exceeds the PCM memory budget.', {memoryBytes, limit: limits.memoryBytes});
  }
  return {
    instrument, notes, dependencies, memoryBytes, maxVoices: limits.voices,
    keyswitches: new Map(instrument.articulations.map(art => [art.select.keyswitch, art])),
    articulations, variations,
  };
}

export function createSelectionState() {
  return {channels: {}};
}

export function fade(value, range, incoming, law) {
  if (!range) return 1;
  const t = Math.max(0, Math.min(1, (value - range[0]) / (range[1] - range[0])));
  if (t === 0 || t === 1 || law === 'linear') return incoming ? t : 1 - t;
  const angle = t * Math.PI / 2;
  return incoming ? Math.sin(angle) : Math.cos(angle);
}

export function velocityGain(velocity, curve) {
  const value = velocity / 127;
  if (curve === 'linear') return value;
  if (curve === 'concave') return Math.sqrt(value);
  if (curve === 'convex') return value * value;
  return 1;
}

function variationMember(set, eligible, previous = {}) {
  const {order} = set;
  if (set.mode === 'sequential') {
    let next = previous.next ?? 0;
    while (!eligible.has(order[next])) next = (next + 1) % order.length;
    return {member: order[next], next: (next + 1) % order.length};
  }
  let random = previous.random ?? (set.seed || 0x6d2b79f5);
  random ^= random << 13;
  random ^= random >>> 17;
  random ^= random << 5;
  random >>>= 0;
  const usable = order.filter(member => eligible.has(member) &&
    !(set.avoidRepeat && eligible.size > 1 && member === previous.member));
  return {member: usable[random % usable.length], random};
}

function choose(plan, trigger, note, velocity, articulations, groups, state) {
  const candidates = [];
  const eligible = new Map();
  for (const region of plan.notes[trigger][note]) {
    if (groups && !groups.includes(region.group)) continue;
    if (velocity < region.velocity[0] || velocity > region.velocity[1]) continue;
    const art = plan.articulations.get(region.articulation);
    if (art && articulations[art.selectorGroup] !== art.id) continue;
    const weight = fade(note, region.keyFadeIn, true, region.keyFadeLaw) *
      fade(note, region.keyFadeOut, false, region.keyFadeLaw) *
      fade(velocity, region.fadeIn, true, region.fadeLaw) *
      fade(velocity, region.fadeOut, false, region.fadeLaw);
    if (weight <= 0) continue;
    candidates.push({region, weight});
    if (region.variation) {
      const {set, member} = region.variation;
      if (!eligible.has(set)) eligible.set(set, new Set());
      eligible.get(set).add(member);
    }
  }
  for (const [id, members] of eligible) {
    const previous = Object.hasOwn(state.variations, id) ? state.variations[id] : undefined;
    Object.defineProperty(state.variations, id, {
      value: variationMember(plan.variations.get(id), members, previous), enumerable: true, configurable: true, writable: true,
    });
  }
  return candidates
    .filter(({region}) => !region.variation || state.variations[region.variation.set].member === region.variation.member)
    .map(({region, weight}) => ({
      regionId: region.id,
      sampleId: region.sample,
      groupId: region.group,
      output: region.output,
      trigger,
      weight,
      gain: weight * velocityGain(velocity, region.velocityCurve) * 10 ** (region.gainDb / 20),
      pan: region.pan,
      cents: (note - region.root) * 100 + region.cents,
    }));
}

export function explainNote(plan, event, previous = createSelectionState()) {
  object(event, 'event');
  const {type} = event;
  check(['noteOn', 'noteOff', 'sustain', 'panic'].includes(type), 'event.type', 'Expected a supported note or pedal gesture.');
  if (type === 'panic') return {state: createSelectionState(), voices: [], releases: [], consumed: true};
  const channel = integer(event.channel ?? 0, 0, 15, 'event.channel');
  const state = structuredClone(previous);
  const here = state.channels[channel] ??= {
    articulations: {...plan.instrument.initialArticulations}, variations: {}, notes: [], sustain: false,
  };
  const requested = [];
  const releases = [];
  let consumed = false;
  const release = held => {
    if (held.gate) releases.push({id: held.id, note: held.note, channel});
    requested.push(...choose(plan, 'release', held.note, held.velocity, held.articulations, held.groups, here));
  };
  if (type === 'sustain') {
    here.sustain = typeof event.value === 'boolean' ? event.value : integer(event.value, 0, 127, 'event.value') >= 64;
    if (!here.sustain) {
      here.notes = here.notes.filter(held => {
        if (held.off) release(held);
        return !held.off;
      });
    }
  } else {
    const note = integer(event.note, 0, 127, 'event.note');
    const velocity = type === 'noteOn' ? integer(event.velocity, 0, 127, 'event.velocity') : 0;
    const art = plan.keyswitches.get(note);
    if (art) {
      if (velocity > 0) Object.defineProperty(here.articulations, art.selectorGroup,
        {value: art.id, enumerable: true, configurable: true, writable: true});
      consumed = true;
    } else if (velocity > 0) {
      const previousIndex = here.notes.findIndex(held =>
        event.id === undefined ? held.note === note && held.id === undefined : held.id === event.id);
      if (previousIndex >= 0) {
        const [held] = here.notes.splice(previousIndex, 1);
        if (held.gate) releases.push({id: held.id, note: held.note, channel});
      }
      const voices = choose(plan, 'attack', note, velocity, here.articulations, null, here).slice(0, plan.maxVoices);
      if (voices.length) {
        const selected = new Set(voices.map(voice => voice.regionId));
        const gate = plan.notes.attack[note].some(region => selected.has(region.id) && region.mode === 'gate');
        here.notes.push({id: event.id, note, velocity, gate, groups: [...new Set(voices.map(voice => voice.groupId))],
          articulations: {...here.articulations}, off: false});
        requested.push(...voices);
      }
    } else {
      const index = here.notes.findIndex(held => !held.off && held.note === note && held.id === event.id);
      if (index >= 0) {
        const held = here.notes[index];
        if (here.sustain && held.gate) held.off = true;
        else {
          here.notes.splice(index, 1);
          release(held);
        }
      }
    }
  }
  return {state, voices: requested.slice(0, plan.maxVoices), releases, consumed};
}
