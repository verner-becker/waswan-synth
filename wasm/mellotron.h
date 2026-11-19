/* SPDX-License-Identifier: GPL-3.0-only
 * Four-point Hermite reader adapted from FMEL-1 head_run by AntonioAltea,
 * SMK-37 port M. Geisler, SMKTRON 3428613. PCM banks prepared by the host.
 */
#define MEL_EXPORT __attribute__((visibility("default")))
#define MEL_ROUTES (NPART + 1) /* DAW parts and the live keyboard */
#define MEL_MAX_REGIONS 48
#define MEL_CAPACITY (8u * 1024u * 1024u) /* PCM16 frames per pair */
typedef struct { uint32_t offset, frames, root_inc; uint8_t bank, root; } mel_region_t;
typedef struct {
    int16_t *pcm;
    mel_region_t regions[MEL_MAX_REGIONS];
    uint8_t map[2][128], count;
    unsigned used;
} mel_pair_t;
static mel_pair_t mel_pairs[2];
static unsigned mel_current, mel_enabled[MEL_ROUTES];
typedef struct {
    int mix, transpose, cents, attack, release, loop, velocity, wow, flutter, wear, drive;
} mel_settings_t;
static mel_settings_t mel_settings[MEL_ROUTES];
typedef struct { uint64_t position[2]; unsigned time, seq; } mel_key_t;
static mel_key_t mel_keys[MEL_ROUTES][128];
typedef struct {
    uint32_t seq;
    uint8_t note;
    uint64_t phase[2];
    int32_t level, low;
} mel_head_t;
static mel_head_t mel_heads[NV];

MEL_EXPORT unsigned waswan_mel_begin(void) {
    mel_pair_t *pair=&mel_pairs[!mel_current];
    if(!pair->pcm){
        /* This freestanding host has no heap allocator. Reserve pages only when
         * loading a pair, outside render; subsequent swaps reuse the two arenas. */
        size_t page=__builtin_wasm_memory_grow(0,MEL_CAPACITY*sizeof(int16_t)/65536u);
        if(page==(size_t)-1)return 0;
        pair->pcm=(int16_t *)(page*65536u);
    }
    pair->count=pair->used=0;
    return (uintptr_t)pair->pcm;
}
MEL_EXPORT int waswan_mel_region(unsigned bank,unsigned root,unsigned frames) {
    mel_pair_t *pair=&mel_pairs[!mel_current];
    if(bank>1 || root>127 || frames<4 || frames>8*44100 || frames>MEL_CAPACITY-pair->used || pair->count>=MEL_MAX_REGIONS) return 0;
    for(unsigned i=0;i<pair->count;i++)
        if(pair->regions[i].bank==bank && pair->regions[i].root==root) return 0;
    pair->regions[pair->count++]=(mel_region_t){pair->used,frames,pitch_inc(root*256),bank,root};
    pair->used+=frames;
    return 1;
}
static unsigned mel_route(const voice_t *v) { return v->seq_owned>=3 ? v->part : NPART; }
static int mel_on(const voice_t *v) {
    unsigned route=mel_route(v);
    return mel_enabled[route] && (route!=NPART || v->part==0);
}
MEL_EXPORT int waswan_mel_busy(unsigned route) {
    for(unsigned i=0;i<NV;i++)
        if(mel_route(&vc[i])==route && (route!=NPART || vc[i].part==0) && (vc[i].gate || vc[i].ae.stage!=E_IDLE)) return 1;
    return 0;
}
MEL_EXPORT int waswan_mel_commit(void) {
    mel_pair_t *pair=&mel_pairs[!mel_current];
    for(unsigned r=0;r<MEL_ROUTES;r++) if(mel_enabled[r] && waswan_mel_busy(r)) return 0;
    for(int b=0;b<2;b++) for(int n=0;n<128;n++) {
        int distance=129;
        for(unsigned i=0;i<pair->count;i++){
            mel_region_t *region=&pair->regions[i];
            int delta=(int)region->root-n;
            if(delta<0)delta=-delta;
            if(region->bank==b && delta<distance){distance=delta;pair->map[b][n]=i;}
        }
        if(distance==129)return 0;
    }
    mel_current=!mel_current;
    memset(mel_keys,0,sizeof mel_keys);
    memset(mel_enabled,0,sizeof mel_enabled);
    return 1;
}
MEL_EXPORT void waswan_mel_config(unsigned route,int on,int mix,int transpose,int cents,int attack,int release,
                                  int loop,int velocity,int wow,int flutter,int wear,int drive) {
    if(route>=MEL_ROUTES)return;
    mel_settings[route]=(mel_settings_t){clampi(mix,0,100),clampi(transpose,-24,24),clampi(cents,-100,100),
        clampi(attack,1,2000),clampi(release,1,4000),!!loop,!!velocity,clampi(wow,0,100),
        clampi(flutter,0,100),clampi(wear,0,100),clampi(drive,0,100)};
    mel_enabled[route]=on && mel_pairs[mel_current].count;
}
MEL_EXPORT void waswan_mel_reset_keys(unsigned route) {
    if(route<MEL_ROUTES)memset(mel_keys[route],0,sizeof mel_keys[route]);
}

static int mel_sample(const int16_t *pcm,unsigned n,unsigned at,int t,int loop) {
    int a=at?pcm[at-1]:(loop?pcm[n-1]:pcm[0]), b=pcm[at];
    int c=at+1<n?pcm[at+1]:(loop?pcm[0]:0);
    int d=at+2<n?pcm[at+2]:(loop?pcm[at+2-n]:0);
    int c1=(c-a)>>1, c2=a-((5*b)>>1)+2*c-(d>>1), c3=((d-a)>>1)+((3*(b-c))>>1);
    int slope=((c3*t)>>12)+c2;
    slope=((slope*t)>>12)+c1;
    return ((slope*t)>>12)+b;
}
static int mel_triangle(unsigned frames,unsigned period) {
    int phase=frames%period;
    return (phase<(int)period/2?phase:(int)period-phase)*400/(int)period-100;
}
static void mel_render(voice_t *v,int32_t *out) {
    const unsigned route=mel_route(v);
    mel_settings_t s=mel_settings[route];
    mel_pair_t *pair=&mel_pairs[mel_current];
    mel_key_t *key=&mel_keys[route][v->note];
    mel_head_t *head=&mel_heads[v-vc];
    if(head->seq!=v->seq || head->note!=v->note){
        uint64_t rewind=(uint64_t)(uint32_t)(eng_t-key->time)*8u*65536u;
        for(int b=0;b<2;b++)head->phase[b]=!s.loop && key->position[b]>rewind?key->position[b]-rewind:0;
        head->seq=key->seq=v->seq; head->note=v->note; head->level=head->low=0;
    }
    int pitch=v->fm_pitch8+s.transpose*256+s.cents*256/100;
    if(s.wow)pitch+=mel_triangle(eng_t,63000)*s.wow/400;
    if(s.flutter)pitch+=mel_triangle(eng_t,6650)*s.flutter/800;
    unsigned inc=pitch_inc(clampi(pitch,0,127*256));
    int mix[CTL]={0};
    for(int b=0;b<2;b++){
        mel_region_t r=pair->regions[pair->map[b][v->note]];
        uint64_t phase=head->phase[b], step=((uint64_t)inc<<16)/r.root_inc;
        uint64_t end=(uint64_t)r.frames<<16;
        int weight=b?s.mix:100-s.mix;
        for(unsigned i=0;i<CTL;i++){
            if(s.loop && phase>=end)phase%=end;
            if(phase<end)mix[i]+=weight*mel_sample(pair->pcm+r.offset,r.frames,phase>>16,(phase&65535)>>4,s.loop);
            if(phase<((uint64_t)44100*8<<16))phase+=step;
        }
        head->phase[b]=phase;
        if(v->gate && key->seq==v->seq)key->position[b]=phase;
    }
    if(v->gate && key->seq==v->seq)key->time=eng_t;
    int gain=pt[v->part].gain_q12;
    if(v->key_combined && !v->seq_owned)gain=gain*(int)keyboard_voice_gain(v)/100;
    if(s.velocity)gain=gain*v->vel/127;
    /* Q24 keeps even a four-second linear release above one increment/frame. */
    int delta=(1<<24)/(44*(v->gate?s.attack:s.release));
    for(unsigned i=0;i<CTL;i++){
        head->level=clampi(head->level+(v->gate?delta:-delta),0,1<<24);
        int y=clampi(mix[i]/100,-32768,32767);
        if(s.wear){head->low+=(y-head->low)/4;y+=(head->low-y)*s.wear/100;}
        if(s.drive){int hot=y*(100+s.drive)/100;int mag=hot<0?-hot:hot;y=hot*32767/(32767+mag);}
        y=(int32_t)(((int64_t)y*head->level)>>24);
        voice_mix_sample(v,(y*gain)>>12,out+2*i);
    }
    if(!v->gate)v->ae.stage=head->level?E_REL:E_IDLE;
}
