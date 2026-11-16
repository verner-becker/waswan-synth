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
  constructor(controller,panel) {
    this.panel=panel;panel.setAttribute('aria-label','MIDI input');this.home=document.createComment('MIDI controls in Settings');panel.before(this.home);
    this.dialog=el('dialog','ww-map-dialog ww-midi-setup');this.dialog.setAttribute('aria-labelledby','ww-midi-setup-title');
    const title=el('h2','','MIDI Setup');title.id='ww-midi-setup-title';
    this.dialog.append(title,el('p','ww-muted','Choose your MIDI input, or continue with the virtual keyboard and pads.'));
    this.ok=action('OK',()=>this.dialog.close(),'ww-primary');this.ok.autofocus=true;this.dialog.append(this.ok);
    this.dialog.addEventListener('close',()=>{this.home.after(panel);});
    document.body.append(this.dialog);
    panel.querySelector('#midiConnect').textContent='Connect MIDI keyboard';
    const label=panel.querySelector('.midi-controls label');
    for(const node of label.childNodes)if(node.nodeType===Node.TEXT_NODE)node.textContent='MIDI Input ';
    panel.querySelector('#midiStatus').textContent=STATUS[!navigator.requestMIDIAccess||!isSecureContext?'unsupported':'choose'];
    panel.querySelector('.midi-help').textContent='Notes, velocity, sustain, pitch bend and modulation use the existing MIDI input. Your saved controller assignments are preserved.';
    const onStatus=controller.onStatus,onPorts=controller.onPorts;
    controller.onStatus=(code,name='')=>{onStatus(code,name);panel.querySelector('#midiStatus').textContent=(STATUS[code]??code)+(code==='connected'?name:'');};
    controller.onPorts=(ports,id)=>{onPorts(ports,id);this.labelEmptyOption();};
    this.labelEmptyOption();
  }
  labelEmptyOption() {const option=this.panel.querySelector('#midiInput option[value=""]');if(option)option.textContent='No MIDI input selected';}
  open() {if(this.dialog.open)return;this.dialog.insertBefore(this.panel,this.ok);this.dialog.showModal();}
  close() {if(this.dialog.open)this.dialog.close();}
}
