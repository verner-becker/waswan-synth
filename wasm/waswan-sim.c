/* SPDX-License-Identifier: GPL-3.0-only */
/* Host-only extension: original simulator and DSP remain in the pinned submodule. */
#include "../upstream/SMKSYNTH/web/sim/sim.c"

_Static_assert(NV == 8u, "Only the approved eight-voice stage is implemented");

EXPORT uint32_t waswan_voice_limit(void) { return NV; }
EXPORT uint32_t waswan_parameter_count(void) { return NPARAM; }
EXPORT uint32_t waswan_mode(uint32_t p) { return p < NPART ? live_p[p].v[P_MODE] : 0u; }
EXPORT uint32_t waswan_unison(uint32_t p) { return p < NPART ? live_p[p].v[P_UNI_N] : 0u; }
EXPORT uint32_t waswan_arp(uint32_t p) { return p < NPART ? live_p[p].v[P_ARP_MODE] : 0u; }
EXPORT uint32_t waswan_sustain(uint32_t p) { return p < NPART ? !!part_sus(p) : 0u; }
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
    if (p >= NPART || count < 1u || count > NV || mm_on || obv_patch_engine(&live_p[p]) != OBV_ANALOG) return 0;
    set_param_in(&live_p[p], P_UNI_N, (int32_t)count);
    dirty_hdr = dirty_page = dirty_tags = 1;
    return 1;
}
