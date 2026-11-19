/* SPDX-License-Identifier: GPL-3.0-only */
static int32_t drum_sine(uint32_t phase); /* shared interpolated Q15 table */
static inline int32_t analog_shape(uint32_t phase, unsigned shape)
{
    if (shape == O_SINE) return drum_sine(phase);
    int32_t saw = (int32_t)(phase >> 16) - 32768;
    if (shape == O_REVERSE) return -1 - saw;
    uint32_t folded = phase < 0x80000000u ? phase : ~phase;
    int32_t triangle = (int32_t)(folded >> 15) - 32768;
    if (shape == O_SHARK) return (saw + triangle) / 2;
    return triangle;
}
static inline int32_t analog_step(osc_t *osc, uint32_t inc, uint32_t d, uint32_t pw,
                                  unsigned wave, int32_t wrap, int32_t reset)
{
    if (wave < O_TRI) return osc_step(osc, inc, d, pw, wave, wrap, reset);
    if (wave >= O_SQUARE && wave <= O_NARROW) {
        uint32_t width = 0x80000000u >> (wave - O_SQUARE);
        return osc_step(osc, inc, d, width, OSC_PLS, -65536, reset);
    }
    uint32_t old = osc->ph, phase = old + inc;
    int32_t out = osc->prev;
    int32_t jump = wave == O_REVERSE ? 65536 : wave == O_SHARK ? -32768 : 0;
    int32_t cur;
    if (reset >= 0 && d) {
        uint32_t after = d * (uint32_t)reset, at = phase - after;
        cur = analog_shape(after, wave);
        if (jump && at < old)
            osc_event(&out, &cur, jump, clampi((int32_t)(at / d) + reset, 0, 32767));
        osc_event(&out, &cur, analog_shape(0, wave) - analog_shape(at, wave), reset);
        phase = after;
    } else {
        cur = analog_shape(phase, wave);
        if (jump && phase < inc && d) osc_event(&out, &cur, jump, (int32_t)(phase / d));
    }
    osc->ph = phase;
    osc->prev = cur;
    return out;
}

/* OSC3/4 only need a free-running phase. Specialize the short block once per
 * shape so the sample loop does not decode selectors or handle sync and FM. */
static inline __attribute__((always_inline)) void extra_render_shape(
    osc_t *osc, uint32_t step, int gain, unsigned wave, int32_t *mix)
{
    for (unsigned i = 0; i < CTL; i++)
        mix[i] += analog_step(osc, step, step >> 15, 0, wave, -65536, -1) * gain;
}
static void extra_render(osc_t *osc, uint32_t step, int gain, unsigned wave, uint32_t pw, int32_t *mix)
{
    switch (wave) {
    case W_PLS:
        for (unsigned i = 0; i < CTL; ++i)
            mix[i] += osc_step(osc, step, step >> 15, pw, OSC_PLS, -65536, -1) * gain;
        break;
    case W_SAW:     extra_render_shape(osc, step, gain, W_SAW, mix); break;
    case O_TRI:     extra_render_shape(osc, step, gain, O_TRI, mix); break;
    case O_SHARK:   extra_render_shape(osc, step, gain, O_SHARK, mix); break;
    case O_REVERSE: extra_render_shape(osc, step, gain, O_REVERSE, mix); break;
    case O_SQUARE:  extra_render_shape(osc, step, gain, O_SQUARE, mix); break;
    case O_WIDE:    extra_render_shape(osc, step, gain, O_WIDE, mix); break;
    case O_NARROW:  extra_render_shape(osc, step, gain, O_NARROW, mix); break;
    case O_SINE:    extra_render_shape(osc, step, gain, O_SINE, mix); break;
    }
}
