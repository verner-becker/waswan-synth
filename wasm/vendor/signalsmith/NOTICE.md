# Signalsmith Stretch

- `signalsmith-stretch.h` is Signalsmith Stretch 1.3.2 at [88061fd](https://github.com/Signalsmith-Audio/signalsmith-stretch/tree/88061fd4eda56a2353c5d65c74aa3f4ccf76f9da). License in Stretch-MIT.txt.
- `signalsmith-linear/{stft,fft}.h` are the required Signalsmith Linear 0.6.6 headers at [7bb1c8f](https://github.com/Signalsmith-Audio/linear/tree/7bb1c8f36794d6980080ce817c91f8da8fe56a66). License in Linear-MIT.txt.

The headers are unmodified. WASWAN's corresponding integration sources are `wasm/sampler-pitch.cpp`, `scripts/build-sampler-pitch.sh` and `web/sampler-signalsmith.js`. Zig 0.15.1 supplies the [LLVM compiler runtime and libc++](https://llvm.org/LICENSE.txt) and [wasi-libc](https://github.com/WebAssembly/wasi-libc/blob/main/LICENSE).
