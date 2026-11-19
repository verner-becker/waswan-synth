/* SPDX-License-Identifier: GPL-3.0-only
 * PCM adaptation of FMEL-1 / AntonioAltea, SMKTRON mel.c head_run(),
 * revision 342861317896d316f44e1da66e3dfd2b7bf273ab. See the milestone report.
 * This header is compiled only in the isolated milestone A host.
 */
#define PROBE_MAX_FRAMES (44100u * 2u)
static int16_t probe_pcm[PROBE_MAX_FRAMES];
static uint32_t probe_frames, probe_root_inc;
static struct { uint64_t phase; uint32_t seq; } probe_heads[NV];

/* One immutable mono sample per boot. Installation happens before rendering. */
__attribute__((visibility("default"))) int16_t *waswan_probe_pcm(void) { return probe_pcm; }
__attribute__((visibility("default"))) uint32_t waswan_probe_install(uint32_t frames, uint32_t root) {
    if (probe_frames || frames < 4 || frames > PROBE_MAX_FRAMES || root > 127) return 0;
    probe_root_inc = pitch_inc(root * 256);
    probe_frames = frames;
    return 1;
}

/* Four-point Hermite from head_run. Input is random-access PCM, so the Q16
 * cursor can skip directly over frames at high transpositions. */
static int32_t probe_sample(uint32_t at, int32_t t) {
    int32_t a = probe_pcm[at ? at - 1 : 0], b = probe_pcm[at];
    int32_t c = at + 1 < probe_frames ? probe_pcm[at + 1] : 0;
    int32_t d = at + 2 < probe_frames ? probe_pcm[at + 2] : 0;
    int32_t c1 = (c - a) >> 1;
    int32_t c2 = a - ((5 * b) >> 1) + 2 * c - (d >> 1);
    int32_t c3 = ((d - a) >> 1) + ((3 * (b - c)) >> 1);
    return ((((((c3 * t) >> 12) + c2) * t >> 12) + c1) * t >> 12) + b;
}

static void probe_render(voice_t *v, int32_t *out) {
    unsigned slot = v - vc;
    if (probe_heads[slot].seq != v->seq) {
        probe_heads[slot].phase = 0;
        probe_heads[slot].seq = v->seq;
    }
    uint64_t phase = probe_heads[slot].phase;
    uint64_t step = ((uint64_t)pitch_inc(v->fm_pitch8) << 16) / probe_root_inc;
    for (unsigned i = 0; i < CTL; i++) {
        int32_t y = 0;
        if ((phase >> 16) < probe_frames) {
            y = probe_sample(phase >> 16, (phase & 65535) >> 4);
            phase += step;
        }
        int32_t amp = v->amp0 + ((v->amp1 - v->amp0) * (int32_t)i) / (int32_t)CTL;
        voice_mix_sample(v, (int32_t)(((int64_t)y * amp) >> 15), out + 2 * i);
    }
    probe_heads[slot].phase = phase;
}
