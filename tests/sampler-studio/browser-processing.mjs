// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';

const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
try {
  const page = await browser.newPage();
  await page.goto(new URL('sampler-wav.js', process.env.SAMPLER_BROWSER_URL || 'http://localhost:8737/simulator/').href);
  await page.setContent('<main></main>');
  await page.evaluate(async () => {
    const {createProcessingStack} = await import('./ui-sampler-processing.js');
    const {createSamplerAudition} = await import('./ui-sampler-audition.js');
    const {createMiniWaveform} = await import('./ui-sampler-waveform.js');
    const {encodeSample} = await import('./sampler-offline.js');
    const {createWorking, updateWorking, previewWorkingWav} = await import('./sampler-working.js');
    const {initializeLibrary, importOriginal} = await import('./sampler-library.js');
    const {decodeWav} = await import('./sampler-wav.js');
    const root = await navigator.storage.getDirectory();
    const library = await initializeLibrary(root);
    const wav = encodeSample({sampleRate: 48000, channels: 1,
      pcm: Float32Array.from({length: 48000}, (_, i) => .25 * Math.cos(i * 440 * 2 * Math.PI / 48000))});
    window.draft = createWorking({libraryId: library.id, source: await importOriginal(root, wav, 'Samples/Originals/test.wav')});
    window.heard = [];
    window.errors = [];
    const context = new AudioContext(), gain = context.createGain();
    gain.connect(context.destination);
    const audition = createSamplerAudition(() => ({context, gain}));
    const stack = createProcessingStack({
      run: async fn => { try { await fn(); } catch (error) { errors.push(error.message); } },
      change: recipe => { window.draft = updateWorking(draft, {recipe}); stack.sync(draft); },
      preview: async through => {
        const audio = await previewWorkingWav(root, draft, {through});
        const {pcm} = await decodeWav(audio, {anyRate: true});
        heard.push({through, first: pcm[0], last: pcm.at(-1)});
        return audio;
      }, audition
    });
    const mini = createMiniWaveform();
    document.querySelector('main').append(stack.node, mini.node);
    stack.sync(draft);
    await mini.show(wav);
  });
  const button = (name, scope = page) => scope.getByRole('button', {name, exact:true});
  const add = async type => {
    await page.getByLabel('Processing operation').selectOption(type);
    await button('Add stage').click();
  };
  const set = async (label, value) => {
    const input = page.getByLabel(label, {exact:true});
    await input.fill(String(value));
    await input.press('Tab');
  };
  const stages = page.locator('.ww-sampler-stages li');
  assert.equal(await page.getByLabel('Processing operation').locator('option').count(), 13);
  const miniVisible = await page.locator('.ww-sampler-mini-waveform').evaluate(c =>
    c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v > 64));
  assert(miniVisible);
  await add('fade');
  await set('Fade in (ms)', 50);
  await set('Fade out (ms)', 100);
  assert.deepEqual(await page.evaluate(() => draft.recipe[0]), {type:'fade', inFrames:2400, outFrames:4800});
  await add('gain');
  await set('Gain (dB)', -6);
  await button('Move up', stages.nth(1)).click();
  assert.deepEqual(await page.evaluate(() => draft.recipe.map(op => op.type)), ['gain','fade']);
  await button('Listen before', stages.nth(0)).click();
  await page.waitForFunction(() => document.querySelector('.ww-sampler-stage-status').textContent.includes('Before stage'));
  await button('Listen after', stages.nth(0)).click();
  await page.waitForFunction(() => document.querySelector('.ww-sampler-stage-status').textContent.includes('After stage'));
  const played = await page.evaluate(() => heard);
  assert.equal(played[0].first,8192);
  assert(Math.abs(played[1].first / played[0].first - .501) < .001);
  await button('Bypass', stages.nth(0)).click();
  await button('Listen after', stages.nth(0)).click();
  await page.waitForFunction(() => heard.length >= 3);
  assert.equal(await page.evaluate(() => heard[2].first),8192);
  await button('Remove', stages.nth(0)).click();
  await button('Analyze processed selection').click();
  await page.waitForFunction(() => document.querySelector('.ww-sampler-analysis').textContent.includes('MIDI 69'));
  const analysis = await page.locator('.ww-sampler-analysis').textContent();
  assert.match(analysis, /RMS.*Clipped frames 0/);
  await set('Fade out (ms)', 5000);
  assert.match(await page.evaluate(() => errors.pop()), /fit/);
  assert.equal(await page.getByLabel('Fade out (ms)').inputValue(), '100');
  await add('granular');
  await set('Position curve (0–1, comma separated)', '0.1,0.5,0.9');
  assert.deepEqual(await page.evaluate(() => draft.recipe.at(-1).positions), [.1,.5,.9]);
  await add('normalizeRms');
  await set('RMS target (dBFS)', -12);
  await button('Listen after', stages.last()).click();
  await page.waitForFunction(() => document.querySelector('.ww-sampler-stage-status').textContent.includes('After stage 3'));
  assert.deepEqual(await page.evaluate(() => errors), []);
  console.log('PASS 13 operation types, parameter edits, independent stage ordering, bypass, removal, real before/after PCM, analysis, granular curve, normalized preview and snapshot waveform');
} finally { await browser.close(); }
