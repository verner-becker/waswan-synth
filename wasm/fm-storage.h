/* SPDX-License-Identifier: GPL-3.0-only */
/* Host session blobs have 16 KiB each. Their legacy payload ends at 4100.
 * Bind each extension to its 80-byte base patch. Empty records are all zero. */
enum { FM_PROGRAMS, FM_PATTERNS, FM_FAV_A, FM_FAV_B };
static uint8_t *fm_store_area(unsigned bank);
enum { FM_RECORD = 4 + FM_BYTES };
_Static_assert(4100 + 100 * FM_RECORD <= HOST_BLOB_SZ, "FM bank exceeds host blob");
static uint32_t fm_checksum(const wire_patch_t *wire, const fm_patch_t *fm) {
    uint32_t hash = 2166136261u;
    for (unsigned i=0; i<PATCH_BYTES; i++) hash=(hash ^ wire->v[i])*16777619u;
    for (unsigned i=0; i<FM_BYTES; i++) hash=(hash ^ fm->bytes[i])*16777619u;
    return hash;
}
static fm_patch_t fm_read(unsigned bank, unsigned slot, const wire_patch_t *wire) {
    const uint8_t *record = fm_store_area(bank) + slot * FM_RECORD;
    fm_patch_t fm = {0};
    if (record[4] != FM_TAG) return fm;
    uint32_t checksum;
    memcpy(&checksum, record, 4);
    memcpy(&fm, record + 4, FM_BYTES);
    if (checksum != fm_checksum(wire,&fm) || !fm_valid(&fm)) memset(&fm,0,sizeof fm);
    return fm;
}
static void fm_write(unsigned bank, unsigned slot, const wire_patch_t *wire, const fm_patch_t *fm) {
    uint8_t *record = fm_store_area(bank) + slot * FM_RECORD;
    if (!fm->bytes[0]) { memset(record,0,FM_RECORD); return; }
    uint32_t checksum = fm_checksum(wire,fm);
    memcpy(record,&checksum,4);
    memcpy(record+4,fm,FM_BYTES);
}
