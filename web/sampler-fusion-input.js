// SPDX-License-Identifier: GPL-3.0-only
// The monitor lease owns sounding destinations. These entries remember which
// physical releases still belong to Fusion after Stop or a new monitor opens.
export function createFusionInput({onError = () => {}} = {}) {
  const keys = new Map(), pedals = new Map();
  let active = null;
  function send(lease, method, ...args) {
    try {
      Promise.resolve(lease[method](...args)).catch(error => { if (active === lease) onError(error); });
    } catch (error) { if (active === lease) onError(error); }
  }
  function dispatch(entries, owner, key, down, method, data) {
    let group = entries.get(owner);
    const previous = group?.get(key);
    if (!down) {
      if (!group?.has(key)) return false;
      group.delete(key);
      if (!group.size) entries.delete(owner);
      if (active && previous === active) send(active, method, {owner, ...data});
      return true;
    }
    if (!active) {
      group?.delete(key);
      if (group && !group.size) entries.delete(owner);
      return false;
    }
    if (!group) entries.set(owner, group = new Map());
    group.set(key,active);
    send(active,method,{owner, ...data});
    return true;
  }
  function note(owner, channel, pitch, velocity) {
    return dispatch(keys, owner, channel * 128 + pitch, velocity > 0, 'note', {channel, note:pitch, velocity});
  }
  function release(owner, channel) {
    if (!active) return;
    send(active,'releaseOwner',owner,channel);
    for (const [entries, isKey] of [[keys,true],[pedals,false]]) {
      const group = entries.get(owner);
      if (!group) continue;
      for (const [id,lease] of group) {
        if (lease === active && (channel === undefined || (isKey ? id >> 7 : id) === channel)) group.set(id,null);
      }
    }
  }
  function releaseMidi() {
    if (!active) return false;
    for (const owner of new Set([...keys.keys(), ...pedals.keys()])) if (owner.startsWith('midi:')) release(owner);
    return true;
  }
  return {
    bind(lease) {
      if (active && active !== lease) throw Error('Stop the active Fusion monitor before changing its input.');
      active = lease;
    },
    unbind(lease) {
      if (active !== lease) return;
      active = null;
      // Release events may arrive after the worklet has restored the Synth.
      // Drop references to its routing graph and retain only the pending keys.
      for (const entries of [keys,pedals]) for (const group of entries.values()) {
        for (const [id,owner] of group) if (owner === lease) group.set(id,null);
      }
    },
    releaseMidi,
    releaseBrowser() { if (active) for (const owner of ['screen','computer']) release(owner); },
    virtual(owner,k,down,velocity) {
      if (!['screen','computer'].includes(owner) || !Number.isInteger(k) || k < 0 || k >= 37) return false;
      return note(owner,0,48 + k,down ? Math.max(1,Math.min(127,velocity || 100)) : 0);
    },
    midiDown(pitch) {
      for (const [owner,group] of keys) if (owner.startsWith('midi:')) {
        for (const [id,lease] of group) if ((id & 127) === pitch && lease && lease === active) return true;
      }
      return false;
    },
    routeMidi(data,deviceId) {
      if (!data || data.length !== 3) return false;
      const [status,key,value] = data;
      if (![status,key,value].every(Number.isInteger) || status < 128 || status >= 240 ||
          key < 0 || key > 127 || value < 0 || value > 127) return false;
      const kind = status & 240, channel = status & 15, owner = 'midi:' + (deviceId || 'input');
      if (kind === 128 || kind === 144) return note(owner,channel,key,kind === 128 ? 0 : value);
      if (kind === 176 && key === 64) {
        return dispatch(pedals,owner,channel,value >= 64,'pedal',{channel,down:value >= 64});
      }
      if (active && kind === 176 && (key === 120 || key === 123)) { release(owner,channel); return true; }
      return false;
    },
  };
}
