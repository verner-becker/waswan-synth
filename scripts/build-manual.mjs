// SPDX-License-Identifier: GPL-3.0-only
// Rebuild the root PDF from its editable HTML, using the project's existing Chrome setup.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(pathToFileURL(path.join(root,'.tools/browser/node_modules/playwright/index.mjs')));
const evidence=path.join(root,'.local/validation/manual');await fs.mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.WASWAN_CHROME||'/usr/bin/google-chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:658,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(path.join(root,'docs/manual-waswan-synth.html')).href);
 await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);
 const layout=await page.evaluate(()=>{
  const pages=[...document.querySelectorAll('.page')];
  return {pages:pages.length,sections:pages.map(section=>({page:Number(section.dataset.page),title:section.querySelector('h1').textContent,height:section.clientHeight,contentHeight:section.scrollHeight,overflow:section.scrollHeight-section.clientHeight})),images:[...document.images].map(img=>({src:img.getAttribute('src'),loaded:img.complete&&img.naturalWidth>0})),badLinks:[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.hash)};
 });
 await fs.writeFile(path.join(evidence,'layout.json'),JSON.stringify({...layout,chrome:await browser.version(),errors},null,2));
 const overflow=layout.sections.filter(p=>p.overflow>2);
 if(overflow.length||layout.images.some(img=>!img.loaded)||layout.badLinks.length||errors.length)throw Error('Manual validation failed: '+JSON.stringify({overflow,images:layout.images.filter(img=>!img.loaded),badLinks:layout.badLinks,errors}));
 const pdf=path.join(root,'MANUAL-WASWAN-SYNTH.pdf');
 await page.pdf({path:pdf,format:'A4',preferCSSPageSize:true,printBackground:true,tagged:true,outline:true,displayHeaderFooter:true,headerTemplate:'<div style="font-family:Arial,sans-serif;font-size:8px;color:#627780;width:100%;margin:0 18mm;display:flex;justify-content:space-between"><span>WASWAN SYNTH · MANUAL DE USO</span><span>PT-BR · Synth, Studio e DAW</span></div>',footerTemplate:'<div style="font-family:Arial,sans-serif;font-size:8px;color:#627780;width:100%;margin:0 18mm;display:flex;justify-content:space-between"><span>Aprender · tocar · avaliar</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'});
 console.log(JSON.stringify({result:'PASS',pdf,pages:layout.pages,images:layout.images.length,chrome:await browser.version(),errors}));
}finally{await browser.close();}
