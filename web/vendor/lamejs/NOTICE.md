# LAME / lamejs

WASWAN uses LAME through the unmodified, readable JavaScript encoder lamejs by Alex Zhukov and contributors, derived from jump3r/libmp3lame.

- Project: https://github.com/zhuker/lamejs
- LAME: https://lame.sourceforge.net/
- Package version: 1.2.1; license declaration: LGPL-3.0.
- Pinned source commit: `582bbba6a12f981b984d8fb9e1874499fed85675`.
- `lame.all.js` is copied byte-for-byte from that commit, linked as a separate file, without modifications.
- `UPSTREAM-LICENSE.txt` preserves the upstream notice. Full GNU LGPL v3 and GPL v3 texts are included alongside it.
- `source-582bbba6.tar.gz` contains the upstream `src/`, build scripts, package metadata, license and README needed to inspect/modify/rebuild the encoder. The complete repository, including example audio fixtures, is available at the pinned commit above.

The MP3 worker loads this file from the local application only. It does not upload audio or fetch a codec from a CDN. Users may replace the separate encoder file subject to its interface and license. The application does not prohibit modification or reverse engineering for debugging such modifications.

Upstream `makeall.sh` assembles the readable bundle using Browserify and the JS sources; its optional final minification step uses the Google Closure Compiler. WASWAN ships the readable bundle and does not run the upstream build or install its npm dependencies at runtime.
