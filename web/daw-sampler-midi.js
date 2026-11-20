// SPDX-License-Identifier: GPL-3.0-only
const midiByte = n => Number.isInteger(n) && n >= 0 && n <= 127;
export const legacyExpression = type => type === 'bend' || type === 'mod';

export function validPerformanceControl(event) {
  if (!Number.isInteger(event?.channel) || event.channel < 0 || event.channel > 15) return false;
  if (event.type === 'bend') return Number.isInteger(event.value) && event.value >= -8192 && event.value <= 8191;
  if (!midiByte(event.value)) return false;
  if (event.type === 'cc') return midiByte(event.controller);
  if (event.type === 'polyPressure') return midiByte(event.note);
  return event.type === 'mod' || event.type === 'channelPressure';
}

export function midiControl(data) {
  const status = data?.[0], kind = status & 240, channel = status & 15;
  if (!Number.isInteger(status) || status < 128 || status >= 240 || !midiByte(data[1])) return null;
  if (kind === 208 && data.length === 2) return {type:'channelPressure',channel,value:data[1]};
  if (data.length !== 3 || !midiByte(data[2])) return null;
  if (kind === 160) return {type:'polyPressure',channel,note:data[1],value:data[2]};
  if (kind === 176) return {type:'cc',channel,controller:data[1],value:data[2]};
  if (kind === 224) return {type:'bend',channel,value:(data[1] | data[2] << 7) - 8192};
  return null;
}

export function controlKey(event) {
  // A legacy modulation event and CC1 represent the same controller.
  if (event.type === 'mod') return `${event.channel}:cc:1`;
  return `${event.channel}:${event.type}:${event.controller ?? event.note ?? ''}`;
}

export function controlBytes(event) {
  const {type,channel,value} = event;
  if (type === 'bend') {
    const bend = value + 8192;
    return [224 | channel,bend & 127,bend >> 7];
  }
  if (type === 'channelPressure') return [208 | channel,value];
  if (type === 'polyPressure') return [160 | channel,event.note,value];
  return [176 | channel,type === 'mod' ? 1 : event.controller,value];
}

export function applySamplerControl(host, part, source, event, silent = 0) {
  const {channel,type,value} = event;
  if (type === 'bend') return !!host.waswan_sampler_control?.(part,channel,source,3,0,value,silent);
  if (type === 'channelPressure') return !!host.waswan_sampler_control?.(part,channel,source,1,0,value,silent);
  if (type === 'polyPressure') return !!host.waswan_sampler_control?.(part,channel,source,2,event.note,value,silent);
  return !!host.waswan_sampler_control?.(part,channel,source,0,type === 'mod' ? 1 : event.controller,value,silent);
}
