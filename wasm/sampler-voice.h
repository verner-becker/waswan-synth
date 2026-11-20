/* SPDX-License-Identifier: GPL-3.0-only
 * Resident PCM voices, dispatched inside the existing allocator and DAW buses.
 * Manifest validation and the immutable gain tables live in sampler-runtime.js.
 */
#define WASWAN_SAMPLER 1
#define SAM_EXPORT __attribute__((visibility("default")))
#define SAM_BANKS 16u
#define SAM_REGIONS 512u
#define SAM_REGION_CHUNK 32u
#define SAM_SETS 64u
#define SAM_SOURCES 18u /* sequencer, 16 DAW input channels, Synth keyboard */
#define SAM_PREVIEW (SAM_SOURCES+16u)
#define SAM_KEYBOARD 17u

#include "sampler-modulation.h"

typedef struct {
    int16_t *pcm;
    uint32_t channels, first, end, loop_first, loop_end, root_inc, flags;
    uint32_t group, articulation, set, member;
    float tuning, left, right, key[128], velocity[128];
    unsigned loop_mode, crossfade, choke, voice_limit, retrigger;
    sam_program_t program;
} sam_region_t;
typedef struct {
    /* Pages remain reusable when this bank slot receives a smaller revision. */
    sam_region_t *regions[SAM_REGIONS/SAM_REGION_CHUNK];
    uint32_t candidates[2][128][SAM_REGIONS/32];
    uint32_t count, initial,cc_switch_count;
    struct { unsigned cc,lo,hi,clear,select; } cc_switches[16];
    uint32_t set_size[SAM_SETS], seed[SAM_SETS], random[SAM_SETS], avoid[SAM_SETS];
    uint32_t keys[128], clear[128];
} sam_bank_t;
typedef struct {
    uint32_t articulation, rng[SAM_SETS];
    uint8_t pos[SAM_SETS];
    sam_controls_t controls;
} sam_selection_t;
typedef struct {
    uint32_t id, art, groups[4];
    uint8_t bank, velocity;
} sam_gesture_t;
typedef struct {
    uint32_t seq, gesture, bank, region;
    uint64_t phase;
    float gain;
    unsigned source;
    sam_mod_voice_t modulation;
    uint8_t fading;
    sam_gesture_t *key;
} sam_voice_t;

_Static_assert(sizeof(sam_region_t)*SAM_REGION_CHUNK<=65536u,"A region chunk must fit one WASM page");
static inline sam_region_t *sam_row(sam_bank_t *bank,unsigned index) {
    return &bank->regions[index/SAM_REGION_CHUNK][index%SAM_REGION_CHUNK];
}
static sam_bank_t *sam_banks[SAM_BANKS];
static uint8_t sam_routes[NPART+1];
static sam_selection_t sam_states[NPART][SAM_SOURCES];
static sam_gesture_t sam_keys[NPART][SAM_SOURCES][128];
/* DAW clips carry stable gesture IDs; equal pitches on one or several channels
 * can release independently while all sequenced voices use the same DAW bus. */
typedef struct {sam_gesture_t key; uint32_t id; uint8_t part,channel,note,released;} sam_seq_key_t;
static sam_seq_key_t sam_seq_keys[NV];
static sam_selection_t sam_seq_states[NPART][16],sam_preview_states[NPART];
static sam_gesture_t sam_preview_keys[NPART][128];
static unsigned sam_preview_part=NPART;
static struct {sam_gesture_t key;unsigned note,released;} sam_pads[16];
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
    memset(b->candidates,0,sizeof b->candidates);
    memset(b->keys,0,sizeof b->keys);memset(b->clear,0,sizeof b->clear);
    b->count=count;b->initial=initial;b->cc_switch_count=0;return 1;
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
    sam_bank_t *b=sam_banks[bank];
    unsigned page=i/SAM_REGION_CHUNK;
    if(!b->regions[page])b->regions[page]=(sam_region_t*)waswan_sampler_pages(1);
    if(!b->regions[page])return 0;
    sam_region_t *r=sam_row(b,i);
    r->pcm=(int16_t*)pcm;r->channels=channels;r->first=first;r->end=end;r->loop_first=loop_first;r->loop_end=loop_end;
    r->root_inc=pitch_inc(root*256);r->flags=flags;r->group=group;r->articulation=art;r->set=set;r->member=member;
    r->tuning=tuning;r->left=left;r->right=right;memset(&r->program,0,sizeof r->program);
    return (uintptr_t)r->key;
}
static sam_region_t *sam_region(unsigned bank,unsigned region) {
    if(bank>=SAM_BANKS||!sam_banks[bank]||region>=sam_banks[bank]->count||!sam_banks[bank]->regions[region/SAM_REGION_CHUNK])return 0;
    return sam_row(sam_banks[bank],region);
}
SAM_EXPORT int waswan_sampler_playback(unsigned bank,unsigned region,unsigned mode,unsigned fade,unsigned choke,
                                       unsigned limit,unsigned retrigger,float gain,float pan) {
    sam_region_t *r=sam_region(bank,region);
    if(!r||mode>2||limit>NV||choke>SAM_REGIONS||fade>(r->loop_end-r->loop_first)/2||
       (mode==2 && r->loop_end-r->loop_first<=1+fade))return 0;
    r->loop_mode=mode;r->crossfade=fade;r->choke=choke;r->voice_limit=limit;r->retrigger=retrigger;
    r->program.gain=gain;r->program.pan=pan;return 1;
}
SAM_EXPORT int waswan_sampler_filter(unsigned bank,unsigned region,unsigned type,float cutoff,float resonance) {
    sam_region_t *r=sam_region(bank,region);if(!r||type<1||type>3)return 0;
    r->program.enabled=1;r->program.filter=type;r->program.cutoff_q8=cutoff;r->program.resonance=resonance;return 1;
}
SAM_EXPORT int waswan_sampler_envelope(unsigned bank,unsigned region,unsigned index,float a,float d,float sustain,float release) {
    sam_region_t *r=sam_region(bank,region);if(!r||index>2)return 0;
    r->program.enabled=1;r->program.env[index]=(sam_env_t){a*44.1f,d*44.1f,sustain,release*44.1f,1};return 1;
}
SAM_EXPORT int waswan_sampler_lfo(unsigned bank,unsigned region,unsigned shape,float rate) {
    sam_region_t *r=sam_region(bank,region);if(!r||shape<1||shape>2||rate<=0||rate>40)return 0;
    r->program.enabled=1;r->program.lfo=shape;r->program.lfo_step=(uint32_t)(rate*(4294967296.*CTL/44100.));return 1;
}
SAM_EXPORT int waswan_sampler_modulation(unsigned bank,unsigned region,unsigned source,unsigned dest,unsigned bipolar,float depth) {
    sam_region_t *r=sam_region(bank,region);
    if(!r||r->program.routes>=16||source>=144||(source>8&&source<16)||dest>=5||bipolar>1)return 0;
    r->program.enabled=1;r->program.route[r->program.routes++]=(sam_mod_route_t){source,dest,bipolar,depth};return 1;
}
SAM_EXPORT int waswan_sampler_cc_switch(unsigned bank,unsigned cc,unsigned lo,unsigned hi,unsigned clear,unsigned select) {
    if(bank>=SAM_BANKS||!sam_banks[bank]||cc>127||lo>hi||hi>127)return 0;
    sam_bank_t *b=sam_banks[bank];if(b->cc_switch_count>=16)return 0;
    unsigned i=b->cc_switch_count++;b->cc_switches[i].cc=cc;b->cc_switches[i].lo=lo;b->cc_switches[i].hi=hi;
    b->cc_switches[i].clear=clear;b->cc_switches[i].select=select;return 1;
}
SAM_EXPORT void waswan_sampler_index_region(unsigned bank,unsigned region) {
    sam_region_t *r=sam_region(bank,region);
    if(!r)return;
    uint32_t bit=1u<<(region&31u);
    for(unsigned note=0;note<128;note++)if(r->key[note]>0)
        sam_banks[bank]->candidates[r->flags&1u][note][region>>5]|=bit;
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
    for(unsigned i=0;i<16;i++)if(sam_pads[i].key.bank==bank+1)return 1;
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
static void sam_stolen(voice_t *v);
/* Sequenced and monitored hits share the track. Keyboard and preview have isolated owners. */
static unsigned sam_domain(unsigned source) {return source==SAM_KEYBOARD?1:source==SAM_PREVIEW?2:0;}
static void sam_enforce_group(unsigned part,unsigned source,unsigned bank,const sam_region_t *r,unsigned gesture,unsigned note) {
    if(!r->choke&&!r->voice_limit&&!r->retrigger)return;
    unsigned oldest=NV,count=0;
    for(unsigned i=0;i<NV;i++){
        sam_voice_t *h=&sam_voices[i];
        if(!sam_voice_active(i)||h->bank!=bank||vc[i].part!=part||sam_domain(h->source)!=sam_domain(source))continue;
        sam_region_t *other=sam_row(sam_banks[bank-1],h->region);
        if(h->gesture!=gesture && ((r->choke && other->choke==r->choke)||
           (r->retrigger && other->group==r->group && vc[i].note==note))){
            sam_stolen(&vc[i]);continue;
        }
        if(other->group==r->group){count++;if(oldest==NV||vc[i].seq<vc[oldest].seq)oldest=i;}
    }
    if(r->voice_limit&&count>=r->voice_limit&&oldest<NV)sam_stolen(&vc[oldest]);
}
static void sam_select(unsigned part,unsigned note,unsigned source,sam_gesture_t *key,int release,int silent) {
    unsigned selected_bank=key->bank;sam_bank_t *b=sam_banks[selected_bank-1];
    sam_selection_t *s=sam_state(part,source);
    uint16_t masks[SAM_SETS]={0},ids[SAM_REGIONS];
    unsigned count=0,sets[2]={0};
    const uint32_t *candidates=b->candidates[release][note];
    for(unsigned word=0;word<(b->count+31u)/32u;word++) {
        uint32_t remaining=candidates[word];
        while(remaining){
            unsigned i=word*32u+(unsigned)__builtin_ctz(remaining);
            remaining&=remaining-1u;
            sam_region_t *r=sam_row(b,i);
            if((r->articulation && !(key->art&r->articulation)) || r->velocity[key->velocity]<=0 ||
               (release && !(key->groups[r->group>>5]>>(r->group&31)&1u)))continue;
            ids[count++]=i;
            if(r->set){unsigned set=r->set-1;masks[set]|=1u<<r->member;sets[set>>5]|=1u<<(set&31);}
        }
    }
    for(unsigned word=0;word<2;word++)while(sets[word]){
        unsigned set=word*32u+(unsigned)__builtin_ctz(sets[word]);
        sets[word]&=sets[word]-1u;masks[set]=sam_choose(b,s,set,masks[set]);
    }
    unsigned selected=0;
    for(unsigned i=0;i<count;i++){
        unsigned id=ids[i];sam_region_t *r=sam_row(b,id);
        if(r->set && !(masks[r->set-1]>>r->member&1u))continue;
        if(selected++>=NV)break;
        key->groups[r->group>>5]|=1u<<(r->group&31);
        if(silent)continue;
        sam_enforce_group(part,source,selected_bank,r,key->id,note);
        unsigned index=voice_alloc(part);voice_t *v=&vc[index];
        if(v->gate||v->ae.stage!=E_IDLE)super_retire(index);
        voice_start(v,part,note,key->velocity,0,0);v->grp=0;key->bank=selected_bank;
        sam_voices[index]=(sam_voice_t){.seq=v->seq,.gesture=key->id,.bank=selected_bank,.region=id,
            .phase=0,.source=source,.gain=r->key[note]*r->velocity[key->velocity],.key=key};
    }
}
static int sam_attack_key(unsigned part,unsigned note,unsigned velocity,unsigned source,int silent,sam_gesture_t *key) {
    unsigned route=sam_route(part,source);
    if(route>NPART||!sam_routes[route])return 0;
    unsigned bank=sam_routes[route];sam_bank_t *b=sam_banks[bank-1];
    sam_selection_t *s=sam_state(part,source);
    if(key->bank && !silent){
        for(unsigned i=0;i<NV;i++)if(sam_voice_active(i) && sam_voices[i].gesture==key->id){
            sam_region_t *old=sam_row(sam_banks[sam_voices[i].bank-1],sam_voices[i].region);
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
        if(found && found->note==note && !found->released) {
            if(sam_state(part,SAM_SOURCES+channel)->controls.cc[64]>=64)found->released=1;
            else sam_release_key(part,note,SAM_SOURCES+channel,silent,&found->key);
        }
        return 1;
    }
    if(!found)found=free_key;
    if(!found){
        /* At the gesture budget discard the oldest release entitlement. Voice
         * stealing still follows the global allocator, including its guards. */
        found=sam_seq_keys;
        for(unsigned i=1;i<NV;i++)if(sam_seq_keys[i].key.id<found->key.id)found=&sam_seq_keys[i];
    }
    found->part=part;found->note=note;found->channel=channel;found->id=id;found->released=0;
    return sam_attack_key(part,note,velocity,SAM_SOURCES+channel,silent,&found->key);
}
SAM_EXPORT unsigned waswan_sampler_live_pad(unsigned index,unsigned note,unsigned velocity) {
    if(index<1||index>16||note>127||velocity>127)return 0;
    unsigned i=index-1,previous=seq_note_source;seq_note_source=21u;
    if(velocity){
        if(!sam_routes[NPART]){seq_note_source=previous;return 0;}
        sam_pads[i].note=note;sam_pads[i].released=0;
        sam_attack_key(0,note,velocity,SAM_KEYBOARD,0,&sam_pads[i].key);
    } else if(sam_pads[i].key.bank && sam_pads[i].note==note){
        if(sam_state(0,SAM_KEYBOARD)->controls.cc[64]>=64)sam_pads[i].released=1;
        else sam_release_key(0,note,SAM_KEYBOARD,0,&sam_pads[i].key);
    }
    seq_note_source=previous;return 1;
}
SAM_EXPORT unsigned waswan_sampler_control(unsigned part,unsigned channel,unsigned input_origin,unsigned kind,
                                          unsigned number,int value,unsigned silent) {
    if(part>=NPART||channel>15||input_origin>2||kind>3||number>127||
       (kind==3?(value< -8192||value>8191):(value<0||value>127)))return 0;
    unsigned source=input_origin==2?SAM_KEYBOARD:input_origin?1+channel:SAM_SOURCES+channel,route=sam_route(part,source);
    if(route>NPART||!sam_routes[route]){
        if(input_origin==2 && kind==0 && number==64 && value<64) {
            sam_state(0,SAM_KEYBOARD)->controls.cc[64]=0;
            for(unsigned i=0;i<16;i++)if(sam_pads[i].released)waswan_sampler_live_pad(i+1,sam_pads[i].note,0);
        }
        return 0;
    }
    sam_selection_t *s=sam_state(part,source);
    if(kind==1)s->controls.channel_pressure=value;
    else if(kind==2)s->controls.pressure[number]=value;
    else if(kind==3){s->controls.bend=value;s->controls.has_bend=1;}
    else {
        if(number==120||number==123){
            if(!silent)for(unsigned i=0;i<NV;i++)if(sam_voice_active(i)&&vc[i].part==part&&sam_voices[i].source==source){
                if(number==120)sam_stolen(&vc[i]);
                else {vc[i].gate=0;sam_voices[i].fading=1;}
            }
            if(input_origin==2)memset(sam_pads,0,sizeof sam_pads);
            if(input_origin)memset(sam_keys[part][source],0,sizeof sam_keys[part][source]);
            else for(unsigned i=0;i<NV;i++)if(sam_seq_keys[i].part==part&&sam_seq_keys[i].channel==channel)sam_seq_keys[i].key.bank=0;
            s->controls.cc[64]=0;
            return 1;
        }
        unsigned prev=s->controls.cc[number];s->controls.cc[number]=value;
        sam_bank_t *b=sam_banks[sam_routes[route]-1];
        for(unsigned i=0;i<b->cc_switch_count;i++)
            if(b->cc_switches[i].cc==number && value>=(int)b->cc_switches[i].lo && value<=(int)b->cc_switches[i].hi)
                s->articulation=(s->articulation&~b->cc_switches[i].clear)|b->cc_switches[i].select;
        if(input_origin==2 && number==64 && prev>=64 && value<64)
            for(unsigned i=0;i<16;i++)if(sam_pads[i].released)waswan_sampler_live_pad(i+1,sam_pads[i].note,0);
        if(!input_origin&&number==64&&prev>=64&&value<64) {
            unsigned previous=seq_note_source;seq_note_source=3;
            for(unsigned i=0;i<NV;i++){
                sam_seq_key_t *k=&sam_seq_keys[i];
                if(k->key.bank&&k->part==part&&k->channel==channel&&k->released)
                    sam_release_key(part,k->note,source,silent,&k->key);
            }
            seq_note_source=previous;
        }
    }
    return 1;
}
SAM_EXPORT void waswan_sampler_chase_id(unsigned part,unsigned note,unsigned velocity,unsigned channel,unsigned id) {
    sam_sequence_note(part,note,velocity,channel,id,1);
}
SAM_EXPORT void waswan_sampler_chase(unsigned part,unsigned note,unsigned velocity) {
    if(part<NPART&&note<128&&velocity<128){if(velocity)sam_attack(part,note,velocity,0,1);else sam_release(part,note,0,1);}
}
static void sam_forget(unsigned part,unsigned source) {
    memset(sam_keys[part][source],0,sizeof sam_keys[part][source]);
    if(source!=0)memset(&sam_state(part,source)->controls,0,sizeof(sam_controls_t));
    if(!source)for(unsigned i=0;i<NV;i++)if(sam_seq_keys[i].part==part)sam_seq_keys[i].key.bank=0;
    for(unsigned i=0;i<NV;i++)if(sam_voice_active(i)&&vc[i].part==part&&
       (source==SAM_KEYBOARD?vc[i].seq_owned<3:vc[i].seq_owned==source+3))sam_voices[i].fading=1;
}
static void sam_panic(void) {
    memset(sam_keys,0,sizeof sam_keys);
    memset(sam_seq_keys,0,sizeof sam_seq_keys);
    memset(sam_preview_keys,0,sizeof sam_preview_keys);
    memset(sam_pads,0,sizeof sam_pads);
    for(unsigned p=0;p<NPART;p++){
        for(unsigned s=0;s<SAM_KEYBOARD;s++)sam_reset_state(p,s,sam_routes[p]);
        for(unsigned ch=0;ch<16;ch++)sam_reset_state(p,SAM_SOURCES+ch,sam_routes[p]);
    }
    sam_reset_state(0,SAM_KEYBOARD,sam_routes[NPART]);
    for(unsigned i=0;i<NV;i++)sam_voices[i].fading=1;
}
#include "sampler-reader.h"

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
