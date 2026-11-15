/* SPDX-License-Identifier: GPL-3.0-only */
/* Host-only extension: original simulator and DSP remain in the pinned submodule. */
#ifndef WASWAN_SIM_SOURCE
#define WASWAN_SIM_SOURCE "../upstream/SMKSYNTH/web/sim/sim.c"
#endif
#ifndef WASWAN_VOICES
#define WASWAN_VOICES 8
#endif
#include WASWAN_SIM_SOURCE

_Static_assert(WASWAN_VOICES == 8 || WASWAN_VOICES == 16 || WASWAN_VOICES == 32, "Only the stages through thirty-two voices are approved");
_Static_assert(NV == WASWAN_VOICES, "Source must match the selected stage");
_Static_assert(NV <= 32u, "group_pick uses a 32-bit taken mask");
_Static_assert(NV <= NHELD, "Held-note capacity must cover the voice pool");
_Static_assert(NQ >= 2u*NV+2u, "Engine queue must hold a full on/off chord and sustain changes");
_Static_assert(sizeof mq / sizeof mq[0] >= 2u*NV+2u, "MIDI queue must hold a full on/off chord and sustain changes");
_Static_assert(SUPER_LIMIT == 5u, "Preserve the independent SUPER limit");

EXPORT uint32_t waswan_voice_limit(void) { return NV; }
EXPORT uint32_t waswan_unison_limit(void) { return PDEF[P_UNI_N].max; }
EXPORT uint32_t waswan_voice_state_bytes(void) { return sizeof vc + sizeof grp_v + sizeof obv_voice_engine + sizeof ui_vlevel + sizeof ui_vnote + sizeof super_state + sizeof super_plain_state; }
EXPORT uint32_t waswan_held_limit(void) { return NHELD; }
EXPORT uint32_t waswan_event_limit(void) { return NQ; }
EXPORT uint32_t waswan_midi_event_limit(void) { return sizeof mq / sizeof mq[0]; }
EXPORT uint32_t waswan_held_state_bytes(void) { return sizeof held + sizeof obv_pending; }
EXPORT uint32_t waswan_queue_bytes(void) { return sizeof nq + sizeof mq; }
EXPORT uint32_t waswan_internal_frames(void) { return HALF_FRAMES; }
EXPORT uint32_t waswan_parameter_count(void) { return NPARAM; }
EXPORT uint32_t waswan_mode(uint32_t p) { return p < NPART ? live_p[p].v[P_MODE] : 0u; }
EXPORT uint32_t waswan_unison(uint32_t p) { return p < NPART ? live_p[p].v[P_UNI_N] : 0u; }
EXPORT uint32_t waswan_arp(uint32_t p) { return p < NPART ? live_p[p].v[P_ARP_MODE] : 0u; }
EXPORT uint32_t waswan_sustain(uint32_t p) { return p < NPART ? !!part_sus(p) : 0u; }
EXPORT uint32_t waswan_midi_sustain(void) { return !!midi_sustain; }
EXPORT void waswan_set_sustain(uint32_t enabled) { if (enabled <= 1u && !mm_on) { midi_sustain = enabled; sustain_apply(); } }
EXPORT uint32_t waswan_held(uint32_t p) { return p < NPART ? nheld[p] : 0u; }
EXPORT uint32_t waswan_part_limit(uint32_t p) { return p < NPART ? (super_part(p) ? SUPER_LIMIT : NV) : 0u; }
EXPORT uint32_t waswan_voice(uint32_t i, uint32_t field)
{
    if (i >= NV) return 0;
    const voice_t *v = &vc[i];
    switch (field) {
    case 0: return v->gate || v->ae.stage != E_IDLE;
    case 1: return !!v->gate;
    case 2: return v->note;
    case 3: return v->part;
    case 4: return v->ae.stage;
    case 5: return v->seq;
    case 6: return v->seq_owned;
    default: return 0;
    }
}
EXPORT uint32_t waswan_set_mode(uint32_t p, uint32_t mode)
{
    if (p >= NPART || mode > M_MONO || mm_on || obv_patch_engine(&live_p[p]) != OBV_ANALOG) return 0;
    /* Same parameter setter as the original editor; no preset replacement/save. */
    set_param_in(&live_p[p], P_MODE, (int32_t)mode);
    dirty_hdr = dirty_page = dirty_tags = 1;
    return 1;
}
EXPORT uint32_t waswan_set_unison(uint32_t p, uint32_t count)
{
    if (p >= NPART || count < 1u || count > PDEF[P_UNI_N].max || mm_on || obv_patch_engine(&live_p[p]) != OBV_ANALOG) return 0;
    set_param_in(&live_p[p], P_UNI_N, (int32_t)count);
    dirty_hdr = dirty_page = dirty_tags = 1;
    return 1;
}
