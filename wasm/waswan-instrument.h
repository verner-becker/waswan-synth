// SPDX-License-Identifier: GPL-3.0-only
/* Browser commands for the pinned instrument. Reuse the firmware's actions and stores. */
EXPORT int32_t waswan_instrument_setting(uint32_t field) {
    switch (field) {
    case 0: return set.tempo;
    case 1: return set.click % NCLICK;
    case 2: return set.midi_ch;
    case 3: return set.tune;
    case 4: return !!set.sync_int;
    case 5: return !!smk_fader_jump();
    case 6: return zm_zoom;
    case 7: return set.m_vol;
    case 8: return set.m_dj;
    case 9: return set.m_drive;
    case 10: return set.m_comp;
    case 11: return set.dv_type;
    case 12: return set.dv_amt;
    case 13: return set.dv_tone;
    case 14: return set.dv_mix;
    case 15: return hold >> seq_trk & 1u;
    default: return -1;
    }
}
EXPORT uint32_t waswan_instrument_set(uint32_t field, int32_t value) {
    if (mm_on) return 0;
    switch (field) {
    case 0:
        if (value < 40 || value > 240) return 0;
        return waswan_studio_tempo((uint32_t)value);
    case 1:
        if (value < 0 || value >= NCLICK) return 0;
        set.click = (uint8_t)((set.click & 0xFCu) | (uint32_t)value);
        break;
    case 2:
        if (value < 0 || value > 13) return 0;
        set.midi_ch = (uint8_t)value;
        break;
    case 3:
        if (value < -50 || value > 50) return 0;
        set.tune = (int8_t)value;
        ctl_tune8 = value * 256 / 100;
        break;
    case 4:
        if (value < 0 || value > 1) return 0;
        set.sync_int = (uint8_t)value;
        if (value) { ctl_ext_quarter = 0; clk_n = 0; }
        break;
    case 5:
        if (value < 0 || value > 1) return 0;
        if (!!smk_fader_jump() != value) smk_fader_mode_set(!!value);
        break;
    case 6:
        if (value < 0 || value > 1) return 0;
        zm_theme_set((uint32_t)value);
        return 1;
    case 15:
        if (value < 0 || value > 1) return 0;
        if (value) hold |= 1u << seq_trk; else hold &= ~(1u << seq_trk);
        ctl_hold = hold; dirty_tags = 1;
        return 1;
    case 7: case 8: case 9: case 10: case 11: case 12: case 13: case 14: {
        const int32_t max = field == 8u ? 128 : field == 11u ? NDV - 1u : 127;
        if (value < 0 || value > max) return 0;
        uint8_t *const fields[] = {&set.m_vol,&set.m_dj,&set.m_drive,&set.m_comp,&set.dv_type,&set.dv_amt,&set.dv_tone,&set.dv_mix};
        *fields[field - 7u] = (uint8_t)value;
        mix_apply();
        break;
    }
    default:
        return 0;
    }
    set_dirty = 1; set_t = fm1_ms; dirty_hdr = dirty_page = dirty_tags = 1;
    return 1;
}
EXPORT uint32_t waswan_pad_bank(uint32_t bank) {
    if (mm_on || bank > 4 || save_ui_active()) return 0;
    if (bank == 1u) {
        if (!is_seq_page(page)) seq_back = page;
        pf_seq_mode = 1;
        seq_view = obv_drums_selected() ? SV_STEPS : end_mode ? SV_ENDLESS : SV_TRACKS;
        req_page = (obv_drums_selected() ? PG_DSEQ : PG_SEQ) + 1u;
        pf_redraw();
    } else pf_nav(bank);
    return 1;
}
EXPORT uint32_t waswan_pattern_action(uint32_t slot, uint32_t save, uint32_t from) {
    if (slot >= NPAT || from != set.pat || mm_on || pb_busy() || preset_ui) return 0;
    if (save) { pb_source[slot] = from; pb_commit(slot); }
    else { pb_cancel(); pat_go(slot); pf_redraw(); }
    return 1;
}
EXPORT uint32_t waswan_favourite_action(uint32_t slot, uint32_t save, uint32_t part) {
    if (slot >= 8u || part != seq_trk || mm_on || save_ui_active()) return 0;
    if (save) {
        pf_target[slot] = (uint8_t)part;
        pf_snapshot(&pf_capture[slot], part);
        pf_commit(slot);
    } else if (pf_store.used >> slot & 1u) pf_recall(slot, part);
    else return 0;
    return 1;
}
EXPORT int32_t waswan_keyboard_value(uint32_t row, uint32_t field) {
    if (row > 1u) return 0;
    const keyboard_cfg_t *k = keyboard_row(&pat, row);
    switch (field) {
    case 0: return k->mode;
    case 1: return k->part[0];
    case 2: return k->part[1];
    case 3: return k->split;
    case 4: return k->level[0];
    case 5: return k->level[1];
    case 6: return k->octave[0];
    default: return k->octave[1];
    }
}
EXPORT uint32_t waswan_keyboard_setup(uint32_t row, uint32_t from, uint32_t mode, uint32_t a, uint32_t b,
                                      uint32_t split, uint32_t left, uint32_t right, int32_t oct1, int32_t oct2) {
    if (row > 1u || from != set.pat || mm_on || mode > KB_LAYER || a >= NTRK || b >= NTRK ||
        split < 1u || split > 127u || left > 100u || right > 100u || oct1 < -2 || oct1 > 2 || oct2 < -2 || oct2 > 2) return 0;
    const keyboard_cfg_t k = {(uint8_t)mode, {(uint8_t)a,(uint8_t)b}, (uint8_t)split,
                              {(int8_t)oct1,(int8_t)oct2}, {(uint8_t)left,(uint8_t)right}};
    if (!keyboard_valid(&k) || (mode && (obv_patch_engine(&live_p[a]) != OBV_ANALOG || obv_patch_engine(&live_p[b]) != OBV_ANALOG))) return 0;
    const unsigned old = kb_edit_row;
    kb_edit_row = (uint8_t)row; keyboard_changed(k); kb_edit_row = (uint8_t)old;
    pf_redraw();
    return 1;
}
EXPORT uint32_t waswan_keyboard_activate(uint32_t row, uint32_t from) {
    if (row > 1u || from != set.pat || mm_on) return 0;
    keyboard_pad(7u + 8u * row, 100);
    return 1;
}
EXPORT uint32_t waswan_drum_value(uint32_t lane, uint32_t field) {
    if (lane >= 8u || field > 3u || !obv_drums_selected()) return 0;
    const uint8_t *v = live_p[seq_trk].v;
    if (field == 3u) return v[73];
    const uint32_t param = field == 0u ? DP_LEVEL[lane] : field == 1u ? DP_DECAY[lane] : DP_PITCH[lane];
    return v[param];
}
EXPORT uint32_t waswan_drum_set(uint32_t part, uint32_t lane, uint32_t field, uint32_t value) {
    if (part >= NTRK || part != seq_trk || lane >= 8u || field > 2u || mm_on || !obv_drums_selected()) return 0;
    const uint32_t param = field == 0u ? DP_LEVEL[lane] : field == 1u ? DP_DECAY[lane] : DP_PITCH[lane];
    if (value > obv_param_max(&live_p[part], param) || (field == 2u && (value < 52u || value > 76u))) return 0;
    set_param_in(&live_p[part], param, (int32_t)value);
    auto_rec(param);
    dirty_page = dirty_hdr = 1;
    return 1;
}
EXPORT uint32_t waswan_controller_mode(uint32_t enabled) {
    if (enabled > 1u) return 0;
    if (enabled) mm_enter(); else if (mm_on) mm_leave();
    return 1;
}
EXPORT int32_t waswan_controller_value(uint32_t field) {
    switch (field) {
    case 0: return mm_main_ch();
    case 1: return mm_relative();
    case 2: return mm_dirty;
    default: return mm_data.selected;
    }
}
EXPORT uint32_t waswan_controller_set(uint32_t map, uint32_t channel, uint32_t relative) {
    if (!mm_on || map > 3u || channel < 1u || channel > 16u || relative > 1u) return 0;
    while (mm_data.selected != map) mm_setting_turn(1, map > mm_data.selected ? 1 : -1);
    if (mm_main_ch() != channel) mm_setting_turn(2, (int32_t)channel - (int32_t)mm_main_ch());
    if (mm_relative() != relative) mm_setting_turn(3, relative ? 1 : -1);
    return 1;
}
EXPORT uint32_t waswan_controller_action(uint32_t action) {
    if (!mm_on || action > 2u) return 0;
    if (!action) mm_save();
    else if (action == 1u) mm_safety();
    else { mm_edit = 0; mm_settings = 0; mm_full_dirty(); }
    return 1;
}
EXPORT uint32_t waswan_controller_entry(uint32_t index, uint32_t field) {
    if (index >= MM_N) return 0;
    if (field == 0u) return mm_reserved(index) ? 0u : mm_types(index);
    if (field < 4u) return sim_midi_entry(index, field - 1u);
    return index >= MM_PAD && index < MM_BTN ? mm_profile()->color[index - MM_PAD] : 0u;
}
EXPORT const char *waswan_controller_name(uint32_t index) {
    static char name[24];
    if (index >= MM_N) return "";
    mm_name(index, name);
    return name;
}
EXPORT uint32_t waswan_controller_edit(uint32_t index, uint32_t type, uint32_t number, uint32_t channel, uint32_t color, uint32_t map) {
    if (!mm_on || map != mm_data.selected || index >= MM_N || mm_reserved(index) || type >= MM_TYPES ||
        !(mm_types(index) >> type & 1u) || number > 127u || channel > 16u || color > 9u) return 0;
    mm_safety(); mm_select(index);
    mm_profile()->map[index] = (mm_entry_t){(uint8_t)type,(uint8_t)number,(uint8_t)channel};
    if (index >= MM_PAD && index < MM_BTN) mm_profile()->color[index - MM_PAD] = (uint8_t)color;
    mm_dirty = 1; mm_full_dirty();
    return 1;
}

static knob_view_t waswan_native_knobs[4];
EXPORT uint32_t waswan_native_sequence(void) {
    if (mm_on || !is_seq_page(page)) return 0;
    for (uint32_t i=0;i<4u;i++) {
        knob_view_t *k = &waswan_native_knobs[i];
        *k = (knob_view_t){0};
        if (layer == L_SEQ || step_held >= 0) seq_knob(k, i);
        else if (layer) layer_knob(k, i);
        else seq_view_knob(k, i);
    }
    return 1;
}
EXPORT const char *waswan_sequence_label(uint32_t i, uint32_t value) {
    if (i>=4u || !waswan_native_knobs[i].present) return "";
    return value ? waswan_native_knobs[i].value : waswan_native_knobs[i].label;
}
EXPORT uint32_t waswan_sequence_state(uint32_t field) {
    switch (field) {
    case 0: return seq_view;
    case 1: return seq_pg[seq_trk];
    case 2: return pat.trk[seq_trk].len;
    case 3: return rec;
    default: return end_mode;
    }
}
EXPORT uint32_t waswan_sequence_view(uint32_t view) {
    if (mm_on || !is_seq_page(page) || view >= NSV || save_ui_active() || layer) return 0;
    seq_view = view;
    if (view == SV_SLOTS) slot_sel = pat_queue ? pat_queue - 1u : set.pat;
    step_held = -1; audition_off(); entry_reset(); pf_redraw();
    return 1;
}
EXPORT uint32_t waswan_sequence_adjust(uint32_t knob, int32_t delta, uint32_t view, uint32_t part, uint32_t pattern) {
    if (mm_on || !is_seq_page(page) || knob >= 4u || (delta != -1 && delta != 1) ||
        view != seq_view || part != seq_trk || pattern != set.pat || save_ui_active()) return 0;
    sim_enc(knob, delta);
    return 1;
}

EXPORT uint32_t waswan_super_value(uint32_t part, uint32_t setting) {
    if (part >= NTRK || obv_patch_engine(&live_p[part]) != OBV_ANALOG || live_p[part].v[P_O1_WAVE] != W_SUPER) return 255u;
    return setting ? patch_super_mix(&live_p[part], 0) : live_p[part].v[P_O1_PW];
}
EXPORT uint32_t waswan_super_set(uint32_t part, uint32_t setting, uint32_t value) {
    if (part != seq_trk || setting > 1u || value > 127u || mm_on || waswan_super_value(part, setting) > 127u) return 0;
    if (setting) { patch_super_mix_set(&live_p[part], 0, value); trk_edited[part] = 1; }
    else { set_param_in(&live_p[part], P_O1_PW, (int32_t)value); auto_rec(P_O1_PW); }
    dirty_hdr = dirty_page = 1;
    return 1;
}
static const uint8_t waswan_drum_kit_params[] = {P_CUTOFF,P_RESO,P_FENV_AMT,P_DRIVE};
EXPORT uint32_t waswan_kit_value(uint32_t field) {
    return field < 4u && obv_drums_selected() ? live_p[seq_trk].v[waswan_drum_kit_params[field]] : 0u;
}
EXPORT uint32_t waswan_kit_set(uint32_t part, uint32_t field, uint32_t value) {
    if (part != seq_trk || part >= NTRK || field >= 4u || value > 127u || mm_on || !obv_drums_selected()) return 0;
    const uint32_t param = waswan_drum_kit_params[field];
    set_param_in(&live_p[part], param, (int32_t)value); auto_rec(param);
    dirty_hdr = dirty_page = 1;
    return 1;
}
EXPORT uint32_t waswan_drum_preset_save(uint32_t program, uint32_t scope, uint32_t token, uint32_t target) {
    if (program >= NPROG || scope != waswan_ui_scope() || token != waswan_program_token() ||
        target != waswan_editor_slot_token(program) || mm_on || !obv_drums_selected() || save_ui_active() ||
        pb_busy() || pat_queue || copy_to) return 0;
    preset_begin();
    save_to = program; preset_named = 1;
    memcpy(preset_snapshot.v + NPARAM, editor_name, PATCH_NAME);
    preset_commit();
    return 1;
}

EXPORT uint32_t waswan_sequence_action(uint32_t action, uint32_t part, uint32_t pattern) {
    if (mm_on || !is_seq_page(page) || part != seq_trk || pattern != set.pat || ctl_seq_run || rec || save_ui_active()) return 0;
    if (action == 0u && undo_ok) {
        pattern_t tmp = pat; pat = undo_pat; undo_pat = tmp; endless_recall(); pat_edited = 1;
    } else if (action == 1u && SV_ENTRY(seq_view)) {
        seq_clear_cursor();
    } else if (action == 2u && page == PG_SEQ && seq_view == SV_ENDLESS) {
        endless_toggle();
    } else return 0;
    pf_redraw();
    return 1;
}
