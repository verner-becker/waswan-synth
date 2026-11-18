// SPDX-License-Identifier: GPL-3.0-only
import {el,action} from './ui-primitives.js';

const STATUS={
  unsupported:'Web MIDI is unavailable. Use desktop Chrome on localhost or HTTPS.',
  permission:'Allow MIDI access in your browser.',choose:'Select a MIDI input.',
  empty:'No MIDI devices found. Connect a keyboard, or continue with the virtual keyboard and pads.',
  opening:'Connecting MIDI input…',connected:'MIDI input connected: ',off:'MIDI input disabled.',
  disconnected:'MIDI input disconnected. Notes released.',
  denied:'MIDI permission denied. You can continue with the virtual keyboard and pads.',
  error:'Unable to open the MIDI input. Check the device and try again.',
};

// A portal for the existing controls: one select, one controller, one device list.
export class MidiSetup {
  constructor(controller,panel,onVirtualKeyboard) {
    this.controller=controller;
    this.panel=panel;panel.setAttribute('aria-label','MIDI input');this.home=document.createComment('MIDI controls in Settings');panel.before(this.home);
    this.dialog=el('dialog','ww-map-dialog ww-midi-setup');this.dialog.setAttribute('aria-labelledby','ww-midi-setup-title');
    const title=el('h2','','MIDI Setup');title.id='ww-midi-setup-title';
    this.help=el('p','ww-muted');this.dialog.append(title,this.help);
    this.continueButton=action('',()=>this.dialog.close(this.keyboard&&!controller.input?'keyboard':''),'ww-primary ww-midi-continue');
    this.continueButton.autofocus=true;this.dialog.append(this.continueButton);
    this.dialog.addEventListener('close',()=>{
      this.home.after(panel);
      if(this.dialog.returnValue==='keyboard')onVirtualKeyboard();
    });
    document.body.append(this.dialog);
    panel.querySelector('#midiConnect').textContent='Connect MIDI keyboard';
    const label=panel.querySelector('.midi-controls label');
    for(const node of label.childNodes)if(node.nodeType===Node.TEXT_NODE)node.textContent='MIDI Input ';
    panel.querySelector('#midiStatus').textContent=STATUS[!navigator.requestMIDIAccess||!isSecureContext?'unsupported':'choose'];
    panel.querySelector('.midi-help').textContent='Notes, velocity, sustain, pitch bend and modulation use the existing MIDI input. Your saved controller assignments are preserved.';
    const onStatus=controller.onStatus,onPorts=controller.onPorts;
    controller.onStatus=(code,name='')=>{onStatus(code,name);panel.querySelector('#midiStatus').textContent=(STATUS[code]??code)+(code==='connected'?name:'');this.refreshContinue();};
    controller.onPorts=(ports,id)=>{onPorts(ports,id);this.labelEmptyOption();};
    this.labelEmptyOption();
  }
  labelEmptyOption() {const option=this.panel.querySelector('#midiInput option[value=""]');if(option)option.textContent='No MIDI input selected';}
  refreshContinue() {this.continueButton.textContent=this.controller.input?'Continue':this.keyboard?'Use keyboard & pads':'Continue without MIDI';}
  open({keyboard}) {
    if(this.dialog.open)return;
    this.keyboard=keyboard;
    this.help.textContent=keyboard?'Choose a MIDI input or play with the virtual keyboard and pads.':'Choose a MIDI input. You can also connect a controller later in Settings.';
    this.refreshContinue();this.dialog.returnValue='';
    this.dialog.insertBefore(this.panel,this.continueButton);this.dialog.showModal();
  }
  close() {if(this.dialog.open)this.dialog.close('');}
}
