// SPDX-License-Identifier: GPL-3.0-only
import {checkCapture} from '../mellotron-capture.mjs';
import {chromium} from '../../.tools/browser/node_modules/playwright/index.mjs';
import {directory, fileName, writeFixture} from './fixture.mjs';

writeFixture();
const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1600,height:1100}}), errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.addInitScript(()=>{
    window.audit={contexts:0};
    const Context=window.AudioContext;
    window.AudioContext=class extends Context {constructor(...args){super(...args);audit.contexts++;}};
  });
  await page.goto('http://localhost:8737/mellotron-a/');
  await page.locator('#wav').setInputFiles(fileName);
  await page.getByRole('button',{name:'Load instrument'}).click();
  await page.frameLocator('iframe').getByRole('button',{name:'Start audio',exact:true}).click();
  const frame=page.frames().find(f=>f.url().includes('/mellotron-a/simulator/'));
  await frame.locator('.ww-midi-continue').click();
  await checkCapture(frame,browser,directory,errors);
} finally {await browser.close();}
