// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';

const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome'});
try {
  const page = await browser.newPage({viewport: {width: 1000, height: 720}});
  const base = process.env.SAMPLER_BROWSER_URL || 'http://localhost:8737/simulator/';
  await page.goto(new URL('sampler-wav.js', base).href);
  await page.setContent('<link rel="stylesheet" href="ui-sampler-waveform.css"><main hidden></main>');
  await page.evaluate(async () => {
    const {createSamplerWaveform} = await import('./ui-sampler-waveform.js');
    const {encodeSample} = await import('./sampler-offline.js');
    const {inspectWav, decodeWav} = await import('./sampler-wav.js');
    const source = new File([encodeSample({sampleRate: 48000, channels: 2,
      pcm: Float32Array.from({length: 288000}, (_, i) => i % 2 === 0 ? .45 : -.2)})], 'Take.wav');
    window.selections = [];
    const context = new AudioContext();
    const gain = context.createGain();
    gain.connect(context.destination);
    window.editor = createSamplerWaveform({
      getAudio: () => ({context, gain}),
      onSelection: range => selections.push(range),
      onCrop: async ({file, start, end}) => {
        const {pcm} = await decodeWav(file, {anyRate: true});
        window.crop = {layout: await inspectWav(file, {anyRate: true}), start, end, pcm: [...pcm.slice(0, 4)]};
      }
    });
    document.querySelector('main').append(editor.node);
    await editor.open(source, {selection: {start: 24000, end: 96000}});
    document.querySelector('main').hidden = false;
  });
  const canvas = page.locator('canvas');
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    if (c.width !== c.clientWidth) return false;
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 118 && pixels[i + 1] === 220) return true;
    return false;
  });
  assert.equal(await page.getByLabel('Start frame').inputValue(), '24000');
  assert.deepEqual(await page.evaluate(() => selections), []);
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .70, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .30, box.y + 15);
  await page.mouse.up();
  const mouseRange = await page.evaluate(() => selections.at(-1));
  assert(Math.abs(mouseRange.start - .30 * 144000) < 180);
  assert(Math.abs(mouseRange.end - .70 * 144000) < 180);
  await page.getByRole('button', {name: 'Zoom to selection'}).click();
  await page.waitForFunction(() => !document.querySelector('canvas').hasAttribute('aria-busy'));
  assert(await page.getByRole('button', {name: 'Fit file'}).isEnabled());
  await page.getByRole('button', {name: 'Fit file'}).click();
  await page.getByLabel('Selection unit').selectOption('seconds');
  for (const [label, value] of [['Start seconds', '0.5'], ['End seconds', '2.5']]) {
    const input = page.getByLabel(label);
    await input.fill(value);
    await input.press('Tab');
  }
  assert.deepEqual(await page.evaluate(() => editor.getSelection()), {start: 24000, end: 120000, sampleRate: 48000});
  await page.getByRole('button', {name: 'Preview selection'}).click();
  await page.getByText('Playing selection.', {exact: true}).waitFor();
  await page.getByRole('button', {name: 'Stop preview'}).click();
  assert(await page.getByRole('button', {name: 'Stop preview'}).isDisabled());
  await page.getByRole('button', {name: 'Create Sample from Selection'}).click();
  await page.waitForFunction(() => window.crop);
  const result = await page.evaluate(() => crop);
  assert.equal(result.layout.frames, 96000);
  assert.equal(result.layout.channels, 2);
  assert.deepEqual(result.pcm, [14746, -6554, 14746, -6554]);
  const failed = await page.evaluate(async () => {
    try { await editor.open(new Blob(['oops'])); }
    catch (error) { return {message: error.message, selected: editor.getSelection()}; }
  });
  assert.match(failed.message, /header/);
  assert.deepEqual(failed.selected, {start: 24000, end: 120000, sampleRate: 48000});
  console.log('PASS hidden view resize, silent restore, reverse mouse drag, zoom, seconds input, bounded audio preview/stop, cropped stereo PCM, error preserves selection');
} finally { await browser.close(); }
