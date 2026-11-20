// SPDX-License-Identifier: GPL-3.0-only
import {action, el} from './ui-primitives.js';
import {applyEdits, compile, createSelectionState, explainNote, samplerCapabilities} from './sampler-instrument.js';
import {dragZone, editVelocityFade, resizeZone, zoneVelocity} from './sampler-zone-edit.js';

const pitch = n => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n % 12] + (Math.floor(n / 12) - 1);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function field(parent, title, input) {
  const label = el('label', '', title);
  input.setAttribute('aria-label', title);
  label.append(input);
  parent.append(label);
  return input;
}
function choices(parent, title, values = []) {
  const input = field(parent, title, el('select'));
  for (const value of values) input.append(new Option(value, value));
  return input;
}
function numeric(parent, title, min, max) {
  const input = field(parent, title, el('input'));
  Object.assign(input, {type:'number', step:1, min, max, required:true});
  return input;
}
function options(input, items) {
  input.replaceChildren(...items.map(([value, label]) => {
    const option = new Option(label, value);
    option.title = value;
    return option;
  }));
}
const leaf = path => path.split('/').at(-1);
const sampleLabel = sample => sample.name || leaf(sample.path);

export function createSamplerMapping({change, select, run}) {
  const node = el('section', 'ww-sampler-mapping');
  node.setAttribute('aria-label', 'Keyboard and velocity mapping');
  const help = el('p', 'ww-muted', 'Drag a zone to move it or drag its edges to resize. Select a region below to inspect overlapping zones.');
  const canvas = el('canvas', 'ww-sampler-keymap');
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label','Region map. Horizontal axis MIDI key 0 to 127. Vertical axis velocity 1 to 127.');
  const tools = el('fieldset', 'ww-sampler-map-controls');
  const toolbar = el('div', 'ww-sampler-fields');
  const regions = choices(toolbar, 'Selected region');
  regions.onchange = () => select(regions.value);
  const duplicate = action('Duplicate region', () => void run(() => {
    const copy = {...region, id:'region-' + crypto.randomUUID()};
    change(applyEdits(model, [{op:'add', collection:'regions', value:copy}]), {regionId:copy.id});
  }));
  const remove = action('Remove region', () => void run(() => {
    const index = model.regions.indexOf(region);
    const next = applyEdits(model, [{op:'remove', collection:'regions', id:region.id}]);
    change(next, {regionId:next.regions[Math.min(index, next.regions.length - 1)]?.id ?? null});
  }));
  toolbar.append(duplicate, remove);
  const inspector = el('fieldset', 'ww-sampler-map-inspector');
  const summary = el('legend', '', 'Region inspector');
  const fields = el('div', 'ww-sampler-fields');
  const sample = choices(fields, 'Region sample');
  const mode = choices(fields, 'Region playback', samplerCapabilities.playbackModes);
  const trigger = choices(fields, 'Region trigger', samplerCapabilities.triggers);
  const root = numeric(fields, 'Region root (MIDI)', 0, 127);
  const keyLow = numeric(fields, 'Low key', 0, 127), keyHigh = numeric(fields, 'High key', 0, 127);
  const velLow = numeric(fields, 'Low velocity', 1, 127), velHigh = numeric(fields, 'High velocity', 1, 127);
  const layerNote = el('p','ww-muted');
  const fades = el('details', 'ww-sampler-map-fades');
  fades.append(el('summary', '', 'Key and velocity crossfades'));
  const fadeFields = el('div', 'ww-sampler-fields');
  fades.append(fadeFields);
  const keyLaw = choices(fadeFields, 'Key fade law', samplerCapabilities.fadeLaws);
  const velocityLaw = choices(fadeFields, 'Velocity fade law', samplerCapabilities.fadeLaws);
  const fadeRows = [];
  for (const [title, prop, velocity] of [['Key fade in','keyFadeIn',false], ['Key fade out','keyFadeOut',false],
    ['Velocity fade in','fadeIn',true], ['Velocity fade out','fadeOut',true]]) {
    const row = el('div','ww-sampler-fields');
    const enabled = field(row, title, el('input'));
    enabled.type = 'checkbox';
    const a = numeric(row, title + ' start', velocity ? 1 : 0, 127);
    const b = numeric(row, title + ' end', velocity ? 1 : 0, 127);
    fadeRows.push({prop, velocity, enabled, a, b});
    fades.append(row);
    function setRange() {
      const interval = enabled.checked ? [a.valueAsNumber,b.valueAsNumber] : null;
      if (velocity) change(editVelocityFade(model,region,prop,interval));
      else {
        const next = {...region};
        if (interval) next[prop] = interval; else delete next[prop];
        edit(next);
      }
    }
    for (const control of [enabled, a, b]) control.onchange = () => commit(setRange);
  }
  inspector.append(summary, fields, layerNote, fades);
  const probe = el('div','ww-sampler-map-probe');
  const probeFields = el('div','ww-sampler-fields');
  const note = numeric(probeFields, 'Probe note (MIDI)', 0, 127);
  const velocity = numeric(probeFields, 'Probe velocity', 1, 127);
  note.value = 60;
  velocity.value = 96;
  const explain = action('Explain note', () => void run(() => {
    if (!note.checkValidity() || !velocity.checkValidity()) throw Error('Choose a MIDI note and velocity within range.');
    plan ??= compile(model);
    const event = {note:note.valueAsNumber, velocity:velocity.valueAsNumber, type:'noteOn', id:'probe'};
    const attack = explainNote(plan,event,probeState);
    const release = explainNote(plan,{...event, type:'noteOff'},attack.state);
    probeState = release.state;
    const rows = [...attack.voices,...release.voices].map(voice => {
      const source = model.samples.find(s => s.id === voice.sampleId);
      return el('li','',voice.trigger + ' · ' + sampleLabel(source) + ' · ' + voice.regionId +
        ' · weight ' + voice.weight.toFixed(3) + ' · gain ' + voice.gain.toFixed(3));
    });
    probeMessage.textContent = pitch(event.note) + ' · velocity ' + event.velocity + ' · ' +
      (attack.consumed ? 'Keyswitch' : rows.length ? rows.length + ' triggered' : 'No matching region');
    explanation.replaceChildren(...rows);
    paint();
  }));
  const reset = action('Reset probe', () => { resetProbe(); paint(); });
  const probeMessage = el('output','');
  const explanation = el('ul');
  probe.setAttribute('aria-label', 'Note selection probe');
  probeFields.append(explain, reset);
  probe.append(probeFields, probeMessage, explanation);
  tools.append(toolbar, inspector, probe);
  node.append(help, canvas, tools);

  let model, region, drag, plan, probeState = createSelectionState();
  function resetProbe() {
    plan = null;
    probeState = createSelectionState();
    probeMessage.textContent = '';
    explanation.replaceChildren();
  }
  function edit(value) { change(applyEdits(model,[{op:'replace',collection:'regions',value}])); }
  function commit(fn) {
    void run(() => {
      try { return fn(); }
      catch (error) { refresh(); throw error; }
    });
  }
  for (const input of [keyLow,keyHigh,velLow,velHigh]) {
    input.onchange = () => commit(() => change(resizeZone(model, region, [keyLow.valueAsNumber,keyHigh.valueAsNumber],
      [velLow.valueAsNumber,velHigh.valueAsNumber])));
  }
  root.onchange = () => commit(() => edit({...region,root:root.valueAsNumber}));
  trigger.onchange = () => commit(() => edit({...region,trigger:trigger.value}));
  mode.onchange = () => commit(() => edit({...region,mode:mode.value}));
  sample.onchange = () => commit(() => {
    const next = model.samples.find(s => s.id === sample.value);
    const old = model.samples.find(s => s.id === region.sample);
    const frames = region.frames[0] === 0 && region.frames[1] === old.frames ? [0,next.frames] : region.frames;
    edit({...region,sample:next.id,frames});
  });
  keyLaw.onchange = () => commit(() => edit({...region,keyFadeLaw:keyLaw.value}));
  velocityLaw.onchange = () => commit(() => change(editVelocityFade(model,region,'fadeLaw',velocityLaw.value)));

  function refresh() {
    tools.disabled = !model;
    inspector.disabled = duplicate.disabled = remove.disabled = !region;
    regions.value = region?.id || '';
    regions.title = region?.id || '';
    if (!region) { inspector.hidden = true; return; }
    inspector.hidden = false;
    const layer = model.layers.find(l => l.id === region.layer), vel = zoneVelocity(model,region);
    root.value = region.root; mode.value = region.mode; trigger.value = region.trigger;
    sample.value = region.sample;
    keyLow.value = region.key[0]; keyHigh.value = region.key[1]; velLow.value = vel[0]; velHigh.value = vel[1];
    layerNote.textContent = layer ? 'Shared velocity layer · ' + layer.id + ' · edits affect all its regions.' : 'Velocity belongs to this region.';
    keyLaw.value = region.keyFadeLaw;
    velocityLaw.value = layer?.fadeLaw ?? 'equalPower';
    for (const row of fadeRows) {
      const pair = row.velocity ? layer?.[row.prop] : region[row.prop], [lo,hi] = row.velocity ? vel : region.key;
      const incoming = row.prop.endsWith('In');
      row.enabled.checked = !!pair;
      row.enabled.disabled = !pair && lo === hi;
      row.a.disabled = row.b.disabled = !pair;
      row.a.min = row.b.min = lo; row.a.max = row.b.max = hi;
      row.a.value = pair?.[0] ?? (incoming ? lo : Math.max(lo, hi - 8));
      row.b.value = pair?.[1] ?? (incoming ? Math.min(hi, lo + 8) : hi);
    }
  }
  function sync(next, selectedId) {
    if (next !== model) {
      resetProbe();
      drag = null;
      model = next;
      options(regions,(model?.regions ?? []).map((r, i) => {
        const source = model.samples.find(s => s.id === r.sample);
        const velocity = zoneVelocity(model, r).join('–');
        return [r.id,sampleLabel(source) + ' · ' + pitch(r.root) + ' · vel ' + velocity + ' · region ' + (i+1)];
      }));
      options(sample,(model?.samples ?? []).map(s => [s.id,sampleLabel(s)]));
    }
    region = model?.regions.find(r => r.id === selectedId) ?? model?.regions[0] ?? null;
    refresh();
    paint();
  }

  function geometry() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    return {width, height, x:30, y:8, w:Math.max(1,width - 42), h:Math.max(1,height - 46)};
  }
  function zoneRect(r, g) {
    const preview = drag?.next;
    const key = drag?.region === r && preview ? preview.key : r.key;
    const shared = r.layer && r.layer === drag?.region.layer;
    const vel = preview && (drag?.region === r || shared) ? preview.velocity : zoneVelocity(model,r);
    return {x:g.x + key[0] * g.w / 128, y:g.y + (127 - vel[1]) * g.h / 127,
      w:(key[1] - key[0] + 1) * g.w / 128, h:(vel[1] - vel[0] + 1) * g.h / 127};
  }
  function paint() {
    const g = geometry();
    if (!g.width || !g.height) return;
    const dpr = devicePixelRatio || 1;
    const width = Math.round(g.width * dpr), height = Math.round(g.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,g.width,g.height);
    ctx.font = '10px sans-serif';
    const keyX = n => g.x + n * g.w / 128, velY = n => g.y + (127 - n) * g.h / 127;
    for (const v of [1,32,64,96,127]) {
      const y = velY(v);
      ctx.fillStyle = '#283d44'; ctx.fillRect(g.x,y,g.w,1);
      ctx.fillStyle = '#c7d4d8'; ctx.fillText(String(v),2,Math.max(11,y+3));
    }
    for (let n = 0; n < 128; n++) {
      const x = keyX(n), black = [1,3,6,8,10].includes(n % 12), unit = g.w / 128;
      ctx.fillStyle = black ? '#33424b' : '#cbd6d9';
      ctx.fillRect(x,g.y+g.h+2,Math.max(1,unit-1),black?12:18);
      if (n % 12 === 0) {
        ctx.fillStyle = '#27393f'; ctx.fillRect(x,g.y,1,g.h);
        ctx.fillStyle = '#ced9db'; ctx.fillText(pitch(n),x,g.height-3);
      }
    }
    const draw = r => {
      const rect = zoneRect(r,g);
      const selected = r.id === region?.id;
      ctx.fillStyle = selected ? 'rgba(75,203,192,.34)' : r.trigger === 'release' ? 'rgba(237,183,108,.24)' : 'rgba(107,158,206,.23)';
      ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
      ctx.strokeStyle = selected ? '#67ece1' : '#7794a2'; ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(rect.x+.5,rect.y+.5,Math.max(1,rect.w-1),Math.max(1,rect.h-1));
      ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
      const name = sampleLabel(model.samples.find(s => s.id === r.sample));
      if (!selected) {
        ctx.fillStyle = '#dbe8eb';
        if (rect.w > 48 && rect.h > 17) ctx.fillText(name,rect.x+4,rect.y+14);
        ctx.restore();
        return;
      }
      const layer = model.layers.find(l => l.id === r.layer);
      ctx.strokeStyle = '#f3d18c';ctx.lineWidth = 1;
      for (const [pair,incoming] of [[r.keyFadeIn,true],[r.keyFadeOut,false]]) {
        if (!pair) continue;
        ctx.beginPath();ctx.moveTo(keyX(pair[0]),rect.y+(incoming?rect.h:0));
        ctx.lineTo(keyX(pair[1]+1),rect.y+(incoming?0:rect.h));ctx.stroke();
      }
      for (const [pair,incoming] of [[layer?.fadeIn,true],[layer?.fadeOut,false]]) {
        if (!pair) continue;
        ctx.beginPath();ctx.moveTo(rect.x+(incoming?0:rect.w),velY(pair[0]-1));
        ctx.lineTo(rect.x+(incoming?rect.w:0),velY(pair[1]));ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      if (rect.w > 35 && rect.h > 17) ctx.fillText(name,rect.x+4,rect.y+14);
      ctx.restore();
      ctx.fillStyle = '#f3d18c'; ctx.fillRect(keyX(r.root),g.y+g.h+2,g.w/128,5);
    };
    for (const r of model?.regions ?? []) if (r !== region) draw(r);
    if (region) draw(region);
    if (plan && probeMessage.textContent) {
      ctx.fillStyle = '#f7dd9d';ctx.beginPath();ctx.arc(keyX(note.valueAsNumber+.5),velY(velocity.valueAsNumber),4,0,Math.PI*2);ctx.fill();
    }
  }

  function location(event) {
    const g = geometry(), box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    return {x, y, g, key:clamp(Math.floor((x-g.x)*128/g.w),0,127), vel:clamp(127-Math.floor((y-g.y)*127/g.h),1,127)};
  }
  canvas.onpointerdown = event => {
    if (!model || event.button !== 0 || !event.isPrimary) return;
    const p = location(event);
    if (p.x < p.g.x || p.x > p.g.x+p.g.w || p.y < p.g.y || p.y > p.g.y+p.g.h) return;
    const hits = model.regions.filter(r => {
      const v = zoneVelocity(model,r);
      return r.key[0]<=p.key && p.key<=r.key[1] && v[0]<=p.vel && p.vel<=v[1];
    });
    const target = hits.includes(region) ? region : hits.at(-1);
    if (!target) return;
    select(target.id);
    const rect = zoneRect(target,p.g);
    const edge = (v,lo,w,min,max) => v<lo+Math.min(6,w/3)?min:v>lo+w-Math.min(6,w/3)?max:null;
    const k = edge(p.x,rect.x,rect.w,'lo','hi'), v = edge(p.y,rect.y,rect.h,'hi','lo');
    drag = {pointer:event.pointerId, region:target, p, bounds:{key:target.key,velocity:zoneVelocity(model,target)},
      edges:{key:k || (v?'fixed':'move'), velocity:v || (k?'fixed':'move')}};
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (drag?.pointer !== event.pointerId) return;
    const p = location(event);
    drag.next = dragZone(drag.bounds,p.key-drag.p.key,p.vel-drag.p.vel,drag.edges);
    paint();
  };
  canvas.onpointerup = event => {
    if (drag?.pointer !== event.pointerId) return;
    canvas.onpointermove(event);
    const {next, region:target, bounds} = drag; drag = null;
    if (next.key.toString() !== bounds.key.toString() || next.velocity.toString() !== bounds.velocity.toString()) {
      commit(() => change(resizeZone(model,target,next.key,next.velocity),{regionId:target.id}));
    }
    paint();
  };
  canvas.onlostpointercapture = canvas.onpointercancel = () => { drag = null; paint(); };
  new ResizeObserver(paint).observe(canvas);
  sync(null,null);
  return {node, sync};
}
