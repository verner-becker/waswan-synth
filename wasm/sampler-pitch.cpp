// SPDX-License-Identifier: GPL-3.0-only
#include "signalsmith-stretch.h"

#include <algorithm>
#include <cmath>
#include <vector>

extern "C" int shift_mono(const float *source, float *destination, int frames,
                         int rate, float semitones, float fundamental, int compensate) {
    if ((rate != 44100 && rate != 48000) || frames < rate/4 || frames > 16*rate ||
        !std::isfinite(semitones) || std::abs(semitones) > 3 ||
        !std::isfinite(fundamental) || fundamental < 45 || fundamental > 1800) return 1;

    signalsmith::stretch::SignalsmithStretch<float> stretch(79);
    stretch.presetDefault(1, rate);
    stretch.setTransposeSemitones(semitones);
    stretch.setFormantFactor(1, compensate != 0);
    stretch.setFormantBase(fundamental/rate);

    const int before = stretch.inputLatency(), after = stretch.outputLatency();
    std::vector<float> input(frames + before), output(frames + after);
    std::copy_n(source, frames, input.data());
    const float *in[] = {input.data()};
    stretch.seek(in, before, 1);
    for (int frame = 0; frame < frames; frame += 512) {
        int count = std::min(512, frames - frame);
        in[0] = input.data() + before + frame;
        float *out[] = {output.data() + frame};
        stretch.process(in, count, out, count);
    }
    float *tail[] = {output.data() + frames};
    stretch.flush(tail, after);
    std::copy_n(output.data() + after, frames, destination);
    return 0;
}
