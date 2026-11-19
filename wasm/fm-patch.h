/* SPDX-License-Identifier: GPL-3.0-only */
/* Byte layout shared with portable tone snapshots. OP1 is first here,
 * while Dexed stores OP6 first in an unpacked voice. */
enum { FM_TAG = 0xf1, FM_HEADER = 5, FM_OP_BYTES = 14, FM_BYTES = FM_HEADER + 6 * FM_OP_BYTES };
typedef struct { uint8_t bytes[FM_BYTES]; } fm_patch_t;
enum { FM_MODE, FM_COARSE, FM_FINE, FM_DETUNE, FM_OUTPUT, FM_VELOCITY, FM_RATE1, FM_LEVEL1 = 10 };
static const uint8_t fm_maximum[FM_OP_BYTES] = {1,31,99,14,99,7,99,99,99,99,99,99,99,99};
static unsigned fm_bound(unsigned field) {
    static const uint8_t globals[FM_HEADER] = {0,31,7,127,127};
    return field < FM_HEADER ? globals[field] : fm_maximum[(field - FM_HEADER) % FM_OP_BYTES];
}
static int fm_valid(const fm_patch_t *fm) {
    if (fm->bytes[0] != FM_TAG) return 0;
    for (unsigned i = 1; i < FM_BYTES; i++) if (fm->bytes[i] > fm_bound(i)) return 0;
    return 1;
}
static fm_patch_t fm_init_patch(void) {
    fm_patch_t fm = {{FM_TAG, 0, 0, 127, 0}};
    for (unsigned op = 0; op < 6; op++) {
        const uint8_t initial[FM_OP_BYTES] = {0,1,0,7,op ? 72 : 96,2,96,56,40,65,99,80,70,0};
        memcpy(fm.bytes + FM_HEADER + op * FM_OP_BYTES, initial, sizeof initial);
    }
    return fm;
}
