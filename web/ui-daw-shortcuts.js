// SPDX-License-Identifier: GPL-3.0-only
const shortcuts=[
  ['Space','Play or stop'],['Ctrl / Cmd + S','Save project'],
  ['Ctrl / Cmd + Z','Undo'],['Ctrl / Cmd + Shift + Z','Redo'],
  ['Delete','Delete selected clips or notes'],['L','Toggle loop'],['M','Toggle metronome'],['?','Show shortcuts'],
  ['Home on the timeline','Return to start'],
  ['Arrow keys in Piano Roll','Move or transpose selected notes. Shift changes duration or octave. Alt + ↑/↓ changes velocity.'],
  ['Shift + drag in Piano Roll','Select notes in a rectangle. Click a piano key to audition.'],
  ['Arrow keys on a divider','Resize the panel. Home restores its default size.'],
  ['Alt + ↑/↓ on a track handle','Move the track up or down']
];
export function shortcutHelp(doc){
  const dialog=doc.createElement('dialog');
  dialog.className='ww-map-dialog';
  const heading=doc.createElement('h2');
  heading.textContent='DAW shortcuts';
  dialog.setAttribute('aria-label',heading.textContent);
  const list=doc.createElement('dl');
  for(const [key,label] of shortcuts){
    const term=doc.createElement('dt'),description=doc.createElement('dd');
    term.textContent=key;description.textContent=label;list.append(term,description);
  }
  const close=doc.createElement('button');
  close.type='button';close.textContent='Close shortcuts';close.onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.append(heading,list,close);doc.body.append(dialog);dialog.showModal();
}
export function dawShortcut(w,event){
  if(event.defaultPrevented||event.repeat||event.altKey||
    event.target.closest?.('input, textarea, select, dialog, [contenteditable]:not([contenteditable=false])'))return;
  const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;
  const doc=event.target.ownerDocument||document;
  let command;
  if(mod){
    if(key==='s')command=()=>{if(!w.saveButton.disabled)void w.run(()=>w.saveProject({source:doc.defaultView}));};
    if(key==='z')command=()=>{(event.shiftKey?w.redo:w.undo).click();};
  }else if(event.code==='Space'&&!event.target.closest?.('button')){
    command=()=>{(w.player.playing||w.player.starting||w.recorder.busy||w.audition.busy?w.stop:w.play).click();};
  }else if(key==='l')command=()=>w.layout.loop.click();
  else if(key==='m')command=()=>w.click.click();
  else if(key==='delete')command=()=>w.clipTools.remove.click();
  else if(key==='?')command=()=>shortcutHelp(doc);
  if(command){event.preventDefault();event.stopPropagation();command();}
}
