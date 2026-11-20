/* SPDX-License-Identifier: GPL-3.0-only
 * Resident PCM voices, dispatched inside the existing allocator and DAW buses.
 * Manifest validation and the immutable gain tables live in sampler-runtime.js.
 */
#define WASWAN_SAMPLER 1
#define SAM_EXPORT __attribute__((visibility("default")))
#define SAM_BANKS 16u
#define SAM_REGIONS 128u
#define SAM_SETS 16u
#define SAM_SOURCES 18u /* sequencer, 16 DAW input channels, Synth keyboard */
#define SAM_PREVIEW (SAM_SOURCES+16u)
#define SAM_KEYBOARD 17u

typedef struct {
    int16_t *pcm;
    uint32_t channels, first, end, loop_first, loop_end, root_inc, flags;
    uint32_t group, articulation, set, member;
    float tuning, left, right, key[128], velocity[128];
} sam_region_t;
typedef struct {
    sam_region_t regions[SAM_REGIONS];
    uint32_t count, initial;
    uint32_t set_size[SAM_SETS], seed[SAM_SETS], random[SAM_SETS], avoid[SAM_SETS];
    uint32_t keys[128], clear[128];
} sam_bank_t;
typedef struct {
    uint32_t articulation, pos[SAM_SETS], rng[SAM_SETS];
} sam_selection_t;
typedef struct {
    uint32_t id, art, groups[4];
    uint8_t bank, velocity;
} sam_gesture_t;
typedef struct {
    uint32_t seq, gesture, bank, region;
    uint64_t phase;
    float gain;
    uint8_t fading;
    sam_gesture_t *key;
} sam_voice_t;

static sam_bank_t *sam_banks[SAM_BANKS];
static uint8_t sam_routes[NPART+1];
static sam_selection_t sam_states[NPART][SAM_SOURCES];
static sam_gesture_t sam_keys[NPART][SAM_SOURCES][128];
/* DAW clips carry stable gesture IDs; equal pitches on one or several channels
 * can release independently while all sequenced voices use the same DAW bus. */
typedef struct {sam_gesture_t key; uint32_t id; uint8_t part,channel,note;} sam_seq_key_t;
static sam_seq_key_t sam_seq_keys[NV];
static sam_selection_t sam_seq_states[NPART][16],sam_preview_states[NPART];
static sam_gesture_t sam_preview_keys[NPART][128];
static unsigned sam_preview_part=NPART;
static sam_voice_t sam_voices[NV];
static uint32_t sam_next_id;
static uint32_t sam_source(void) { return seq_note_source>=3 ? seq_note_source-3u : SAM_KEYBOARD; }
static unsigned sam_route(unsigned part,unsigned source) { return source==SAM_KEYBOARD ? (part==0 ? NPART : NPART+1u) : part; }

SAM_EXPORT uintptr_t waswan_sampler_pages(uint32_t pages) {
    if(!pages || pages>1024u)return 0;
    size_t base=__builtin_wasm_memory_grow(0,pages);
    return base==(size_t)-1 ? 0 : base*65536u;
}
SAM_EXPORT int waswan_sampler_bank(unsigned bank,unsigned count,unsigned initial) {
    if(bank>=SAM_BANKS||!count||count>SAM_REGIONS)return 0;
    if(!sam_banks[bank])sam_banks[bank]=(sam_bank_t*)waswan_sampler_pages((sizeof(sam_bank_t)+65535u)/65536u);
    if(!sam_banks[bank])return 0;
    sam_bank_t *b=sam_banks[bank];
    memset(b->keys,0,sizeof b->keys);memset(b->clear,0,sizeof b->clear);
    b->count=count;b->initial=initial;return 1;
}
SAM_EXPORT void waswan_sampler_switch(unsigned bank,unsigned key,unsigned clear,unsigned select) {
    if(bank<SAM_BANKS && sam_banks[bank] && key<128){sam_banks[bank]->keys[key]|=select;sam_banks[bank]->clear[key]|=clear;}
}
SAM_EXPORT void waswan_sampler_variation(unsigned bank,unsigned set,unsigned size,unsigned seed,unsigned random,unsigned avoid) {
    if(bank>=SAM_BANKS||!sam_banks[bank]||set>=SAM_SETS||!size||size>16)return;
    sam_bank_t *b=sam_banks[bank];b->set_size[set]=size;b->seed[set]=seed?seed:0x6d2b79f5;b->random[set]=random;b->avoid[set]=avoid;
}
SAM_EXPORT uintptr_t waswan_sampler_region(unsigned bank,unsigned i,uintptr_t pcm,unsigned channels,unsigned first,unsigned end,
        unsigned loop_first,unsigned loop_end,unsigned root,unsigned flags,unsigned group,unsigned art,unsigned set,unsigned member,
        float tuning,float left,float right) {
    if(bank>=SAM_BANKS||!sam_banks[bank]||i>=sam_banks[bank]->count||!pcm||(channels!=1&&channels!=2)||first>=end||
        (loop_end&&(loop_first<first||loop_first>=loop_end||loop_end>end))||root>127||group>=128||set>SAM_SETS||member>=16)return 0;
    sam_region_t *r=&sam_banks[bank]->regions[i];
    r->pcm=(int16_t*)pcm;r->channels=channels;r->first=first;r->end=end;r->loop_first=loop_first;r->loop_end=loop_end;
    r->root_inc=pitch_inc(root*256);r->flags=flags;r->group=group;r->articulation=art;r->set=set;r->member=member;
    r->tuning=tuning;r->left=left;r->right=right;
    return (uintptr_t)r->key;
}
static sam_selection_t *sam_state(unsigned part,unsigned source) {
    if(source==SAM_PREVIEW)return &sam_preview_states[part];
    if(source==0)return &sam_seq_states[part][0];
    return source>=SAM_SOURCES?&sam_seq_states[part][source-SAM_SOURCES]:&sam_states[part][source];
}
static void sam_reset_state(unsigned part,unsigned source,unsigned bank) {
    sam_selection_t *s=sam_state(part,source);
    memset(s,0,sizeof *s);
    if(bank){s->articulation=sam_banks[bank-1]->initial;
        for(unsigned j=0;j<SAM_SETS;j++)s->rng[j]=sam_banks[bank-1]->seed[j];}
}
SAM_EXPORT void waswan_sampler_bind(unsigned route,unsigned bank) {
    if(route>NPART||bank>SAM_BANKS||(bank&&!sam_banks[bank-1]))return;
    sam_routes[route]=bank;
    if(route==NPART)sam_reset_state(0,SAM_KEYBOARD,bank);
    else {
        for(unsigned s=0;s<SAM_KEYBOARD;s++)sam_reset_state(route,s,bank);
        for(unsigned ch=0;ch<16;ch++)sam_reset_state(route,SAM_SOURCES+ch,bank);
    }
}
SAM_EXPORT void waswan_sampler_reset_seq(void) {
    memset(sam_seq_keys,0,sizeof sam_seq_keys);
    for(unsigned p=0;p<NPART;p++){
        sam_reset_state(p,0,sam_routes[p]);memset(sam_keys[p][0],0,sizeof sam_keys[p][0]);
        for(unsigned ch=0;ch<16;ch++)sam_reset_state(p,SAM_SOURCES+ch,sam_routes[p]);
    }
}
SAM_EXPORT uintptr_t waswan_sampler_seq_state(unsigned part) {
    return part<NPART?(uintptr_t)sam_seq_states[part]:0;
}
SAM_EXPORT unsigned waswan_sampler_state_size(void) { return sizeof(sam_seq_states[0]); }
static int sam_voice_active(unsigned i) {
    return sam_voices[i].bank && sam_voices[i].seq==vc[i].seq && (vc[i].gate||vc[i].ae.stage!=E_IDLE);
}
SAM_EXPORT unsigned waswan_sampler_bank_used(unsigned bank) {
    if(bank>=SAM_BANKS)return 1;
    for(unsigned r=0;r<=NPART;r++)if(sam_routes[r]==bank+1)return 1;
    for(unsigned i=0;i<NV;i++)if(sam_voice_active(i)&&sam_voices[i].bank==bank+1)return 1;
    for(unsigned i=0;i<NV;i++)if(sam_seq_keys[i].key.bank==bank+1)return 1;
    if(sam_preview_part<NPART)for(unsigned n=0;n<128;n++)if(sam_preview_keys[sam_preview_part][n].bank==bank+1)return 1;
    for(unsigned p=0;p<NPART;p++)for(unsigned s=0;s<SAM_SOURCES;s++)for(unsigned n=0;n<128;n++)
        if(sam_keys[p][s][n].bank==bank+1)return 1;
    return 0;
}
static unsigned sam_choose(sam_bank_t *b,sam_selection_t *s,unsigned set,unsigned mask) {
    unsigned count=b->set_size[set],pos=s->pos[set];
    if(b->random[set]){
        if(b->avoid[set] && pos && (mask & (mask-1)))mask &= ~(1u<<(pos-1));
        unsigned x=s->rng[set];x^=x<<13;x^=x>>17;x^=x<<5;s->rng[set]=x;
        unsigned index=x%(unsigned)__builtin_popcount(mask);
        while(index--)mask&=mask-1;
        unsigned picked=__builtin_ctz(mask);s->pos[set]=picked+1;return 1u<<picked;
    }
    for(unsigned j=0;j<count;j++){unsigned picked=(pos+j)%count;
        if(mask>>picked&1u){s->pos[set]=(picked+1)%count;return 1u<<picked;}}
    return 0;
}
static void sam_select(unsigned part,unsigned note,unsigned source,sam_gesture_t *key,int release,int silent) {
    unsigned selected_bank=key->bank;sam_bank_t *b=sam_banks[selected_bank-1];
    sam_selection_t *s=sam_state(part,source);
    unsigned masks[SAM_SETS]={0},ids[SAM_REGIONS],count=0;
    for(unsigned i=0;i<b->count;i++){
        sam_region_t *r=&b->regions[i];
        if((r->flags&1u)!=(unsigned)release || (r->articulation && !(key->art&r->articulation)) ||
           r->key[note]<=0 || r->velocity[key->velocity]<=0 ||
           (release && !(key->groups[r->group>>5]>>(r->group&31)&1u)))continue;
        ids[count++]=i;if(r->set)masks[r->set-1]|=1u<<r->member;
    }
    for(unsigned i=0;i<SAM_SETS;i++)if(masks[i])masks[i]=sam_choose(b,s,i,masks[i]);
    for(unsigned i=0;i<count;i++){
        unsigned id=ids[i];sam_region_t *r=&b->regions[id];
        if(r->set && !(masks[r->set-1]>>r->member&1u))continue;
        key->groups[r->group>>5]|=1u<<(r->group&31);
        if(silent)continue;
        unsigned index=voice_alloc(part);voice_t *v=&vc[index];
        if(v->gate||v->ae.stage!=E_IDLE)super_retire(index);
        voice_start(v,part,note,key->velocity,0,0);v->grp=0;
        sam_voices[index]=(sam_voice_t){.seq=v->seq,.gesture=key->id,.bank=selected_bank,.region=id,
            .phase=(uint64_t)r->first<<20,.gain=r->key[note]*r->velocity[key->velocity],.key=key};
    }
}
static int sam_attack_key(unsigned part,unsigned note,unsigned velocity,unsigned source,int silent,sam_gesture_t *key) {
    unsigned route=sam_route(part,source);
    if(route>NPART||!sam_routes[route])return 0;
    unsigned bank=sam_routes[route];sam_bank_t *b=sam_banks[bank-1];
    sam_selection_t *s=sam_state(part,source);
    if(key->bank && !silent){
        for(unsigned i=0;i<NV;i++)if(sam_voice_active(i) && sam_voices[i].gesture==key->id){
            sam_region_t *old=&sam_banks[sam_voices[i].bank-1]->regions[sam_voices[i].region];
            if(!(old->flags&2))vc[i].gate=0;
        }
    }
    *key=(sam_gesture_t){0};
    if(b->keys[note]){s->articulation=(s->articulation&~b->clear[note])|b->keys[note];return 1;}
    *key=(sam_gesture_t){.id=++sam_next_id,.art=s->articulation,.bank=bank,.velocity=velocity};
    sam_select(part,note,source,key,0,silent);
    if(!(key->groups[0]|key->groups[1]|key->groups[2]|key->groups[3]))key->bank=0;
    return 1;
}
static int sam_release_key(unsigned part,unsigned note,unsigned source,int silent,sam_gesture_t *key) {
    if(!key->bank)return 0;
    for(unsigned i=0;i<NV && !silent;i++)if(sam_voice_active(i)&&sam_voices[i].gesture==key->id)vc[i].gate=0;
    sam_select(part,note,source,key,1,silent);
    key->bank=0;
    return 1;
}
static int sam_attack(unsigned part,unsigned note,unsigned velocity,unsigned source,int silent) {
    return sam_attack_key(part,note,velocity,source,silent,&sam_keys[part][source][note]);
}
static int sam_release(unsigned part,unsigned note,unsigned source,int silent) {
    return sam_release_key(part,note,source,silent,&sam_keys[part][source][note]);
}
static int sam_sequence_note(unsigned part,unsigned note,unsigned velocity,unsigned channel,unsigned id,int silent) {
    if(part>=NPART||note>=128||velocity>=128||channel>=16||!id||!sam_routes[part])return 0;
    sam_seq_key_t *free_key=0,*found=0;
    for(unsigned i=0;i<NV;i++){
        sam_seq_key_t *k=&sam_seq_keys[i];
        if(!k->key.bank){if(!free_key)free_key=k;continue;}
        if(k->part==part&&k->channel==channel&&k->id==id){found=k;break;}
    }
    if(!velocity){
        if(found && found->note==note)sam_release_key(part,note,SAM_SOURCES+channel,silent,&found->key);
        return 1;
    }
    if(!found)found=free_key;
    if(!found){
        /* At the gesture budget discard the oldest release entitlement. Voice
         * stealing still follows the global allocator, including its guards. */
        found=sam_seq_keys;
        for(unsigned i=1;i<NV;i++)if(sam_seq_keys[i].key.id<found->key.id)found=&sam_seq_keys[i];
    }
    found->part=part;found->note=note;found->channel=channel;found->id=id;
    return sam_attack_key(part,note,velocity,SAM_SOURCES+channel,silent,&found->key);
}
SAM_EXPORT void waswan_sampler_chase_id(unsigned part,unsigned note,unsigned velocity,unsigned channel,unsigned id) {
    sam_sequence_note(part,note,velocity,channel,id,1);
}
SAM_EXPORT void waswan_sampler_chase(unsigned part,unsigned note,unsigned velocity) {
    if(part<NPART&&note<128&&velocity<128){if(velocity)sam_attack(part,note,velocity,0,1);else sam_release(part,note,0,1);}
}
static void sam_forget(unsigned part,unsigned source) {
    memset(sam_keys[part][source],0,sizeof sam_keys[part][source]);
    if(!source)for(unsigned i=0;i<NV;i++)if(sam_seq_keys[i].part==part)sam_seq_keys[i].key.bank=0;
    for(unsigned i=0;i<NV;i++)if(sam_voice_active(i)&&vc[i].part==part&&
       (source==SAM_KEYBOARD?vc[i].seq_owned<3:vc[i].seq_owned==source+3))sam_voices[i].fading=1;
}
static void sam_panic(void) {
    memset(sam_keys,0,sizeof sam_keys);
    memset(sam_seq_keys,0,sizeof sam_seq_keys);
    memset(sam_preview_keys,0,sizeof sam_preview_keys);
    for(unsigned i=0;i<NV;i++)sam_voices[i].fading=1;
}
static void sam_render(voice_t *v,int32_t *out) {
    unsigned i=v-vc;sam_voice_t *h=&sam_voices[i];sam_region_t *r=&sam_banks[h->bank-1]->regions[h->region];
    int bend=daw_is_live(v->seq_owned)?daw_live_bend8[v->seq_owned-4][v->part]:v->seq_owned==3?daw_bend8[v->part]:pt[v->part].bend8;
    uint64_t step=(uint64_t)((double)pitch_inc(clampi((int)v->note*256+bend,0,127*256))/r->root_inc*r->tuning*1048576.);
    if(!step)step=1; /* Even extreme negative tuning must eventually reach EOF. */
    uint64_t end=(uint64_t)r->end<<20,loop_end=(uint64_t)r->loop_end<<20,loop_length=(uint64_t)(r->loop_end-r->loop_first)<<20;
    for(unsigned j=0;j<CTL;j++){
        if(loop_length && h->phase>=loop_end)h->phase=(loop_end-loop_length)+(h->phase-loop_end)%loop_length;
        if(h->phase>=end || h->fading>64){v->gate=0;v->ae.stage=E_IDLE;h->bank=0;v->guard_l=v->guard_r=0;return;}
        if(!v->gate && !(r->flags&2) && !h->fading)h->fading=1;
        unsigned frame=h->phase>>20,next=frame+1;
        if(loop_length && next==r->loop_end)next=r->loop_first;
        float frac=(float)(h->phase&0xfffff)/1048576.f;
        float gain=h->gain*4.f;
        if(h->fading)gain*=(65-h->fading++)/64.f;
        if(v->guard_in){gain*=(STEAL_FADE-v->guard_in)/(float)STEAL_FADE;v->guard_in--;}
        int32_t y[2];
        for(unsigned c=0;c<r->channels;c++){
            int a=r->pcm[frame*r->channels+c],b=next<r->end?r->pcm[next*r->channels+c]:0;
            float sample=(a+(b-a)*frac)*gain*(c?r->right:r->left);
            y[c]=(int32_t)__builtin_fminf(131071.f,__builtin_fmaxf(-131072.f,sample));
        }
        if(r->channels==1){int a=r->pcm[frame],b=next<r->end?r->pcm[next]:0;float sample=(a+(b-a)*frac)*gain*r->right;y[1]=(int32_t)__builtin_fminf(131071.f,__builtin_fmaxf(-131072.f,sample));}
        out[j*2]+=y[0];out[j*2+1]+=y[1];v->guard_l=y[0];v->guard_r=y[1];h->phase+=step;
    }
    v->ae.stage=v->gate?E_SUS:E_REL;
}
/* A stolen attack can no longer produce a release sample for a later Note Off.
 * Layer siblings still sounding for the same gesture retain that entitlement. */
static void sam_stolen(voice_t *v) {
    unsigned i=v-vc;sam_voice_t *h=&sam_voices[i];
    if(!h->bank||h->seq!=v->seq)return;
    if(v->gate||v->ae.stage!=E_IDLE)super_retire(i);
    sam_gesture_t *key=h->key;
    unsigned id=h->gesture;h->bank=0;
    if(key->id!=id||!key->bank)return;
    for(unsigned j=0;j<NV;j++)if(sam_voice_active(j)&&sam_voices[j].gesture==id)return;
    key->bank=0;
}

SAM_EXPORT unsigned waswan_sampler_voice_region(unsigned i) {
    return i<NV && sam_voice_active(i) ? sam_voices[i].region+1u : 0;
}
SAM_EXPORT float waswan_sampler_voice_gain(unsigned i) {
    return i<NV && sam_voice_active(i) ? sam_voices[i].gain : 0;
}

/* A piano roll preview borrows the part output but owns its gestures. */
SAM_EXPORT unsigned waswan_sampler_preview_begin(unsigned part) {
    if(part>=NPART || !sam_routes[part] || sam_preview_part!=NPART)return 0;
    sam_reset_state(part,SAM_PREVIEW,sam_routes[part]);sam_preview_part=part;
    return 1;
}
SAM_EXPORT unsigned waswan_sampler_preview_note(unsigned part,unsigned note,unsigned velocity) {
    if(part>=NPART || part!=sam_preview_part || note>127 || velocity>127)return 0;
    unsigned previous=seq_note_source;seq_note_source=20u;
    sam_gesture_t *key=&sam_preview_keys[part][note];
    if(velocity)sam_attack_key(part,note,velocity,SAM_PREVIEW,0,key);
    else sam_release_key(part,note,SAM_PREVIEW,0,key);
    seq_note_source=previous;return 1;
}
SAM_EXPORT unsigned waswan_sampler_preview_end(unsigned part) {
    if(part>=NPART || part!=sam_preview_part)return 0;
    for(unsigned i=0;i<NV;i++)if(sam_voice_active(i)&&vc[i].seq_owned==20u&&vc[i].part==part)super_retire(i);
    memset(sam_preview_keys[part],0,sizeof sam_preview_keys[part]);sam_preview_part=NPART;
    return 1;
}
