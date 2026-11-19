/* SPDX-License-Identifier: GPL-3.0-only */
#include "vendor/sloopdx/dx7_core.c"
_Static_assert(DX_N == CTL * 2, "two instrument ticks per DX7 block");
typedef struct {
    dxv_t core;
    int32_t samples[DX_N];
    uint32_t revision;
    uint8_t half, started, released, key, fade;
} fm_voice_t;
static fm_voice_t fm_voices[NV];
static struct {
    fm_patch_t cached;
    uint8_t voice[156];
    uint32_t revision;
} fm_parts[NPART];

static void fm_prepare(unsigned part, const fm_patch_t *fm) {
    if (!memcmp(&fm_parts[part].cached, fm, sizeof *fm)) return;
    int changed = memcmp(fm_parts[part].cached.bytes+FM_HEADER,fm->bytes+FM_HEADER,6*FM_OP_BYTES)
        || memcmp(fm_parts[part].cached.bytes,fm->bytes,3);
    fm_parts[part].cached = *fm;
    if (!changed) return;
    uint8_t *voice = fm_parts[part].voice;
    for (unsigned i=0; i<6; i++) {
        const uint8_t *src = fm->bytes + FM_HEADER + i*FM_OP_BYTES;
        uint8_t *op = voice + (5-i)*21;
        memcpy(op, src + FM_RATE1, 8);
        op[15] = src[FM_VELOCITY]; op[16] = src[FM_OUTPUT];
        op[17] = src[FM_MODE]; op[18] = src[FM_COARSE];
        op[19] = src[FM_FINE]; op[20] = src[FM_DETUNE];
    }
    memset(voice+130,50,4); /* neutral pitch envelope */
    voice[134] = fm->bytes[1]; voice[135] = fm->bytes[2];
    fm_parts[part].revision++;
}
static int fm_audio(voice_t *v, int32_t pitch8, int32_t *out) {
    unsigned part = v->part;
    fm_voice_t *fv = &fm_voices[v-vc];
    const uint8_t *voice = fm_parts[part].voice;
    if (!fv->started) {
        if (!v->gate) return 0;
        dx_init(&fv->core,voice,v->note,v->vel);
        fv->started = 1; fv->released = fv->half = 0; fv->fade = 64;
        fv->revision = fm_parts[part].revision; fv->key = v->note;
    } else if (fv->revision != fm_parts[part].revision || fv->key != v->note) {
        dx_update(&fv->core,voice,v->note,v->vel);
        fv->revision = fm_parts[part].revision; fv->key = v->note;
    }
    if (!v->gate && !fv->released) { dx_keyup(&fv->core); fv->released = 1; }
    if (!fv->fade) return 0;
    if (!fv->half) {
        memset(fv->samples,0,sizeof fv->samples);
        int32_t offset = (int32_t)(((int64_t)(pitch8 - v->note*256) * (1<<24)) / (12*256));
        dx_compute(&fv->core,fv->samples,offset);
    }
    for (unsigned i=0; i<CTL; i++) out[i] = clampi(fv->samples[fv->half*CTL+i] >> 11,-65535,65535);
    fv->half ^= 1;
    if (!fv->released) return 1;
    for (unsigned i=0; i<6; i++)
        if ((DX_ALG[fv->core.alg][i] & 3)==0 && fv->core.env[i].ix<4 && voice[i*21+16]) return 1;
    /* L4 can be nonzero. End the released voice with a short ramp once
     * every audible carrier has reached the end of its own release. */
    for (unsigned i=0; i<CTL; i++) out[i] = out[i]*fv->fade--/64;
    return fv->fade!=0;
}
