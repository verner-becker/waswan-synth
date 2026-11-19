/* SPDX-License-Identifier: GPL-3.0-only */
/* Web patch extension v1. All legacy parameter, name and octave offsets stay fixed.
 * The six-byte tail is shared with SS1. Preserve both SUPER mix knobs on promotion.
 * Byte 0: tag. Bytes 1/2: SUPER mix in bits 0..6, semitone bit 4 in bit 7.
 * Bytes 3/4: wave (3 low bits) and level (5 high bits). Byte 5: pitch low nibbles. */
#define WASWAN_OSC_BANK 1
#define OSC_TAIL_TAG 0xA4u
enum { O_TRI = NWAVE, O_SHARK, O_SQUARE, O_WIDE, O_NARROW, O_SINE, O_REVERSE };
enum { EXTRA_WAVE, EXTRA_LEVEL, EXTRA_TUNE, EXTRA_FIELDS };
enum { EXTRA_CENTER = 15, EXTRA_DEFAULT_LEVEL = 24 };
static const char *const poly_wave_names[] = {
    "TRIANGLE", "TRI/SAW", "SQUARE", "WIDE PULSE", "NARROW PULSE", "SINE", "REVERSE SAW"
};
/* Native panel labels have a seven-character budget. */
static const char *const poly_wave_short[] = {"TRI", "TRI/SAW", "SQUARE", "WIDE", "NARROW", "SINE"};
static const uint8_t extra_waves[2][8] = {
    {W_OFF, W_SAW, O_TRI, O_SHARK, O_SQUARE, O_WIDE, O_NARROW, O_SINE},
    {W_OFF, W_SAW, O_TRI, O_REVERSE, O_SQUARE, O_WIDE, O_NARROW, O_SINE}
};
static uint32_t extra_field(const patch_t *patch, unsigned osc, unsigned field)
{
    const uint8_t *t = patch->v + OBV_ENGINE_TAG_AT;
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
    if (field == EXTRA_WAVE) t[3 + osc] = (t[3 + osc] & 0xf8) | value;
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
