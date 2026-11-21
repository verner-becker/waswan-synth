# WASWAN Sample Lab

Use **Sampler Studio → Sample Lab** with a WAV or Working Copy open. For a long recording, select up to 16 seconds in Sample Editor first. The last step of the Auto Instrument Wizard offers **Finish & Play** to save its proposals and continue playing, and **Refine in Sample Lab** to open one prepared Working Copy with its root, envelope and loop. The Lab opens without changing the keyboard route.

**Envelope Designer** edits the selected region in the existing instrument model. Drag the curve or use the logarithmic sliders and precise millisecond fields. Playback in Gate mode follows Note Off. A loop repeats the waveform to support sustained notes. The loop reader does not jump to the recorded material beyond the loop when a key is released. The amplitude release fades the sound being played.

**Sustain & Loop** displays sample frame coordinates and their corresponding times. Move either boundary on the waveform or enter exact frames. Optimize Loop ranks up to three forward candidates. It looks at waveform and slope across the join, edge RMS and harmonic balance, pitch stability where detectable and energy ripple across repeated cycles at transposed rates. Measure Loop also supports reverse and ping-pong. Candidate measurements estimate the loop in a Worker. The performance capture exercises the actual WASM Hermite reader.

**Performance Test** provides sustained notes up to two octaves from the root within the mapped range, a four-note chord when the range permits it, short notes, velocity steps and a release test. Release the keyboard keys and pedal before starting a dry test. The test borrows the idle shared host and captures the unity-gain DAW mixer before WAV encoding, with no track or master effects. Listen to or download the resulting WAV. The pre-encoding peak can exceed full scale even though PCM16 in the file is clipped. A sample step or an over-range peak cannot determine whether aliasing occurred. The four-voice estimate assumes equal peaks aligned in phase and omits modulation and additional regions. The Wizard starts with a −15 dBFS source peak target per voice. The Lab can apply a conservative region gain and leaves the adjustment editable.

**Apply to Working Copy** adds the map edit to the existing Undo history. **Save Working** persists the Working Copy and materializes any pending excerpt. **Promote to Official** uses the existing preflight and requires an explicit action. The Instrument Builder can edit the resulting ADSR, map and loop. Audio sources keep their existing hashes and provenance.

## Entrega 1 validation

The deterministic fixtures cover sine plus harmonics, an attack followed by silence, periodic amplitude modulation, incompatible loop boundaries, stereo channel peaks and over-range summation. The Chrome test enters from the Wizard, auditions via simulated Web MIDI, checks held-note navigation, captures a chord through the real audio path and verifies the saved map. Its synthetic chord captured 83,790 frames and a −5.3 dBFS stereo peak with zero over-range values. The measured release above −60 dBFS was 190 ms. The test counted one AudioContext and one WASM host.

Evidence and captured WAVs are local under `.local/validation/sample-lab/`. Browser tests use OPFS for the destination. The controller and physical listening are reserved for owner acceptance.

```sh
node tests/sampler-studio/sample-lab.test.mjs
node tests/sampler-studio/browser-sample-lab.mjs
```

The supplied vocal recording produced a four-note dry peak of −6.5 dBFS on both channels, 3.52 dB of held RMS variation and a 189 ms tail above −60 dBFS. The Suno export produced −7.2 dBFS left and −11.3 dBFS right. Both captures had zero over-range values. The guitar preset replayed a one-shot and still had signal at the end of the test capture. This source contains the recorded mix, including accompaniment. The Lab works with the selected interval of that mix.
