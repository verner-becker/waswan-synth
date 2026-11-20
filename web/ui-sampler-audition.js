// SPDX-License-Identifier: GPL-3.0-only
// Selection, processing stages and snapshots share one temporary media source.
export function createSamplerAudition(getAudio) {
  const listeners = new Set();
  let current = null;
  function stop(reason = 'stopped') {
    const state = current;
    if (!state) return;
    current = null;
    if (state.audio) {
      state.audio.onended = state.audio.onerror = null;
      state.audio.pause();
      state.audio.removeAttribute('src');
      state.audio.load();
      state.source?.disconnect();
      URL.revokeObjectURL(state.url);
    }
    for (const fn of listeners) fn(false);
    state.onEnded?.(reason);
  }
  async function play(wav, onEnded) {
    stop();
    const {context, gain} = getAudio?.() || {};
    if (!context || !gain) throw Error('Start audio in the Synth to preview this selection.');
    const state = {onEnded};
    current = state;
    for (const fn of listeners) fn(true);
    try {
      await context.resume();
      if (current !== state) return false;
      state.audio = new Audio();
      state.url = URL.createObjectURL(wav);
      state.audio.src = state.url;
      state.source = context.createMediaElementSource(state.audio);
      state.source.connect(gain);
      state.audio.onended = () => { if (state === current) stop('ended'); };
      state.audio.onerror = () => { if (state === current) stop('error'); };
      await state.audio.play();
      return state === current;
    } catch (error) {
      if (state !== current) return false;
      stop('error');
      throw error;
    }
  }
  return {play, stop, subscribe(fn) {
    listeners.add(fn);
    fn(!!current);
    return () => listeners.delete(fn);
  }};
}
