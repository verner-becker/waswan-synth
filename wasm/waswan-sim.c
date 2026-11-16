/* SPDX-License-Identifier: GPL-3.0-only */
/* Host-only extension: original simulator and DSP remain in the pinned submodule. */
#ifndef WASWAN_SIM_SOURCE
#define WASWAN_SIM_SOURCE "../upstream/SMKSYNTH/web/sim/sim.c"
#endif
#ifndef WASWAN_VOICES
#define WASWAN_VOICES 8
#endif
#include WASWAN_SIM_SOURCE

_Static_assert(WASWAN_VOICES == 8 || WASWAN_VOICES == 16 || WASWAN_VOICES == 32 || WASWAN_VOICES == 64 || WASWAN_VOICES == 128 || WASWAN_VOICES == 256, "Only approved stages and the 256-voice experiment are supported");
_Static_assert(NV == WASWAN_VOICES, "Source must match the selected stage");
#if WASWAN_VOICES >= 64
_Static_assert(sizeof(voice_mask_t) * 8u >= NV, "The allocation mask must cover all voices");
#else
_Static_assert(NV <= 32u, "Original group_pick uses a 32-bit taken mask");
#endif
_Static_assert(NHELD >= (NV < 128u ? NV : 128u), "Held notes must cover the available MIDI pitches per part");
_Static_assert(NV <= 256u, "uint8 group indices must cover every voice");
_Static_assert(NHELD <= 255u, "Preserve uint8 held-release and pending counters");
_Static_assert(NQ >= 2u*NV+2u, "Engine queue must hold a full on/off chord and sustain changes");
_Static_assert(sizeof mq / sizeof mq[0] >= 2u*NV+2u, "MIDI queue must hold a full on/off chord and sustain changes");
_Static_assert(SUPER_LIMIT == 5u, "Preserve the independent SUPER limit");

EXPORT uint32_t waswan_voice_limit(void) { return NV; }
EXPORT uint32_t waswan_group_mask_bits(void) {
#if WASWAN_VOICES >= 64
    return sizeof(voice_mask_t) * 8u;
#else
    return 32u;
#endif
}
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

/* Host-only direct parameter editing. Never used by physical firmware or normal encoders. */
EXPORT uint32_t waswan_knob_context(void) { return smk_fader_context(); }
EXPORT int32_t waswan_knob_param(uint32_t k)
{
    if (k >= 4u || mm_on || preset_ui || pb_confirm || save_armed || layer || step_held >= 0 || seq_shown() || page >= NPAGE) return -1;
    if ((k == 3u && performance_transpose_control()) || page == PG_SUPER || page == PG_KEYBOARD ||
        page == PG_DSOUND || page == PG_MIXER || page == PG_DRIVE || page == PG_GLOBAL ||
        page == PG_THEME || page == PG_CONTROLS || page == PG_MIDI || (page == PG_ENGINE && k < 2u)) return -1;
    return obv_page_param(page,k);
}
EXPORT uint32_t waswan_knob_fine(uint32_t k, int32_t delta, uint32_t context)
{
    int32_t p = waswan_knob_param(k);
    if (p < 0 || !delta || delta < -127 || delta > 127 || context != smk_fader_context()) return 0;
    /* A queued panel navigation may not have reached the coroutine yet. Refuse rather than target the old page. */
    if (host_edges || host_rel || host_rel_next || host_qw[0] != host_qr[0] || req_page || pf_page_request || host_enc[ENC_SELECT] || host_enc[ENC_ALGORITHM] || host_enc[ENC_PRESETS]) return 0;
    for (uint32_t q = mq_r; q != mq_w; q++)
        if ((mq[q % (sizeof mq / sizeof mq[0])][0] & 0xF0u) == 0xC0u) return 0;
    set_param((uint32_t)p, (int32_t)ed_patch((uint32_t)p)->v[p] + delta);
    auto_rec((uint32_t)p);
    if (p == P_CUTOFF) cut_shown_t = fm1_ms + 1u;
    if (p == P_MODE || p == P_FTYPE || p == P_ARP_MODE || p >= P_CHO_RATE) dirty_tags = 1;
    dirty_hdr = dirty_page = 1;
    zm_focus_capture(k,p);
    return 1;
}

EXPORT int32_t waswan_knob_value(uint32_t k)
{
    int32_t p = waswan_knob_param(k);
    return p < 0 ? -1 : ed_patch((uint32_t)p)->v[p];
}

/* Bounds for absolute soft takeover; identical to the original parameter setter. */
EXPORT int32_t waswan_knob_bound(uint32_t k, uint32_t upper)
{
    int32_t p = waswan_knob_param(k);
    if (p < 0) return -1;
    patch_t *d = ed_patch((uint32_t)p);
    if (obv_patch_engine(d) == OBV_DRUMS)
        for (unsigned l = 0; l < 8u; l++) if ((uint32_t)p == DP_PITCH[l]) return upper ? 76 : 52;
    return upper ? obv_param_max(d,(uint32_t)p) : 0;
}

/* UI Foundation contract. IDs are host-only; no patch/storage layout changes.
 * 0..3: selected ANALOG part; 4..6: selected part sends; 7: physical master;
 * 8..11: fixed mixer parts A..D. Navigation never calls these setters. */
static const uint8_t waswan_ui_params[4] = {P_CUTOFF,P_RESO,P_FENV_AMT,P_AR};
EXPORT uint32_t waswan_ui_scope(void) { return (seq_trk % NTRK) | (trk_prog[seq_trk % NTRK] << 2); }
EXPORT uint32_t waswan_ui_available(uint32_t id) {
    return id < 12u && !mm_on && !preset_ui && !pb_confirm && !save_armed &&
        (id >= 4u || obv_patch_engine(&live_p[seq_trk % NTRK]) == OBV_ANALOG);
}
EXPORT int32_t waswan_ui_value(uint32_t id) {
    uint32_t t = seq_trk % NTRK;
    if (id < 4u) return live_p[t].v[waswan_ui_params[id]];
    if (id == 4u) return set.mix_cho[t];
    if (id == 5u) return set.mix_dly[t];
    if (id == 6u) return set.mix_rev[t];
    if (id == 7u) return smk_master;
    return id < 12u ? set.mix_lvl[id - 8u] : -1;
}
EXPORT uint32_t waswan_ui_max(uint32_t id) { return id == 7u ? 1023u : 127u; }
EXPORT uint32_t waswan_ui_set(uint32_t id, int32_t value, uint32_t scope) {
    if (!waswan_ui_available(id) || scope != waswan_ui_scope() || value < 0 || value > (int32_t)waswan_ui_max(id)) return 0;
    /* Refuse edits racing queued part/program navigation. */
    if (host_enc[ENC_ALGORITHM] || host_enc[ENC_PRESETS]) return 0;
    for (uint32_t q = mq_r; q != mq_w; q++) if ((mq[q % (sizeof mq / sizeof mq[0])][0] & 0xF0u) == 0xC0u) return 0;
    if (id < 4u) {
        uint32_t p = waswan_ui_params[id];
        set_param_in(&live_p[seq_trk % NTRK],p,value);
        auto_rec(p);
        if (p == P_CUTOFF) cut_shown_t = fm1_ms + 1u;
    } else if (id == 7u) sim_master((uint32_t)value);
    else {
        uint32_t t = seq_trk % NTRK;
        if (id == 4u) set.mix_cho[t] = (uint8_t)value;
        else if (id == 5u) set.mix_dly[t] = (uint8_t)value;
        else if (id == 6u) set.mix_rev[t] = (uint8_t)value;
        else set.mix_lvl[id - 8u] = (uint8_t)value;
        mix_apply(); set_dirty = 1; set_t = fm1_ms; dirty_steps = 1;
    }
    dirty_hdr = dirty_page = 1;
    return 1;
}
EXPORT uint32_t waswan_ui_name(uint32_t i) { return i < PATCH_NAME ? live_p[seq_trk % NTRK].v[NPARAM+i] : 0; }
EXPORT uint32_t waswan_ui_edited(void) { return ed_edited(); }
EXPORT uint32_t waswan_ui_cut_hz(uint32_t v) { return CUT_HZ[(v > 127u ? 127u : v) + 8u]; }
EXPORT uint32_t waswan_ui_release_x10(uint32_t v) { return TIME_MS_X10[v > 127u ? 127u : v]; }
EXPORT uint32_t waswan_ui_playing(void) { return !!ctl_seq_run; }
