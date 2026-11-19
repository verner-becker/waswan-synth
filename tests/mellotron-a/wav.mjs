// SPDX-License-Identifier: GPL-3.0-only
import {readSample as readMono} from '../../web/mellotron-wav.js';
export const maxFrames = 2 * 44100;
export const readSample = (file,root) => readMono(file,root,2);
