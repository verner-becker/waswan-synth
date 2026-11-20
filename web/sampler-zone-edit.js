// SPDX-License-Identifier: GPL-3.0-only
import {applyEdits} from './sampler-instrument.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function zoneVelocity(model, region) {
  return region.layer ? model.layers.find(layer => layer.id === region.layer).velocity : region.velocity;
}

export function dragZone(bounds, keyDelta, velocityDelta, edges) {
  function axis(pair, delta, low, high, edge) {
    if (edge === 'lo') return [clamp(pair[0] + delta, low, pair[1]), pair[1]];
    if (edge === 'hi') return [pair[0], clamp(pair[1] + delta, pair[0], high)];
    if (edge !== 'move') return pair;
    const shift = clamp(delta, low - pair[0], high - pair[1]);
    return pair.map(n => n + shift);
  }
  return {key:axis(bounds.key, keyDelta, 0, 127, edges.key),
    velocity:axis(bounds.velocity, velocityDelta, 1, 127, edges.velocity)};
}

const replace = (collection, value) => ({op:'replace', collection, value});
function followBounds(entry, names, previous, next) {
  const result = {...entry};
  for (const name of names) {
    if (!entry[name]) continue;
    const [a,b] = entry[name];
    // When moving, shift the fade with the region. On resize, preserve its
    // absolute position and width whenever they still fit the new range.
    const shift = next[1] - next[0] === previous[1] - previous[0] ? next[0] - previous[0] : 0;
    const width = Math.min(b - a, next[1] - next[0]);
    if (width < 1) throw Error('Disable the crossfade before reducing its range to one MIDI value.');
    const start = clamp(a + shift, next[0], next[1] - width);
    result[name] = [start, start + width];
  }
  return result;
}

export function resizeZone(model, region, key, velocity) {
  const next = followBounds(region, ['keyFadeIn','keyFadeOut'], region.key, key);
  next.key = key;
  const edits = [];
  if (region.layer) {
    const layer = model.layers.find(item => item.id === region.layer);
    const changed = followBounds(layer, ['fadeIn','fadeOut'], layer.velocity, velocity);
    edits.push(replace('layers', {...changed, velocity}));
  } else next.velocity = velocity;
  edits.push(replace('regions', next));
  return applyEdits(model, edits);
}

export function editVelocityFade(model, region, property, value) {
  const existing = model.layers.find(layer => layer.id === region.layer);
  const layer = existing ? {...existing} : {id:'layer-' + crypto.randomUUID(), velocity:region.velocity};
  if (value == null) delete layer[property];
  else layer[property] = value;
  if (existing) return applyEdits(model, [replace('layers', layer)]);
  const {velocity, ...withLayer} = region;
  return applyEdits(model, [{op:'add',collection:'layers',value:layer},
    replace('regions', {...withLayer, layer:layer.id})]);
}
