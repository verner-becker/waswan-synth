// SPDX-License-Identifier: GPL-3.0-only
// Offline buffers are interleaved Float32; all public positions are channel frames.
export function checkAudio(audio) {
  const {pcm, sampleRate, channels} = audio;
  if (!(pcm instanceof Float32Array) || ![1, 2].includes(channels) ||
      !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
      !pcm.length || pcm.length % channels || pcm.length > 32 * 1024 * 1024)
    throw Error('Invalid or oversized offline audio buffer');
  return pcm.length / channels;
}

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('Invalid '+name);
  return value;
}
function number(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) throw Error('Invalid '+name);
  return value;
}

export function levels(pcm) {
  let peak = 0, sum = 0, clipped = 0, runs = 0, previous = false;
  for (const value of pcm) {
    if (!Number.isFinite(value)) throw Error('Non-finite sample');
    const magnitude = Math.abs(value);
    peak = Math.max(peak, magnitude);
    sum += value * value;
    const full = value <= -1 || value >= 32767 / 32768;
    if (full) { clipped++; if (!previous) runs++; }
    previous = full;
  }
  return {peak, rms:Math.sqrt(sum / pcm.length), clipped, runs};
}

// Symmetric windowed-sinc low-pass. Lowering rate lowers the source cutoff first.
export function convertRate(audio, sampleRate) {
  const frames = checkAudio(audio);
  integer(sampleRate, 8000, 192000, 'sample rate');
  const ratio = sampleRate / audio.sampleRate, count = Math.max(1, Math.round(frames * ratio));
  integer(count * audio.channels, 1, 32 * 1024 * 1024, 'resampled length');
  const pcm = new Float32Array(count * audio.channels);
  if (ratio === 1) pcm.set(audio.pcm);
  else {
    const cutoff = Math.min(1, ratio) * 0.96, radius = Math.ceil(16 / cutoff);
    for (let i = 0; i < count; i++) {
      const at = i / ratio, center = Math.floor(at);
      let norm = 0, left = 0, right = 0;
      for (let j = Math.max(0, center - radius + 1); j < Math.min(frames, center + radius + 1); j++) {
        const d = at - j, angle = Math.PI * cutoff * d;
        const w = (angle ? Math.sin(angle) / angle : 1) * (0.5 + 0.5 * Math.cos(Math.PI * d / radius));
        norm += w;
        left += audio.pcm[j * audio.channels] * w;
        if (audio.channels === 2) right += audio.pcm[j * 2 + 1] * w;
      }
      pcm[i * audio.channels] = left / norm;
      if (audio.channels === 2) pcm[i * 2 + 1] = right / norm;
    }
  }
  return {pcm, sampleRate, channels:audio.channels};
}

function trimSilence(audio, op) {
  const frames = checkAudio(audio), {pcm, channels} = audio;
  const threshold = 10 ** (number(op.thresholdDb ?? -50, -144, 0, 'silence threshold') / 20);
  const margin = integer(op.marginFrames ?? 0, 0, frames, 'margin');
  const min = integer(op.minFrames ?? 1, 1, frames, 'minimum silence');
  let first = frames, last = -1;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) if (Math.abs(pcm[i * channels + ch]) >= threshold) {
      first = Math.min(first, i); last = i; break;
    }
  }
  if (last < 0) return audio;
  return {...audio, pcm:pcm.slice(channels * (first >= min ? Math.max(0, first - margin) : 0),
    channels * (frames - last - 1 >= min ? Math.min(frames, last + 1 + margin) : frames))};
}

export function editSample(source, recipe) {
  checkAudio(source);
  if (!Array.isArray(recipe) || recipe.length > 128) throw Error('Invalid edit recipe');
  let audio = {...source, pcm:source.pcm.slice()};
  const report = [];
  for (const op of recipe) {
    let {pcm, channels} = audio;
    const frames = pcm.length / channels;
    switch (op.type) {
      case 'trim': {
        integer(op.start, 0, frames - 1, 'start'); integer(op.end, op.start + 1, frames, 'end');
        audio.pcm = pcm.slice(op.start * channels, op.end * channels); break;
      }
      case 'trimSilence': audio = trimSilence(audio, op); break;
      case 'gain':
      case 'normalizePeak':
      case 'normalizeRms': {
        let gain;
        if (op.type === 'gain') gain = 10 ** (number(op.db, -144, 60, 'gain') / 20);
        else {
          const measured = levels(pcm);
          const target = 10 ** (number(op.targetDb ?? (op.type === 'normalizePeak' ? -1 : -18), -144, 0, 'target') / 20);
          const ceiling = 10 ** (number(op.ceilingDb ?? 0, -144, 0, 'peak ceiling') / 20);
          const basis = op.type === 'normalizePeak' ? measured.peak : measured.rms;
          gain = basis ? Math.min(target / basis, ceiling / measured.peak) : 1;
          report.push({type:op.type, gain, peak:measured.peak * gain, rms:measured.rms * gain, target});
        }
        for (let i = 0; i < pcm.length; i++) pcm[i] *= gain;
        break;
      }
      case 'fade': {
        const fadeIn = integer(op.inFrames ?? 0, 0, frames, 'fade in');
        const fadeOut = integer(op.outFrames ?? 0, 0, frames, 'fade out');
        for (let i = 0; i < frames; i++) {
          const gain = (i < fadeIn ? i / Math.max(1, fadeIn - 1) : 1) *
            (frames - i <= fadeOut ? (frames - i - 1) / Math.max(1, fadeOut - 1) : 1);
          for (let ch = 0; ch < channels; ch++) pcm[i * channels + ch] *= gain;
        }
        break;
      }
      case 'reverse':
        for (let i = 0; i < Math.floor(frames / 2); i++) for (let ch = 0; ch < channels; ch++) {
          const a = i * channels + ch, b = (frames - i - 1) * channels + ch;
          const tmp = pcm[a]; pcm[a] = pcm[b]; pcm[b] = tmp;
        }
        break;
      case 'rate': audio = convertRate(audio, op.sampleRate); break;
      case 'channels': {
        const target = integer(op.channels, 1, 2, 'channels');
        if (target === channels) break;
        integer(frames * target, 1, 32 * 1024 * 1024, 'output length');
        const out = new Float32Array(frames * target);
        for (let i = 0; i < frames; i++) {
          if (target === 1) out[i] = (pcm[2*i] + pcm[2*i+1]) * 0.5;
          else out[2*i] = out[2*i+1] = pcm[i];
        }
        audio = {...audio, pcm:out, channels:target};
        break;
      }
      case 'loopCrossfade': {
        const start = integer(op.start, 0, frames - 2, 'loop start');
        const end = integer(op.end, start + 2, frames, 'loop end');
        const n = integer(op.frames, 1, Math.min(start, end - start), 'crossfade pre-roll');
        for (let i = 0; i < n; i++) for (let ch = 0; ch < channels; ch++) {
          const at = (end - n + i) * channels + ch, weight = (i + 1) / n;
          pcm[at] = (1 - weight) * pcm[at] + weight * pcm[(start - n + i) * channels + ch];
        }
        break;
      }
      default: throw Error('Unsupported sample edit: '+op.type);
    }
  }
  return {audio, report};
}

export function splitFrames(frames, markers) {
  integer(frames, 1, Number.MAX_SAFE_INTEGER, 'length');
  if (!Array.isArray(markers)) throw Error('Invalid slice markers');
  const points = [...new Set([0, ...markers.map(n => integer(n, 0, frames, 'slice')), frames])].sort((a,b) => a-b);
  return points.slice(1).map((end,i) => [points[i], end]);
}
