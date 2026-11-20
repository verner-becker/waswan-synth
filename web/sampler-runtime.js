// SPDX-License-Identifier: GPL-3.0-only
import {compile, fade, velocityGain, samplerLimits, validSamplerId, SamplerError, modulationSources, modulationDestinations} from './sampler-instrument.js';

const pageBytes = 65536;
const maxBanks = 16;
function refKey(ref) {
  if (!validSamplerId(ref?.libraryId) || !validSamplerId(ref.instrumentId) ||
      !Number.isSafeInteger(ref.revision) || ref.revision < 1) throw Error('Invalid sampler revision');
  return JSON.stringify([ref.libraryId, ref.instrumentId, ref.revision]);
}
function budget(message) {
  return new SamplerError('budget-exceeded', 'Sampler budget exceeded. '+message);
}

// Recycle contiguous spans in WASM linear memory. The Mellotron owns its pages independently.
class PcmArena {
  constructor(x) {
    this.x = x;
    this.free = [];
    this.pages = 0;
  }
  release(base, bytes) {
    this.free.push({base, bytes});
    this.free.sort((a, b) => a.base - b.base);
    for (let i = this.free.length - 1; i > 0; i--) {
      const a = this.free[i - 1], b = this.free[i];
      if (a.base + a.bytes === b.base) {
        a.bytes += b.bytes;
        this.free.splice(i, 1);
      }
    }
  }
  allocate(bytes) {
    let span = this.free.find(entry => entry.bytes >= bytes);
    if (!span) {
      const pages = Math.ceil(bytes / pageBytes);
      if ((this.pages + pages) * pageBytes > samplerLimits.memoryBytes) return 0;
      const base = this.x.waswan_sampler_pages(pages);
      if (!base) return 0;
      this.pages += pages;
      this.release(base, pages * pageBytes);
      span = this.free.find(entry => entry.bytes >= bytes);
    }
    const base = span.base;
    span.base += bytes;
    span.bytes -= bytes;
    if (!span.bytes) this.free.splice(this.free.indexOf(span), 1);
    return base;
  }
}

// Compute per-key and per-velocity tables before posting to the audio thread.
export function packSampler(model) {
  const plan = compile(model), instrument = plan.instrument;
  const groupIds = [...new Set(instrument.regions.map(region => region.group))];
  const arts = instrument.articulations, variations = instrument.variations;
  const artBit = id => id === undefined ? 0 : 1 << arts.findIndex(art => art.id === id);
  const initial = Object.values(instrument.initialArticulations).reduce((mask, id) => mask | artBit(id), 0);
  const artClear = art => arts.reduce((mask, a) => a.selectorGroup === art.selectorGroup ? mask | artBit(a.id) : mask, 0);
  const switches = arts.filter(art=>art.select.keyswitch!==undefined).map(art=>[art.select.keyswitch,artClear(art),artBit(art.id)]);
  const ccSwitches = arts.filter(art=>art.select.cc!==undefined).map(art=>[art.select.cc,...art.select.range,artClear(art),artBit(art.id)]);
  const chokes=[...new Set(instrument.groups.map(g=>g.choke).filter(Boolean))];
  const groups=new Map(instrument.groups.map(g=>[g.id,g]));
  const regions = plan.resolvedRegions.map(r => {
    const group=groups.get(r.group);
    const set = variations.findIndex(v => v.id === r.variation?.set);
    const gain = 10 ** (r.gainDb / 20), weights = new Float32Array(256);
    for (let midi = r.key[0]; midi <= r.key[1]; midi++) {
      if (!plan.notes[r.trigger][midi].includes(r)) continue;
      weights[midi] = fade(midi, r.keyFadeIn, true, r.keyFadeLaw) * fade(midi, r.keyFadeOut, false, r.keyFadeLaw);
    }
    for (let midi = r.velocity[0]; midi <= r.velocity[1]; midi++) {
      weights[midi + 128] = velocityGain(midi, r.velocityCurve) * fade(midi, r.fadeIn, true, r.fadeLaw) *
        fade(midi, r.fadeOut, false, r.fadeLaw);
    }
    return {id:r.id, sample:r.sample, first:r.frames[0], end:r.frames[1], root:r.root,
      loopFirst:r.loop?.start ?? 0, loopEnd:r.loop?.end ?? 0, crossfade:r.loop?.crossfade ?? 0,
      loopMode:['forward','reverse','pingPong'].indexOf(r.loop?.mode ?? 'forward'),
      choke:chokes.indexOf(group.choke)+1, voiceLimit:group.voiceLimit ?? 0, retrigger:group.retrigger==='cut',
      filter:r.filter ? [['lowpass','highpass','bandpass'].indexOf(r.filter.type)+1,
        (69+12*Math.log2(r.filter.cutoffHz/440))*256,r.filter.resonance] : null,
      envelopes:[r.envelope,r.filterEnvelope,r.auxEnvelope].map(e=>e&&[e.attackMs,e.decayMs,e.sustain,e.releaseMs]),
      lfo:r.lfo && [r.lfo.shape==='triangle'?2:1,r.lfo.rateHz], pan:r.pan, gain,
      routes:r.modulation.map(route=>[typeof route.source==='object'?16+route.source.cc:modulationSources.indexOf(route.source),
        modulationDestinations.indexOf(route.destination),route.polarity==='bipolar',route.depth]),
      flags:Number(r.trigger === 'release') | (r.mode === 'oneShot' || r.trigger === 'release' ? 2 : 0) | (r.reverse ? 4 : 0) | (r.fixedPitch ? 8 : 0),
      group:groupIds.indexOf(r.group), art:artBit(r.articulation), set:set + 1,
      member:set < 0 ? 0 : variations[set].order.indexOf(r.variation.member),
      tuning:2 ** (r.cents / 1200), left:gain * Math.min(1, 1 - r.pan), right:gain * Math.min(1, 1 + r.pan), weights};
  });
  return {id:instrument.id, revision:instrument.revision, dependencies:plan.dependencies, initial, switches, ccSwitches, regions, pads:(instrument.pads ?? []).map(pad=>[pad.index,pad.note]),
    variations:variations.map(v => [v.order.length, v.seed, v.mode === 'random', v.avoidRepeat])};
}

export class SamplerRuntime {
  constructor(x) {
    this.x = x;
    this.routes = new Map();
    this.banks = new Map();
    this.pcm = new Map();
    this.arena = new PcmArena(x);
    this.live = null;
    this.pending = null;
    this.exportPins = new Set();
  }

  releaseSamples(bank) {
    for (const hash of bank.hashes) {
      const entry = this.pcm.get(hash);
      if (--entry.references === 0) {
        this.pcm.delete(hash);
        this.arena.release(entry.base, entry.bytes);
      }
    }
  }
  evict() {
    for (const [key, bank] of this.banks) {
      if (this.exportPins.has(bank) || this.x.waswan_sampler_bank_used(bank.index)) continue;
      this.banks.delete(key);
      this.releaseSamples(bank);
      return true;
    }
    return false;
  }
  cancel() {
    if (this.pending && !this.pending.resident) this.releaseSamples(this.pending);
    this.pending = null;
  }
  begin(m) {
    const key = refKey(m.ref);
    if (typeof m.request !== 'string' || !m.request.length) throw Error('Missing sampler upload token');
    const source = m.packed ?? m.instrument;
    if (source?.id !== m.ref.instrumentId || source?.revision !== m.ref.revision) throw Error('Sampler revision mismatch');
    this.cancel();
    const resident = this.banks.get(key);
    if (resident) {
      this.pending = {token:m.request, resident};
      return {token:m.request, sampleIds:[]};
    }
    const packed = m.packed ?? packSampler(m.instrument);
    if (!packed.regions.length || packed.regions.length > samplerLimits.regions || packed.switches.length > samplerLimits.articulations ||
        packed.variations.length > samplerLimits.variations || packed.dependencies.length > packed.regions.length) throw Error('Invalid prepared sampler map');
    while (this.banks.size >= maxBanks) if (!this.evict()) throw budget('All resident instrument revisions are in use.');
    const occupied = new Set([...this.banks.values()].map(bank => bank.index));
    let index = 0;
    while (occupied.has(index)) index++;
    const pending = {token:m.request, key, index, pads:new Map(packed.pads), hashes:new Set(), missing:new Map()};
    this.pending = pending;
    try {
      for (const sample of packed.dependencies) {
        const hash = sample.sha256, bytes = sample.frames * sample.channels * 2;
        if (!Number.isSafeInteger(sample.frames) || sample.frames < 1 || ![1, 2].includes(sample.channels) ||
            sample.sampleRate !== 44100 || bytes > samplerLimits.memoryBytes || !/^[a-f0-9]{64}$/i.test(hash)) throw budget('Invalid sample length, format or identifier.');
        let entry = this.pcm.get(hash);
        if (entry && (entry.bytes !== bytes || entry.channels !== sample.channels)) throw Error('Conflicting sampler PCM layout');
        if (!entry) {
          let base = this.arena.allocate(bytes);
          while (!base && this.evict()) base = this.arena.allocate(bytes);
          if (!base) throw budget('Insufficient contiguous PCM memory for '+sample.id+'.');
          entry = {base, bytes, channels:sample.channels, references:0};
          this.pcm.set(hash, entry);
          pending.missing.set(sample.id, {entry, written:0});
        }
        if (!pending.hashes.has(hash)) {
          pending.hashes.add(hash);
          entry.references++;
        }
      }
      this.installMap(index, packed);
      return {token:m.request, sampleIds:[...pending.missing.keys()]};
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  installMap(index, packed) {
    const x = this.x;
    if (!x.waswan_sampler_bank(index, packed.regions.length, packed.initial)) throw budget('Insufficient instrument table memory.');
    for (const sw of packed.switches) x.waswan_sampler_switch(index, ...sw);
    for (const sw of packed.ccSwitches ?? []) x.waswan_sampler_cc_switch(index,...sw);
    packed.variations.forEach((v, i) => x.waswan_sampler_variation(index, i, ...v));
    const samples = new Map(packed.dependencies.map(sample => [sample.id, sample]));
    for (const [i, r] of packed.regions.entries()) {
      const sample = samples.get(r.sample);
      if (!sample || r.end > sample.frames || !Number.isInteger(r.first) || !Number.isInteger(r.end) ||
          r.first < 0 || r.first >= r.end || !(r.weights instanceof Float32Array) || r.weights.length !== 256 ||
          ![r.left, r.right, r.tuning].every(Number.isFinite) || r.tuning <= 0) throw Error('Invalid prepared sampler region');
      const ptr = x.waswan_sampler_region(index, i, this.pcm.get(sample.sha256).base, sample.channels, r.first, r.end,
        r.loopFirst, r.loopEnd, r.root, r.flags, r.group, r.art, r.set, r.member, r.tuning, r.left, r.right);
      if (!ptr) throw Error('Invalid sampler region '+r.id);
      new Float32Array(x.memory.buffer, ptr, 256).set(r.weights);
      if (!x.waswan_sampler_playback(index,i,r.loopMode,r.crossfade,r.choke,r.voiceLimit,r.retrigger,r.gain,r.pan)) throw Error('Invalid sampler playback settings');
      if (r.filter && !x.waswan_sampler_filter(index,i,...r.filter)) throw Error('Invalid sampler filter');
      if (r.lfo && !x.waswan_sampler_lfo(index,i,...r.lfo)) throw Error('Invalid sampler LFO');
      r.envelopes.forEach((env,k)=>{if(env && !x.waswan_sampler_envelope(index,i,k,...env))throw Error('Invalid sampler envelope');});
      for (const route of r.routes) if(!x.waswan_sampler_modulation(index,i,...route))throw Error('Invalid sampler modulation');
    }
  }
  command(m) {
    const x = this.x;
    if (!x.waswan_sampler_pages) throw Error('Build the 256-voice sampler host first.');
    if (m.t === 'daw-sampler-status') return {resident:this.banks.has(refKey(m.ref))};
    if (m.t === 'daw-sampler-live') {
      const bank = m.ref == null ? null : this.banks.get(refKey(m.ref));
      if (m.ref && !bank) throw Error('Prepare this sampler revision before playing it');
      if (bank && x.sim_engine(0) !== 0) throw Error('Select an Analog backing patch on Part A first');
      if (this.live !== bank) x.waswan_sampler_bind(x.waswan_daw_capacity(), bank ? bank.index + 1 : 0);
      this.live = bank;
      return true;
    }
    if (m.t === 'daw-sampler-begin') return this.begin(m);
    const p = this.pending;
    if (!p || p.token !== m.token) throw Error('Sampler upload expired');
    if (m.t === 'daw-sampler-cancel') { this.cancel(); return true; }
    if (m.t === 'daw-sampler-chunk') {
      const target = p.missing?.get(m.sampleId), data = m.pcm;
      if (!target || !(data instanceof Int16Array) || !data.length || data.length > 32768 ||
          m.offset !== target.written || (m.offset + data.length) * 2 > target.entry.bytes) throw Error('Invalid sampler PCM chunk');
      new Int16Array(x.memory.buffer, target.entry.base + m.offset * 2, data.length).set(data);
      target.written += data.length;
      return true;
    }
    if (m.t !== 'daw-sampler-commit') throw Error('Unknown sampler command');
    if (!p.resident) {
      for (const {entry, written} of p.missing.values()) if (2 * written !== entry.bytes) throw Error('Incomplete sampler upload');
      this.banks.set(p.key, {index:p.index, hashes:p.hashes, pads:p.pads});
    }
    this.pending = null;
    return true;
  }
  prepareSlots(slots) {
    const next = new Map();
    for (const s of slots) {
      if (s.type !== 'sampler') continue;
      if (!Number.isInteger(s.part) || s.part < 0 || s.part >= this.x.waswan_daw_capacity() || next.has(s.part)) throw Error('Invalid sampler part');
      const bank = this.banks.get(refKey(s.ref ?? s));
      if (!bank) throw Error('Prepare the requested sampler instrument revision first');
      next.set(s.part, {bank, trackId:s.trackId});
    }
    return next;
  }
  applySlots(next) {
    for (const part of new Set([...this.routes.keys(), ...next.keys()])) {
      const previous = this.routes.get(part), selected = next.get(part);
      if (previous?.bank !== selected?.bank || previous?.trackId !== selected?.trackId) {
        this.x.waswan_sampler_bind(part, selected ? selected.bank.index + 1 : 0);
      }
    }
    this.routes = next;
  }
  resetSequence() { this.x.waswan_sampler_reset_seq?.(); }
  chase(part, note, velocity, channel, id) {
    if (id) this.x.waswan_sampler_chase_id?.(part, note, velocity, channel ?? 0, id);
    else this.x.waswan_sampler_chase?.(part, note, velocity);
  }
  sequenceState(part, channel) {
    if (!this.x.waswan_sampler_seq_state) return [];
    const size = this.x.waswan_sampler_state_size();
    const offset = channel === undefined ? 0 : channel * size / 16;
    const length = channel === undefined ? size : size / 16;
    const parts = part === undefined ? this.routes.keys() : [part];
    const result = [];
    for (const current of parts) {
      const address = this.x.waswan_sampler_seq_state(current) + offset;
      const view = new Uint8Array(this.x.memory.buffer, address, length);
      result.push({address, view, bytes:view.slice()});
    }
    return result;
  }
  restoreSequenceState(state) {
    const memory = this.x.memory.buffer;
    for (let i = 0; i < state.length; i++) {
      const entry = state[i];
      // WASM growth invalidates views. The usual loop restoration reuses its view.
      if (entry.view.buffer !== memory) entry.view = new Uint8Array(memory, entry.address, entry.bytes.length);
      entry.view.set(entry.bytes);
    }
  }
  saveSequence() {
    const routes = this.routes;
    for (const {bank} of routes.values()) this.exportPins.add(bank);
    return {routes, state:this.sequenceState()};
  }
  restoreSequence(snapshot) {
    this.applySlots(snapshot.routes);
    this.restoreSequenceState(snapshot.state);
    this.exportPins.clear();
  }
}
