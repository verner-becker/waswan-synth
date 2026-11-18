// SPDX-License-Identifier: GPL-3.0-only
export const synthButton=(page,name)=>page.getByRole('button',{name,exact:true});

export async function startSynth(page,{connect=false}={}){
  await synthButton(page,'Start audio').click();
  const setup=page.locator('.ww-midi-setup');
  await setup.waitFor();
  if(connect)await setup.getByRole('button',{name:'Connect MIDI keyboard',exact:true}).click();
  await setup.locator('.ww-midi-continue').click();
  await page.waitForFunction(()=>audit.frame?.ms>5000);
}

export async function synthSettings(page){
  if(!await page.locator('#ww-settings').isVisible())await synthButton(page,'Settings').click();
}

export async function synthDiagnostics(page,{voice=false}={}){
  if(!await page.locator('[data-view="diag"]').isVisible()){
    await synthSettings(page);
    await synthButton(page,'Diagnostics').click();
  }
  if(voice&&!await page.locator('.ww-voice-details').evaluate(e=>e.open))await page.locator('.ww-voice-details summary').click();
}

export async function openAssignment(page,target){
  await synthSettings(page);
  await page.getByLabel('MIDI assignment destination',{exact:true}).selectOption(target);
  await synthButton(page,'Assign selected control').click();
  return page.locator('.ww-map-dialog[open]');
}

export async function openStudioComposer(page){
  await synthButton(page,'Quick capture').click();
  const original=page.locator('.ww-studio-compatibility');
  if(!await original.evaluate(node=>node.open))await original.locator('summary').click();
  await synthButton(page,'Open Studio composition editor').click();
}
