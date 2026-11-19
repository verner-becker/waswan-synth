/* SPDX-License-Identifier: GPL-3.0-only */
/* Web patch extension v1. All legacy parameter, name and octave offsets stay fixed.
 * The six-byte tail is shared with SS1. Preserve both SUPER mix knobs on promotion.
 * Byte 0: tag. Bytes 1/2: SUPER mix in bits 0..6, semitone bit 4 in bit 7.
 * Bytes 3/4: wave (3 low bits) and level (5 high bits). Byte 5: pitch low nibbles. */
#define WASWAN_OSC_BANK 1
#define OSC_TAIL_TAG 0xA4u
enum { O_TRI = NWAVE, O_SHARK, O_SQUARE, O_WIDE, O_NARROW, O_SINE, O_REVERSE };
enum { EXTRA_WAVE, EXTRA_LEVEL, EXTRA_TUNE, EXTRA_FINE, EXTRA_WIDTH, EXTRA_FIELDS };
enum { EXTRA_CENTER = 15, EXTRA_DEFAULT_LEVEL = 24 };
static const char *const poly_wave_names[] = {
    "TRIANGLE", "TRI/SAW", "SQUARE", "WIDE PULSE", "NARROW PULSE", "SINE", "REVERSE SAW"
};
/* Native panel labels have a seven-character budget. */
static const char *const poly_wave_short[] = {"TRI", "TRI/SAW", "SQUARE", "WIDE", "NARROW", "SINE"};
static const uint8_t extra_waves[2][9] = {
    {W_OFF, W_SAW, O_TRI, O_SHARK, O_SQUARE, O_WIDE, O_NARROW, O_SINE, W_PLS},
    {W_OFF, W_SAW, O_TRI, O_REVERSE, O_SQUARE, O_WIDE, O_NARROW, O_SINE, W_PLS}
};
static uint32_t extra_field(const patch_t *patch, unsigned osc, unsigned field)
{
    const uint8_t *t = patch->v + OBV_ENGINE_TAG_AT;
    if (field == EXTRA_FINE) return (patch->osc[osc].fine ^ 64u);
    if (field == EXTRA_WIDTH) return (patch->osc[osc].width & 127u) ^ 64u;
    if (field == EXTRA_WAVE && (patch->osc[osc].width & 128u)) return 8;
    if (t[0] != OSC_TAIL_TAG)
        return field == EXTRA_WAVE ? 0 : field == EXTRA_LEVEL ? EXTRA_DEFAULT_LEVEL : EXTRA_CENTER;
    if (field == EXTRA_WAVE) return t[3 + osc] & 7;
    if (field == EXTRA_LEVEL) return t[3 + osc] >> 3;
    return ((t[5] >> (4 * osc)) & 15u) | ((t[1 + osc] >> 3) & 16u);
}
static uint32_t patch_super_mix(const patch_t *p, uint32_t osc);
static void extra_set(patch_t *patch, unsigned osc, unsigned field, unsigned value)
{
    uint8_t *t = patch->v + OBV_ENGINE_TAG_AT;
    if (t[0] != OSC_TAIL_TAG) {
        uint8_t mix1 = patch_super_mix(patch, 0), mix2 = patch_super_mix(patch, 1);
        t[0] = OSC_TAIL_TAG;
        t[1] = mix1;
        t[2] = mix2;
        t[3] = t[4] = EXTRA_DEFAULT_LEVEL << 3;
        t[5] = 0xff; /* both at concert pitch */
    }
    if (field == EXTRA_FINE) patch->osc[osc].fine = value ^ 64u;
    else if (field == EXTRA_WIDTH) patch->osc[osc].width = (patch->osc[osc].width & 128u) | (value ^ 64u);
    else if (field == EXTRA_WAVE) {
        patch->osc[osc].width = (patch->osc[osc].width & 127u) | (value == 8 ? 128u : 0u);
        t[3 + osc] = (t[3 + osc] & 0xf8) | (value & 7u);
    }
    else if (field == EXTRA_LEVEL) t[3 + osc] = (t[3 + osc] & 7) | (value << 3);
    else {
        unsigned shift = 4 * osc;
        t[5] = (t[5] & ~(15u << shift)) | ((value & 15) << shift);
        t[1 + osc] = (t[1 + osc] & 127) | ((value & 16) << 3);
    }
}
static unsigned analog_patch_max(const patch_t *patch, unsigned p)
{
    if ((p == P_O1_WAVE || p == P_O2_WAVE) && obv_patch_engine(patch) == OBV_ANALOG)
        return O_SINE;
    return obv_param_max(patch, p);
}

/* Wire v2 keeps the 80-byte record and the name/engine offsets. Each of the
 * five ANALOG selectors below occupies at most two bits. Only wire records
 * tagged A5 carry the 30 extra bits above these selectors. DSP and native
 * controls always see ordinary parameter bytes. Zero deviations encode v1. */
#define OSC_WIRE_V2 0xA5u
static const uint8_t osc_carriers[5] = {P_SYNC, P_LFO_PHASE, P_LFO_PITCH_TO, P_LFO_PWM_TO, P_MODE};
static uint32_t osc_payload(const patch_t *p)
{
    if (p->v[OBV_ENGINE_TAG_AT] != OSC_TAIL_TAG) return 0;
    return (uint32_t)p->osc[0].fine | ((uint32_t)p->osc[0].width << 7)
        | ((uint32_t)p->osc[1].fine << 15) | ((uint32_t)p->osc[1].width << 22);
}
static wire_patch_t patch_pack(const patch_t *p)
{
    wire_patch_t wire;
    memcpy(wire.v, p->v, PATCH_BYTES);
    uint32_t bits = osc_payload(p);
    if (bits) {
        wire.v[OBV_ENGINE_TAG_AT] = OSC_WIRE_V2;
        for (unsigned i = 0; i < 5; ++i, bits >>= 6)
            wire.v[osc_carriers[i]] |= (bits & 63u) << 2;
    }
    return wire;
}
static patch_t patch_unpack(const wire_patch_t *wire)
{
    patch_t p = {0};
    memcpy(p.v, wire->v, PATCH_BYTES);
    if (p.v[OBV_ENGINE_TAG_AT] == OSC_WIRE_V2) {
        uint32_t bits = 0;
        p.v[OBV_ENGINE_TAG_AT] = OSC_TAIL_TAG;
        for (unsigned i = 0; i < 5; ++i) {
            unsigned id = osc_carriers[i];
            bits |= (uint32_t)(p.v[id] >> 2) << (6 * i);
            p.v[id] &= 3;
        }
        p.osc[0].fine = bits & 127;
        p.osc[0].width = bits >> 7;
        p.osc[1].fine = (bits >> 15) & 127;
        p.osc[1].width = bits >> 22;
    }
    return p;
}
