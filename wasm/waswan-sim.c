/* SPDX-License-Identifier: GPL-3.0-only */
/* Host-only extension: original simulator and DSP remain in the pinned submodule. */
#ifndef WASWAN_SIM_SOURCE
#define WASWAN_SIM_SOURCE "../upstream/SMKSYNTH/web/sim/sim.c"
#endif
#ifndef WASWAN_VOICES
#define WASWAN_VOICES 8
#endif
#include <stdint.h>
static void waswan_daw_sample(uint32_t index, uint32_t position);
#define WASWAN_DAW_SAMPLE waswan_daw_sample
#include WASWAN_SIM_SOURCE
#ifndef WASWAN_OSC_BANK
#define analog_patch_max obv_param_max
typedef patch_t wire_patch_t;
static patch_t patch_unpack(const wire_patch_t *p) {return *p;}
static wire_patch_t patch_pack(const patch_t *p) {return *p;}
#endif

#ifdef WASWAN_OSC_BANK
static uint8_t *fm_store_area(unsigned bank) {
    return (bank < FM_FAV_A ? mm_blob[bank] : perf_blob[bank-FM_FAV_A]) + 4100;
}
static fm_patch_t daw_fm_stage[NPART], studio_fm_stage[NTRK];
EXPORT unsigned waswan_fm_data(unsigned part) {
    return part < NPART ? (uintptr_t)&live_p[part].fm : 0;
}
EXPORT unsigned waswan_fm_stage(unsigned studio, unsigned part) {
    if(studio) return part<NTRK ? (uintptr_t)&studio_fm_stage[part] : 0;
    return part<NPART ? (uintptr_t)&daw_fm_stage[part] : 0;
}
EXPORT unsigned waswan_fm_route(unsigned algorithm, unsigned op) {
    return algorithm<32 && op<6 ? DX_ALG[algorithm][5-op] : 0;
}
#endif
static uint32_t patch_hash(uint32_t hash,const patch_t *patch) {
    wire_patch_t wire=patch_pack(patch);
    for(unsigned i=0;i<PATCH_BYTES;i++)hash=(hash^wire.v[i])*16777619u;
#ifdef WASWAN_OSC_BANK
    if(patch->fm.bytes[0])
        for(unsigned i=0;i<FM_BYTES;i++) hash=(hash^patch->fm.bytes[i])*16777619u;
#endif
    return hash;
}
static unsigned patch_byte(const patch_t *patch,unsigned byte) {
#ifdef WASWAN_OSC_BANK
    if(osc_payload(patch))return patch_pack(patch).v[byte];
#endif
    return patch->v[byte];
}

/* Optional dry outputs. The bus is captured at the same position as the final
 * stereo block, before part mixer/FX/master; 131072 converts its Q17 scale.
 * Legacy output and allocation are unchanged. Disabled on the original 8-voice
 * reference, whose source intentionally has no host observation hook. */
static float daw_dry[NPART][2][SIM_MAXN];
static float daw_owned_dry[NPART][2][SIM_MAXN];
static float daw_live_dry[NPART][2][SIM_MAXN];
static uint32_t daw_taps_enabled;
static void waswan_daw_sample(uint32_t index, uint32_t position) {
    if (!daw_taps_enabled) return;
    for (uint32_t p=0; p<NPART; p++) {
        daw_dry[p][0][index]=mm_on?0:(float)bus[p][2u*position]*(1.0f/131072.0f);
        daw_dry[p][1][index]=mm_on?0:(float)bus[p][2u*position+1u]*(1.0f/131072.0f);
#ifdef WASWAN_DAW_RUNTIME
        daw_owned_dry[p][0][index]=mm_on?0:(float)daw_bus[p][2u*position]*(1.0f/131072.0f);
        daw_owned_dry[p][1][index]=mm_on?0:(float)daw_bus[p][2u*position+1u]*(1.0f/131072.0f);
        daw_live_dry[p][0][index]=mm_on?0:(float)daw_live_bus[p][2u*position]*(1.0f/131072.0f);
        daw_live_dry[p][1][index]=mm_on?0:(float)daw_live_bus[p][2u*position+1u]*(1.0f/131072.0f);
#endif
    }
}
EXPORT uint32_t waswan_daw_taps(uint32_t enabled) {
    daw_taps_enabled=enabled && WASWAN_VOICES>8;
    memset(daw_dry,0,sizeof daw_dry);
    memset(daw_owned_dry,0,sizeof daw_owned_dry);
    memset(daw_live_dry,0,sizeof daw_live_dry);
    return WASWAN_VOICES>8 ? NPART : 0;
}
EXPORT float *waswan_daw_output(uint32_t part, uint32_t channel) {
    return part<NPART && channel<2 ? daw_dry[part][channel] : 0;
}
EXPORT uint32_t waswan_daw_output_count(void) {return NPART;}
EXPORT float *waswan_daw_owned_output(uint32_t part,uint32_t channel) {return part<NPART&&channel<2?daw_owned_dry[part][channel]:0;}
EXPORT float *waswan_daw_live_output(uint32_t part,uint32_t channel) {return part<NPART&&channel<2?daw_live_dry[part][channel]:0;}

#ifdef WASWAN_DAW_RUNTIME
/* Independent project slots and note ownership. No flash/preset writes. */
static wire_patch_t daw_staged[NPART];
static uint32_t daw_slots;
static uint8_t daw_export_active;
EXPORT uint32_t waswan_daw_capacity(void) {return NPART;}
EXPORT uint32_t waswan_daw_drum_hits(void) {return sizeof drum_hit/sizeof drum_hit[0][0];}
EXPORT void waswan_daw_transport_guard(uint32_t active) {daw_transport_guard=!!active;}
EXPORT uint32_t waswan_daw_stage_buffer(void) {return (uint32_t)(uintptr_t)daw_staged;}
EXPORT uint32_t waswan_daw_program(uint32_t part,uint32_t program) {
    if(part>=NPART||program>=NPROG)return 0;
    patch_t patch;
    prog_get(program,&patch);
    daw_staged[part]=patch_pack(&patch);
    daw_fm_stage[part]=patch.fm;
    return 1;
}
EXPORT uint32_t waswan_daw_drum_kits(void) {return NDRUMKIT;}
EXPORT uint32_t waswan_daw_drum_kit(uint32_t kit) {
    if(kit>=NDRUMKIT)return 0;
    patch_t patch;
    obv_drums_preset(&patch,kit);
    daw_staged[0]=patch_pack(&patch);
    daw_fm_stage[0]=patch.fm;
    return 1;
}
EXPORT uint32_t waswan_daw_patch(uint32_t part,uint32_t byte) {return part<NPART&&byte<PATCH_BYTES?patch_byte(&live_p[part],byte):0;}
static patch_t daw_decoded(unsigned part) {
    patch_t patch=patch_unpack(&daw_staged[part]);
    patch.fm=daw_fm_stage[part];
    return patch;
}
static uint32_t daw_patch_valid(const patch_t *patch,uint32_t part) {
    uint32_t engine=obv_patch_engine(patch);
    if(patch->fm.bytes[0] && (engine!=OBV_ANALOG || !fm_valid(&patch->fm)))return 0;
    if((engine!=OBV_ANALOG&&engine!=OBV_DRUMS)||(part>=NTRK&&engine!=OBV_ANALOG))return 0;
    for(uint32_t p=0;p<NPARAM;p++){
        if(engine==OBV_DRUMS){if(patch->v[p]>127u)return 0;}
        else if(patch->v[p]>analog_patch_max(patch,p)||((p==P_UNI_N||p==P_ARP_OCT)&&!patch->v[p]))return 0;
    }
    for(uint32_t p=NPARAM;p<NPARAM+PATCH_NAME;p++)if(patch->v[p]&&(patch->v[p]<32u||patch->v[p]>126u))return 0;
    return 1;
}
EXPORT int32_t waswan_daw_staged_engine(uint32_t part) {
    if(part>=NPART)return -1;
    patch_t patch=daw_decoded(part);
    return daw_patch_valid(&patch,part)?(int32_t)obv_patch_engine(&patch):-1;
}
EXPORT uint32_t waswan_daw_token(void) {
    uint32_t hash=2166136261u;for(uint32_t p=0;p<NPART;p++)hash=patch_hash(hash,&live_p[p]);
    return (hash^daw_slots)*16777619u;
}
EXPORT uint32_t waswan_daw_active_slots(void) {return daw_slots;}
static uint32_t daw_slot_busy(uint32_t part) {
    if(part>=NPART)return 1;
    for(uint32_t i=0;i<NV;i++)if(vc[i].part==part&&(vc[i].gate||vc[i].ae.stage!=E_IDLE))return 1;
    return obv_pending_n[part]||guard_left[part]||daw_guard_left[part]||daw_live_busy(part)||(part<NTRK&&drums_busy(part));
}
EXPORT uint32_t waswan_daw_apply(uint32_t mask,uint32_t token) {
    if(mask>>NPART||token!=waswan_daw_token()||mm_on||preset_ui||pb_confirm||save_armed||ctl_seq_run)return 0;
    for(uint32_t p=0;p<NPART;p++)if(mask>>p&1u){
        patch_t patch=daw_decoded(p);
        if(!daw_patch_valid(&patch,p))return 0;
        if(memcmp(&live_p[p],&patch,sizeof patch)&&(daw_slot_busy(p)||daw_live_count(p)))return 0;
    }
    for(uint32_t p=0;p<NPART;p++)if(mask>>p&1u){
        live_p[p]=daw_decoded(p);if(p<NTRK){trk_edited[p]=1;dirty_hdr=dirty_page=dirty_tags=1;}
        else daw_extra_active|=1u<<p;
    }
    uint32_t retained=mask;for(uint32_t p=0;p<NPART;p++)if(daw_live_count(p))retained|=1u<<p;
    for(uint32_t p=NTRK;p<NPART;p++)if(!(retained>>p&1u)&&!daw_slot_busy(p))daw_extra_active&=~(1u<<p);
    daw_slots=retained;return 1;
}
static uint32_t daw_can_trigger(uint32_t part,uint32_t owner,uint32_t note);
EXPORT uint32_t waswan_daw_note(uint32_t part,uint32_t note,uint32_t velocity) {
    if(part>=NPART||!(daw_slots>>part&1u)||note>127u||velocity>127u||(velocity&&mm_on))return 0;
    if(velocity&&!daw_can_trigger(part,3,note))return 0;
    uint8_t source=seq_note_source;seq_note_source=3;
    if(velocity){daw_held_on(3,part,note,velocity);voice_trigger(part,note,velocity);}else{daw_held_off(3,part,note);voice_release(part,note,0);}
    seq_note_source=source;return 1;
}
EXPORT uint32_t waswan_daw_expression(uint32_t part,int32_t bend,uint32_t modulation) {
    if(part>=NPART||!(daw_slots>>part&1u)||bend< -8192||bend>8191||modulation>127u)return 0;
    daw_bend[part]=bend;daw_mod[part]=modulation;return 1;
}
static uint32_t daw_can_trigger(uint32_t part,uint32_t owner,uint32_t note){
    if(obv_engine_track[part].phase!=OBV_ENGINE_OUT||obv_engine_track[part].target==OBV_DRUMS||obv_pending_n[part]<NHELD)return 1;
    for(uint32_t i=0;i<obv_pending_n[part];i++)if(obv_pending[part][i].note==note&&obv_pending[part][i].sequenced==owner)return 1;return 0;
}
EXPORT uint32_t waswan_daw_live_note_channel(uint32_t part,uint32_t channel,uint32_t note,uint32_t velocity) {
    if(part>=NPART||channel>15u||note>127u||velocity>127u||(velocity&&(!(daw_slots>>part&1u)||mm_on)))return 0;
    uint32_t owner=4u+channel,s=owner-3u;if(velocity&&!daw_can_trigger(part,owner,note))return 0;
    uint8_t previous=seq_note_source;seq_note_source=(uint8_t)owner;
    if(velocity){daw_held_on(owner,part,note,velocity);voice_trigger(part,note,velocity);}
    else if(daw_held[s][part][note].active){daw_held[s][part][note].physical=0;if(!daw_live_sustain[channel][part]){daw_held_off(owner,part,note);voice_release(part,note,0);}}
    seq_note_source=previous;return 1;
}
EXPORT uint32_t waswan_daw_live_note(uint32_t part,uint32_t note,uint32_t velocity) {return waswan_daw_live_note_channel(part,0,note,velocity);}
EXPORT uint32_t waswan_daw_live_expression_channel(uint32_t part,uint32_t channel,int32_t bend,uint32_t modulation) {
    if(part>=NPART||channel>15u||bend< -8192||bend>8191||modulation>127u)return 0;
    daw_live_bend[channel][part]=bend;daw_live_mod[channel][part]=modulation;return 1;
}
EXPORT uint32_t waswan_daw_live_expression(uint32_t part,int32_t bend,uint32_t modulation) {return waswan_daw_live_expression_channel(part,0,bend,modulation);}
EXPORT uint32_t waswan_daw_live_pedal_channel(uint32_t part,uint32_t channel,uint32_t down) {
    if(part>=NPART||channel>15u||down>1u)return 0;daw_live_sustain[channel][part]=down;if(down)return 1;
    uint8_t gone[128];uint32_t count=0,owner=channel+4u,s=channel+1u;uint8_t previous=seq_note_source;seq_note_source=(uint8_t)owner;
    for(uint32_t note=0;note<128;note++)if(daw_held[s][part][note].active&&!daw_held[s][part][note].physical){daw_held_off(owner,part,note);gone[count++]=(uint8_t)note;}
    for(uint32_t i=0;i<count;i++)voice_release(part,gone[i],0);seq_note_source=previous;return 1;
}
EXPORT uint32_t waswan_daw_live_pedal(uint32_t part,uint32_t down) {return waswan_daw_live_pedal_channel(part,0,down);}
EXPORT uint32_t waswan_daw_live_held(uint32_t part) {return part<NPART?daw_live_count(part):0;}
EXPORT void waswan_daw_live_stop_channel(uint32_t part,uint32_t channel,uint32_t hard) {
    if(part>=NPART||channel>15u)return;uint32_t owner=channel+4u,s=channel+1u;uint8_t previous=seq_note_source;seq_note_source=(uint8_t)owner;
    memset(daw_held[s][part],0,sizeof daw_held[s][part]);daw_held_count[s][part]=0;daw_live_sustain[channel][part]=0;
    for(uint32_t i=0;i<NV;i++)if(vc[i].seq_owned==owner&&vc[i].part==part&&vc[i].gate)voice_release(part,vc[i].note,0);
    for(uint32_t i=0;i<NV;i++)if(vc[i].seq_owned==owner&&vc[i].part==part){vc[i].gate=0;if(hard){vc[i].ae.stage=vc[i].fe.stage=E_IDLE;vc[i].ae.level=vc[i].fe.level=0;vc[i].amp0=vc[i].amp1=0;vc[i].guard_l=vc[i].guard_r=0;vc[i].guard_in=0;vc[i].grp=0;ui_vlevel[i]=0;}}
    uint32_t n=0;for(uint32_t i=0;i<obv_pending_n[part];i++)if(obv_pending[part][i].sequenced!=owner)obv_pending[part][n++]=obv_pending[part][i];obv_pending_n[part]=(uint8_t)n;
    daw_live_bend[channel][part]=daw_live_bend_sm[channel][part]=daw_live_bend8[channel][part]=0;daw_live_mod[channel][part]=0;
    if(hard){daw_live_guard_left[channel][part]=0;memset(daw_live_guard_tail[channel][part],0,sizeof daw_live_guard_tail[channel][part]);if(part<NTRK)for(uint32_t l=0;l<8;l++)if(drum_hit[part][l].daw==owner)memset(&drum_hit[part][l],0,sizeof drum_hit[part][l]);}seq_note_source=previous;
}
EXPORT void waswan_daw_live_stop(uint32_t part,uint32_t hard) {
    uint32_t first=part<NPART?part:0,end=part<NPART?part+1u:NPART;
    for(uint32_t p=first;p<end;p++)for(uint32_t ch=0;ch<16;ch++){memset(daw_held[ch+1u][p],0,sizeof daw_held[ch+1u][p]);daw_held_count[ch+1u][p]=0;daw_live_sustain[ch][p]=0;}
    for(uint32_t p=first;p<end;p++)for(uint32_t ch=0;ch<16;ch++)waswan_daw_live_stop_channel(p,ch,hard);
}
EXPORT uint32_t waswan_daw_parameter(uint32_t part,uint32_t parameter,uint32_t value) {
    if(part>=NPART||!(daw_slots>>part&1u)||parameter>=NPARAM||obv_patch_engine(&live_p[part])!=OBV_ANALOG||value>obv_param_max(&live_p[part],parameter)||((parameter==P_UNI_N||parameter==P_ARP_OCT)&&!value))return 0;
    live_p[part].v[parameter]=(uint8_t)value;if(part<NTRK){trk_edited[part]=1;dirty_hdr=dirty_page=1;}return 1;
}
EXPORT void waswan_daw_stop(uint32_t hard) {
    memset(daw_held[0],0,sizeof daw_held[0]);memset(daw_held_count[0],0,sizeof daw_held_count[0]);
    /* Preserve the firmware's MONO/UNISON last-physical-key restoration. Directly
     * clearing a DAW-tagged mono group could otherwise erase a still-held key. */
    uint8_t previous_source=seq_note_source;seq_note_source=3;
    for(uint32_t i=0;i<NV;i++)if(vc[i].seq_owned==3u&&vc[i].gate)voice_release(vc[i].part,vc[i].note,0);
    seq_note_source=previous_source;
    for(uint32_t i=0;i<NV;i++)if(vc[i].seq_owned==3u){vc[i].gate=0;if(hard){vc[i].ae.stage=vc[i].fe.stage=E_IDLE;vc[i].ae.level=vc[i].fe.level=0;vc[i].amp0=vc[i].amp1=0;vc[i].guard_l=vc[i].guard_r=0;vc[i].guard_in=0;vc[i].grp=0;ui_vlevel[i]=0;}}
    for(uint32_t p=0;p<NPART;p++){
        uint32_t n=0;for(uint32_t i=0;i<obv_pending_n[p];i++)if(obv_pending[p][i].sequenced!=3u)obv_pending[p][n++]=obv_pending[p][i];obv_pending_n[p]=(uint8_t)n;
        if(!daw_export_active||hard){daw_bend[p]=daw_bend_sm[p]=daw_bend8[p]=0;daw_mod[p]=0;}
    }
    if(hard){memset(daw_guard_left,0,sizeof daw_guard_left);memset(daw_guard_tail,0,sizeof daw_guard_tail);for(uint32_t p=0;p<NTRK;p++)for(uint32_t l=0;l<8;l++)if(drum_hit[p][l].daw==3u)memset(&drum_hit[p][l],0,sizeof drum_hit[p][l]);}
}
/* A bounce borrows the idle instrument and restores its patch binding. */
static patch_t daw_export_patches[NPART];
static uint8_t daw_export_edited[sizeof trk_edited];
static int32_t daw_export_pitch[NPART];
static uint32_t daw_export_slots, daw_export_extra, daw_export_taps;
EXPORT uint32_t waswan_daw_export_open(void) {
    if(daw_export_active||mm_on||preset_ui||pb_confirm||save_armed||ctl_seq_run||ctl_sustain||
       mq_w!=mq_r||nq_w!=nq_r||fm1_in.keys||fm1_in.buttons||host_edges||host_rel||host_rel_next||
       host_qw[0]!=host_qr[0]||host_qw[1]!=host_qr[1])return 0;
    for(uint32_t p=0;p<NPART;p++)if(daw_slot_busy(p)||daw_live_count(p)||(p<NTRK&&nheld[p]))return 0;
    memcpy(daw_export_patches,live_p,sizeof daw_export_patches);
    memcpy(daw_export_edited,trk_edited,sizeof daw_export_edited);
    for(uint32_t p=0;p<NPART;p++)daw_export_pitch[p]=pt[p].last_pitch16;
    daw_export_slots=daw_slots;daw_export_extra=daw_extra_active;daw_export_taps=daw_taps_enabled;daw_export_active=1;
    return 1;
}
EXPORT void waswan_daw_export_close(void) {
    if(!daw_export_active)return;
    waswan_daw_stop(1);daw_transport_guard=0;
    memcpy(live_p,daw_export_patches,sizeof daw_export_patches);
    memcpy(trk_edited,daw_export_edited,sizeof daw_export_edited);
    for(uint32_t p=0;p<NPART;p++)pt[p].last_pitch16=daw_export_pitch[p];
    waswan_daw_taps(daw_export_taps);
    daw_slots=daw_export_slots;daw_extra_active=daw_export_extra;daw_export_active=0;
    dirty_hdr=dirty_page=dirty_tags=1;
}
#else
EXPORT uint32_t waswan_daw_capacity(void) {return 0;}
#endif

/* Studio uses the existing sequenced-note path with a distinct ownership tag.
 * No DSP algorithm, voice allocation limit, MIDI routing or legacy transport changes. */
EXPORT uint32_t waswan_studio_note(uint32_t part,uint32_t note,uint32_t velocity) {
    if(part>=NTRK||note>127u||velocity>127u||(velocity&&mm_on))return 0;
    uint8_t source=seq_note_source;seq_note_source=2;
    if(velocity)voice_trigger(part,note,velocity);else voice_release(part,note,0);
    seq_note_source=source;
    return 1;
}
EXPORT uint32_t waswan_studio_owned(uint32_t slot) {return slot<NV&&vc[slot].seq_owned==2u;}

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
EXPORT uint32_t waswan_voice_state_bytes(void) {
    uint32_t bytes=sizeof vc + sizeof grp_v + sizeof obv_voice_engine + sizeof ui_vlevel + sizeof ui_vnote + sizeof super_state + sizeof super_plain_state;
#ifdef WASWAN_OSC_BANK
    bytes += sizeof fm_voices;
#endif
    return bytes;
}
EXPORT uint32_t waswan_held_limit(void) { return NHELD; }
EXPORT uint32_t waswan_event_limit(void) { return NQ; }
EXPORT uint32_t waswan_midi_event_limit(void) { return sizeof mq / sizeof mq[0]; }
EXPORT uint32_t waswan_held_state_bytes(void) { return sizeof held + sizeof obv_pending; }
EXPORT uint32_t waswan_queue_bytes(void) { return sizeof nq + sizeof mq; }
EXPORT uint32_t waswan_internal_frames(void) { return HALF_FRAMES; }
EXPORT uint32_t waswan_parameter_count(void) { return NPARAM; }
EXPORT uint32_t waswan_mode(uint32_t p) { return p < NTRK ? live_p[p].v[P_MODE] : 0u; }
EXPORT uint32_t waswan_unison(uint32_t p) { return p < NTRK ? live_p[p].v[P_UNI_N] : 0u; }
EXPORT uint32_t waswan_arp(uint32_t p) { return p < NTRK ? live_p[p].v[P_ARP_MODE] : 0u; }
EXPORT uint32_t waswan_sustain(uint32_t p) { return p < NTRK ? !!part_sus(p) : 0u; }
EXPORT uint32_t waswan_midi_sustain(void) { return !!midi_sustain; }
EXPORT void waswan_set_sustain(uint32_t enabled) { if (enabled <= 1u && !mm_on) { midi_sustain = enabled; sustain_apply(); } }
EXPORT uint32_t waswan_held(uint32_t p) { return p < NTRK ? nheld[p] : 0u; }
EXPORT uint32_t waswan_part_limit(uint32_t p) { return p < NTRK ? (super_part(p) ? SUPER_LIMIT : NV) : 0u; }
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
    if (p >= NTRK || mode > M_MONO || mm_on || obv_patch_engine(&live_p[p]) != OBV_ANALOG) return 0;
    /* Same parameter setter as the original editor; no preset replacement/save. */
    set_param_in(&live_p[p], P_MODE, (int32_t)mode);
    dirty_hdr = dirty_page = dirty_tags = 1;
    return 1;
}
EXPORT uint32_t waswan_set_unison(uint32_t p, uint32_t count)
{
    if (p >= NTRK || count < 1u || count > PDEF[P_UNI_N].max || mm_on || obv_patch_engine(&live_p[p]) != OBV_ANALOG) return 0;
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

/* Program browsing uses the original library and loader; no new storage or DSP. */
EXPORT uint32_t waswan_program_count(void) { return NPROG; }
EXPORT uint32_t waswan_program_catalog(void) {
    uint32_t h = 2166136261u;
    for (uint32_t n = 0; n < NPROG; n++) {
        uint32_t used = psect[n / PS_N].used[n % PS_N];
        h = (h ^ used) * 16777619u;
        if (used) for (uint32_t i = 0; i < PATCH_NAME; i++)
            h = (h ^ psect[n / PS_N].p[n % PS_N].v[NPARAM+i]) * 16777619u;
    }
    return h;
}
EXPORT uint32_t waswan_program_token(void) {
    return patch_hash(2166136261u,&live_p[seq_trk % NTRK]);
}
EXPORT uint32_t waswan_program_available(void) {
    return !mm_on && !preset_ui && !pb_confirm && !save_armed && !layer && step_held < 0 && !pat_queue;
}
EXPORT uint32_t waswan_program_select(uint32_t n, uint32_t scope, uint32_t token, uint32_t discard) {
    if (n >= NPROG || !waswan_program_available() || scope != waswan_ui_scope() || token != waswan_program_token()) return 0;
    if (host_edges || host_rel || host_rel_next || host_qw[0] != host_qr[0] || host_enc[ENC_ALGORITHM] || host_enc[ENC_PRESETS]) return 0;
    for (uint32_t q = mq_r; q != mq_w; q++) if ((mq[q % (sizeof mq / sizeof mq[0])][0] & 0xF0u) == 0xC0u) return 0;
    if (n == ed_prog() && !(discard == 2 && ed_edited())) return 1;
    if (ed_edited() && !discard) return 0;
    trk_load(seq_trk, n);
    dirty_hdr = dirty_page = dirty_tags = dirty_steps = 1;
    return 1;
}

/* Tone Editor: metadata and commands on the host thread, never new DSP/state formats. */
static char editor_text[32];
static uint8_t editor_name[PATCH_NAME];
static uint32_t editor_idle(void) {
    if(!waswan_program_available() || host_edges || host_rel || host_rel_next ||
       host_qw[0]!=host_qr[0] || host_enc[ENC_ALGORITHM] || host_enc[ENC_PRESETS] ||
       req_page || pf_page_request) return 0;
    for(uint32_t q=mq_r;q!=mq_w;q++)if((mq[q%(sizeof mq/sizeof mq[0])][0]&0xF0u)==0xC0u)return 0;
    return 1;
}
EXPORT uint32_t waswan_editor_available(void) {
    return editor_idle() && obv_patch_engine(&live_p[seq_trk%NTRK])==OBV_ANALOG;
}
#ifdef WASWAN_DAW_RUNTIME
EXPORT uint32_t waswan_tone_bank_load(uint32_t scope, uint32_t token, uint32_t discard) {
    const uint32_t part=seq_trk%NTRK;
    if(!editor_idle()||scope!=waswan_ui_scope()||token!=waswan_program_token()||
       (ed_edited()&&!discard)||ctl_seq_run||daw_transport_guard||pb_busy()||
       copy_to||pend_slot||manual_store_request||daw_slot_busy(part)||daw_live_count(part))return 0;
    patch_t patch=daw_decoded(part);
    if(!daw_patch_valid(&patch,part))return 0;
    if(!part)fx_keep(&patch);
    live_p[part]=patch;
    trk_edited[part]=1;
    smk_controls_epoch++;
    dirty_hdr=dirty_page=dirty_tags=dirty_steps=1;
    return 1;
}
#endif
#ifdef WASWAN_OSC_BANK
EXPORT uint32_t waswan_fm_edit(unsigned field,unsigned value,unsigned scope) {
    if(!waswan_editor_available() || scope!=waswan_ui_scope() || field>=FM_BYTES) return 0;
    fm_patch_t *fm=&live_p[seq_trk%NTRK].fm;
    if (!field) {
        if (value>1) return 0;
        if (!!fm->bytes[0]==value) return 1;
        *fm=value ? fm_init_patch() : (fm_patch_t){0};
    } else {
        if (!fm->bytes[0] || value>fm_bound(field)) return 0;
        if (fm->bytes[field]==value) return 1;
        fm->bytes[field]=value;
    }
    trk_edited[seq_trk%NTRK]=dirty_hdr=dirty_page=dirty_tags=1;
    return 1;
}
#endif
EXPORT uint32_t waswan_editor_count(void) {
#ifdef WASWAN_OSC_BANK
    return NPARAM + 2 * EXTRA_FIELDS;
#else
    return NPARAM;
#endif
}
#ifdef WASWAN_OSC_BANK
static const char *const extra_names[] = {"OSC3 wave", "OSC3 level", "OSC3 semitones",
                                           "OSC4 wave", "OSC4 level", "OSC4 semitones",
    "OSC3 fine", "OSC3 pulse width", "OSC4 fine", "OSC4 pulse width"};
static const unsigned extra_max[] = {8, 31, 30, 127, 127};
/* IDs 63..68 are the original four-oscillator catalog. Append new controls. */
static unsigned extra_osc(unsigned index) {return index<6 ? index/3 : (index-6)/2;}
static unsigned extra_kind(unsigned index) {return index<6 ? index%3 : EXTRA_FINE+(index-6)%2;}
#endif
EXPORT uint32_t waswan_editor_meta(uint32_t p,uint32_t field) {
#ifdef WASWAN_OSC_BANK
    if (p >= NPARAM && p < waswan_editor_count()) {
        unsigned index = p - NPARAM, kind = extra_kind(index);
        if (field == 0) return (uintptr_t)extra_names[index];
        if (field == 1) return extra_max[kind];
        if (field == 3 && kind == EXTRA_WAVE) return K_WAVE;
        return 0;
    }
    if ((p == P_O1_WAVE || p == P_O2_WAVE) && field == 1) return O_SINE;
#endif
    if(p>=NPARAM)return 0;
    switch(field){
    case 0:return (uint32_t)(uintptr_t)PDEF[p].name;
    case 1:return p==P_O2_WAVE?W_BOTH:PDEF[p].max; /* ANALOG catalog even when booting a DRUM-X part */
    case 2:return p==P_UNI_N||p==P_ARP_OCT?1:0;
    case 3:return PDEF[p].kind;
    case 4:return is_a_only(p);
    default:return 0;
    }
}
EXPORT uint32_t waswan_editor_value(uint32_t p) {
#ifdef WASWAN_OSC_BANK
    if (p >= NPARAM && p < waswan_editor_count()) {
        unsigned index = p - NPARAM;
        return extra_field(ed_patch(0), extra_osc(index), extra_kind(index));
    }
    if (p == P_O2_WAVE && ed_patch(p)->v[p] == W_SUPER) return W_SAW;
#endif
    return p<NPARAM?ed_patch(p)->v[p]:0;
}
EXPORT uint32_t waswan_editor_format(uint32_t p,uint32_t value) {
    editor_text[0]=0;
#ifdef WASWAN_OSC_BANK
    if (p >= NPARAM && p < waswan_editor_count()) {
        unsigned index = p - NPARAM, field = extra_kind(index);
        if (value <= extra_max[field]) {
            if (field == EXTRA_WAVE) {
                unsigned wave = extra_waves[extra_osc(index)][value];
                scat(editor_text, wave < NWAVE ? WAVE_NAME[wave] : poly_wave_names[wave - O_TRI]);
            } else if (field == EXTRA_FINE || field == EXTRA_WIDTH) {
                param_value(editor_text,field == EXTRA_FINE ? P_O2_FINE : P_O2_PW,value);
            } else if (field == EXTRA_TUNE && value < EXTRA_CENTER) {
                editor_text[0] = '-';
                fmt_u(editor_text + 1, EXTRA_CENTER - value);
            } else fmt_u(editor_text, field == EXTRA_TUNE ? value - EXTRA_CENTER : value);
        }
        return (uintptr_t)editor_text;
    }
    if ((p == P_O1_WAVE || p == P_O2_WAVE) && value >= O_TRI && value <= O_SINE)
        return (uintptr_t)poly_wave_names[value - O_TRI];
    if (p == P_O2_WAVE && value == W_SUPER) return (uintptr_t)"";
#endif
    if(p==P_LFO_RATE&&value<=127u){
        char t[8];uint32_t hz=LFO_HZ_X100[value];
        fmt_u(editor_text,hz/100u);scat(editor_text,".");if(hz%100u<10u)scat(editor_text,"0");
        fmt_u(t,hz%100u);scat(editor_text,t);scat(editor_text,"Hz");
    }else if(p<NPARAM&&value<=PDEF[p].max)param_value(editor_text,p,value);
    return (uint32_t)(uintptr_t)editor_text;
}
EXPORT uint32_t waswan_editor_set(uint32_t p,int32_t value,uint32_t scope) {
    if (!waswan_editor_available() || scope != waswan_ui_scope() || value < 0) return 0;
#ifdef WASWAN_OSC_BANK
    if (p >= NPARAM && p < waswan_editor_count()) {
        unsigned index = p - NPARAM, field = extra_kind(index);
        if (field == EXTRA_WIDTH && extra_field(ed_patch(0),extra_osc(index),EXTRA_WAVE)!=8) return 0;
        if ((unsigned)value > extra_max[field]) return 0;
        if ((unsigned)value == waswan_editor_value(p)) return 1;
        extra_set(ed_patch(0), extra_osc(index), field, value);
        trk_edited[seq_trk % NTRK] = dirty_hdr = dirty_page = dirty_tags = 1;
        return 1;
    }
    if ((p == P_O1_WAVE || p == P_O2_WAVE) && value >= O_TRI && value <= O_SINE) {
        if (ed_patch(p)->v[p] != value) {
            ed_patch(p)->v[p] = value;
            trk_edited[seq_trk % NTRK] = dirty_hdr = dirty_page = dirty_tags = 1;
            auto_rec(p);
        }
        return 1;
    }
#endif
    if(p>=NPARAM||
       value>(int32_t)obv_param_max(ed_patch(p),p)||
       ((p==P_UNI_N||p==P_ARP_OCT)&&value<1))return 0;
    if(live_p[seq_trk%NTRK].v[P_O1_WAVE]==W_SUPER&&(p==P_SYNC||p==P_XMOD))return 0;
    set_param(p,value);auto_rec(p);fx_sync();
    dirty_hdr=dirty_page=dirty_tags=1;
    return 1;
}
EXPORT uint32_t waswan_editor_slot_token(uint32_t n) {
    if(n>=NPROG)return 0;
    patch_t p;prog_get(n,&p);return patch_hash(2166136261u,&p);
}
EXPORT uint32_t waswan_editor_name_buffer(void) {return (uint32_t)(uintptr_t)editor_name;}
EXPORT uint32_t waswan_editor_save(uint32_t n,uint32_t scope,uint32_t token,uint32_t target_token) {
    if(n>=NPROG||!waswan_editor_available()||scope!=waswan_ui_scope()||token!=waswan_program_token()||
       target_token!=waswan_editor_slot_token(n)||pb_busy()||copy_to||pend_slot||manual_store_request)return 0;
    uint32_t nonspace=0;
    for(uint32_t i=0;i<PATCH_NAME;i++){
        uint8_t c=editor_name[i];uint32_t valid=0;
        for(uint32_t j=0;j<sizeof PRESET_CHARS-1;j++)if(c==(uint8_t)PRESET_CHARS[j])valid=1;
        if(!valid)return 0;if(c!=' ')nonspace=1;
    }
    if(!nonspace)return 0;
    /* Prepare the original save transaction without panel audition/navigation side effects. */
    preset_part=seq_trk%NTRK;preset_pattern=set.pat;preset_snapshot=live_p[preset_part];
    memcpy(preset_snapshot.v+NPARAM,editor_name,PATCH_NAME);preset_named=1;save_to=n;
    preset_commit();dirty_hdr=dirty_page=dirty_tags=1;
    return preset_ui==2;
}

/* Existing part mixer, explicitly addressed without changing editor context. */
EXPORT int32_t waswan_studio_mix_value(uint32_t part,uint32_t field) {
    if(part>=NTRK||field>7u)return -32768;
    if(field==0u)return set.mix_lvl[part];if(field==1u)return set.mix_pan[part];
    if(field==2u)return set.mix_cho[part];if(field==3u)return set.mix_dly[part];
    if(field==4u)return set.mix_rev[part];if(field==5u)return set.mix_drv[part];
    return field==6u?!!(set.mix_mute>>part&1u):!!(set.mix_solo>>part&1u);
}
EXPORT uint32_t waswan_studio_mix_set(uint32_t part,uint32_t field,int32_t value) {
    if(part>=NTRK||field>7u||mm_on)return 0;
    if(field==1u){if(value< -64||value>64)return 0;set.mix_pan[part]=(int8_t)value;}
    else if(field>=6u){if(value<0||value>1)return 0;uint8_t *mask=field==6u?&set.mix_mute:&set.mix_solo;*mask=(uint8_t)((*mask&~(1u<<part))|((uint32_t)value<<part));}
    else {if(value<0||value>127)return 0;
        if(field==0u)set.mix_lvl[part]=(uint8_t)value;else if(field==2u)set.mix_cho[part]=(uint8_t)value;
        else if(field==3u)set.mix_dly[part]=(uint8_t)value;else if(field==4u)set.mix_rev[part]=(uint8_t)value;else set.mix_drv[part]=(uint8_t)value;
    }
    mix_apply();set_dirty=1;set_t=fm1_ms;dirty_hdr=dirty_page=dirty_steps=1;return 1;
}
EXPORT uint32_t waswan_studio_patch(uint32_t part,uint32_t byte) {return part<NTRK&&byte<PATCH_BYTES?patch_byte(&live_p[part],byte):0;}
EXPORT uint32_t waswan_studio_tempo(uint32_t bpm) {
    if(bpm<40u||bpm>240u||mm_on)return 0;set.tempo=(uint16_t)bpm;ctl_tempo=bpm;set_dirty=1;set_t=fm1_ms;dirty_hdr=dirty_page=1;return 1;
}
EXPORT uint32_t waswan_studio_parameter_set(uint32_t part,uint32_t parameter,int32_t value) {
    if(part>=NTRK||parameter>=NPARAM||mm_on||preset_ui||pb_confirm||save_armed||obv_patch_engine(&live_p[part])!=OBV_ANALOG||value<0||value>(int32_t)obv_param_max(&live_p[part],parameter)||((parameter==P_UNI_N||parameter==P_ARP_OCT)&&value<1))return 0;
    if(is_a_only(parameter))part=0;
    if(live_p[part].v[parameter]==value)return 1;
    set_param_in(&live_p[part],parameter,value);if(is_a_only(parameter))fx_sync();dirty_hdr=dirty_page=1;return 1;
}
EXPORT int32_t waswan_studio_expression_value(uint32_t field) {return field==0u?ctl_bend:field==1u?ctl_vib:field==2u?ctl_wheel_bend:0;}
EXPORT uint32_t waswan_studio_expression_set(uint32_t field,int32_t value) {
    if(mm_on||field>2u)return 0;
    if(field==0u||field==2u){if(value< -8192||value>8191)return 0;if(field==0u)ctl_bend=value;else ctl_wheel_bend=value;}
    else {if(value<0||value>127)return 0;ctl_vib=value;}
    return 1;
}
static wire_patch_t studio_context_patches[NTRK];
EXPORT uint32_t waswan_studio_context_buffer(void) {return (uint32_t)(uintptr_t)studio_context_patches;}
EXPORT uint32_t waswan_studio_context_token(void) {
    uint32_t hash=2166136261u;
    for(uint32_t part=0;part<NTRK;part++){
        hash=patch_hash(hash,&live_p[part]);
        hash=(hash^trk_prog[part])*16777619u;
        for(uint32_t field=0;field<8u;field++)hash=(hash^(uint32_t)waswan_studio_mix_value(part,field))*16777619u;
    }
    return ((hash^set.tempo)*16777619u^(uint32_t)smk_master)*16777619u;
}
EXPORT uint32_t waswan_studio_apply_patches(uint32_t token,uint32_t a,uint32_t b,uint32_t c,uint32_t d) {
#ifdef WASWAN_DAW_RUNTIME
    if(daw_transport_guard)return 0;
#endif
    const uint32_t programs[NTRK]={a,b,c,d};
    if(token!=waswan_studio_context_token()||mm_on||preset_ui||pb_confirm||save_armed||ctl_seq_run)return 0;
    for(uint32_t i=0;i<HOST_NENC;i++)if(host_enc[i])return 0;
    for(uint32_t q=mq_r;q!=mq_w;q++)if((mq[q%(sizeof mq/sizeof mq[0])][0]&0xF0u)==0xC0u)return 0;
    /* Validate every part before touching any live data. */
    for(uint32_t part=0;part<NTRK;part++){
        patch_t decoded=patch_unpack(&studio_context_patches[part]);const patch_t *patch=&decoded;uint32_t engine=obv_patch_engine(patch);
#ifdef WASWAN_OSC_BANK
        if(studio_fm_stage[part].bytes[0] && (engine!=OBV_ANALOG || !fm_valid(&studio_fm_stage[part])))return 0;
#endif
        if(programs[part]>=NPROG||(engine!=OBV_ANALOG&&engine!=OBV_DRUMS))return 0;
        for(uint32_t p=0;p<NPARAM;p++){
            if(engine==OBV_DRUMS){if(patch->v[p]>127u)return 0;}
            else if(patch->v[p]>analog_patch_max(patch,p)||((p==P_UNI_N||p==P_ARP_OCT)&&!patch->v[p]))return 0;
        }
        for(uint32_t p=NPARAM;p<NPARAM+PATCH_NAME;p++)if(patch->v[p]&&(patch->v[p]<32u||patch->v[p]>126u))return 0;
    }
    for(uint32_t part=0;part<NTRK;part++){
        patch_t stored;prog_get(programs[part],&stored);
        live_p[part]=patch_unpack(&studio_context_patches[part]);trk_prog[part]=programs[part];set.tprog[part]=(uint8_t)programs[part];
#ifdef WASWAN_OSC_BANK
        live_p[part].fm=studio_fm_stage[part];
#endif
        trk_edited[part]=!!memcmp(&stored,&live_p[part],sizeof stored);
    }
    set.prog=(uint8_t)a;fx_sync();smk_controls_epoch++;set_dirty=1;set_t=fm1_ms;
    dirty_hdr=dirty_page=dirty_tags=dirty_steps=1;return 1;
}

#include "waswan-instrument.h"
