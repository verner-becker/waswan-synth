/* SPDX-License-Identifier: GPL-3.0-only
 * Read a virtual forward timeline. Map its neighbouring frames separately for
 * cubic interpolation at loop seams, including reversals and shared slices.
 */
#define SAM_FRAC_BITS 20
#define SAM_ONE (1ull<<SAM_FRAC_BITS)
#define SAM_FRAC (SAM_ONE-1)
typedef struct {uint32_t frame,other;float blend;} sam_position_t;

static unsigned sam_orient(const sam_region_t *r,unsigned position) {
    return r->flags&4 ? r->end-1-position : r->first+position;
}
static sam_position_t sam_position(const sam_region_t *r,uint64_t clock) {
    unsigned length=r->end-r->first;
    if(!r->loop_end){
        if(clock>=length)return (sam_position_t){.frame=0xffffffffu};
        return (sam_position_t){.frame=sam_orient(r,(unsigned)clock)};
    }
    unsigned first=r->flags&4 ? r->end-r->loop_end : r->loop_first-r->first;
    if(clock<first)return (sam_position_t){.frame=sam_orient(r,(unsigned)clock)};
    unsigned span=r->loop_end-r->loop_first,fade=r->crossfade;
    uint64_t elapsed=clock-first;
    unsigned offset,direction=r->loop_mode==1;
    if(elapsed<span)offset=(unsigned)elapsed;
    else if(r->loop_mode==2) {
        unsigned leg=span-1-fade;
        uint64_t cycle=(elapsed-span)%(2u*leg);
        direction=cycle<leg;
        offset=1+fade+(unsigned)(cycle<leg?cycle:cycle-leg);
    } else offset=fade+(unsigned)((elapsed-span)%(span-fade));
    unsigned pos=direction ? span-1-offset : offset;
    sam_position_t result={.frame=sam_orient(r,first+pos)};
    if(fade && offset>=span-fade){
        unsigned n=offset-(span-fade);
        unsigned next=r->loop_mode==2 ? (direction?n+1:span-2-n) : (direction?span-1-n:n);
        result.other=sam_orient(r,first+next);result.blend=(float)(n+1)/(fade+1);
    }
    return result;
}
static inline float sam_value(const sam_region_t *r,sam_position_t pos,unsigned channel) {
    if(pos.frame==0xffffffffu)return 0;
    const int16_t *pcm=r->pcm+channel;
    float value=pcm[pos.frame*r->channels];
    return pos.blend?value+(pcm[pos.other*r->channels]-value)*pos.blend:value;
}
static inline float sam_cubic(float a,float b,float c,float d,float t) {
    return b+.5f*t*((c-a)+t*((2*a-5*b+4*c-d)+t*(3*(b-c)+d-a)));
}
static void sam_edge_read(const sam_region_t *r,uint64_t phase,float pair[2]) {
    uint64_t frame=phase>>SAM_FRAC_BITS;
    sam_position_t b=sam_position(r,frame);
    float frac=(phase&SAM_FRAC)*(1.f/SAM_ONE);
    if(!frac){
        pair[0]=sam_value(r,b,0);pair[1]=r->channels==1?pair[0]:sam_value(r,b,1);return;
    }
    sam_position_t a=sam_position(r,frame?frame-1:0),c=sam_position(r,frame+1),d=sam_position(r,frame+2);
    for(unsigned ch=0;ch<r->channels;ch++)pair[ch]=sam_cubic(sam_value(r,a,ch),sam_value(r,b,ch),sam_value(r,c,ch),sam_value(r,d,ch),frac);
    if(r->channels==1)pair[1]=pair[0];
}
/* The common case reads a contiguous interior segment without per-frame loop
 * division or boundary checks. The integer-pitch path also bypasses Hermite. */
static int sam_direct_block(const sam_region_t *r,uint64_t phase,uint64_t step,unsigned *start) {
    if((r->flags&4)||r->loop_mode||r->crossfade)return 0;
    uint64_t frame=phase>>SAM_FRAC_BITS;
    unsigned limit=r->loop_end?r->loop_end:r->end,first=r->first;
    if(r->loop_end && frame>=limit-first){
        unsigned span=limit-r->loop_first;
        *start=r->loop_first+(unsigned)((frame-(limit-first))%span);
        first=r->loop_first;
    } else {
        if(frame>=limit-first)return 0;
        *start=first+(unsigned)frame;
    }
    uint64_t last=((phase&SAM_FRAC)+(CTL-1u)*step)>>SAM_FRAC_BITS;
    return *start>first && last+2u<limit-*start;
}
static inline void sam_direct_read(const sam_region_t *r,unsigned frame,float frac,float pair[2]) {
    unsigned stride=r->channels;
    const int16_t *p=r->pcm+frame*stride;
    if(!frac){pair[0]=p[0];pair[1]=p[stride-1];return;}
    pair[0]=sam_cubic(p[-(int)stride],p[0],p[stride],p[2*stride],frac);
    pair[1]=stride==1?pair[0]:sam_cubic(p[1-(int)stride],p[1],p[1+stride],p[1+2*stride],frac);
}
static void sam_render(voice_t *v,int32_t *out) {
    sam_voice_t *h=&sam_voices[v-vc];sam_region_t *r=&sam_banks[h->bank-1]->regions[h->region];
    const sam_controls_t *controls=&sam_state(v->part,h->source)->controls;
    int bend=daw_is_live(v->seq_owned)?daw_live_bend8[v->seq_owned-4][v->part]:v->seq_owned==3?daw_bend8[v->part]:pt[v->part].bend8;
    if(controls->has_bend)bend=(controls->bend*(int)pt[v->part].p->v[P_BEND]*256)>>13;
    const sam_program_t *p=&r->program;
    sam_block_t block={.left=r->left,.right=r->right,.pitch_ratio=1,.amp=1};
    if(p->enabled)block=sam_controls_block(p,&h->modulation,controls,v->note,v->vel,v->gate||(r->flags&2));
    double tune=r->tuning*(double)block.pitch_ratio;
    double ratio=(r->flags&8)?(bend?sam_exp2(bend/3072.f):1.):
        (double)pitch_inc(clampi((int)v->note*256+bend,0,127*256))/r->root_inc;
    uint64_t step=(uint64_t)__builtin_fmin(36028797018963968.,ratio*tune*SAM_ONE);
    if(!step)step=1;
    uint64_t finish=(uint64_t)(r->end-r->first)<<SAM_FRAC_BITS;
    if(r->loop_end && h->phase>=(1ull<<54)){
        unsigned start=r->flags&4?r->end-r->loop_end:r->loop_first-r->first;
        unsigned length=r->loop_end-r->loop_first,period=r->loop_mode==2?2*(length-1-r->crossfade):length-r->crossfade;
        uint64_t base=(uint64_t)(start+length)<<SAM_FRAC_BITS;
        h->phase=base+(h->phase-base)%((uint64_t)period<<SAM_FRAC_BITS);
    }
    unsigned start=0;
    int direct=sam_direct_block(r,h->phase,step,&start);
    uint64_t origin=h->phase>>SAM_FRAC_BITS;
    float gain=h->gain*4.f;
    for(unsigned j=0;j<CTL;j++){
        if((!r->loop_end&&h->phase>=finish)||h->fading>64||block.done){
            v->gate=0;v->ae.stage=E_IDLE;h->bank=0;v->guard_l=v->guard_r=0;return;
        }
        if(!v->gate && !(r->flags&2) && !h->fading && !p->env[0].enabled)h->fading=1;
        float pair[2],amp=gain*block.amp;
        if(direct)sam_direct_read(r,start+(unsigned)((h->phase>>SAM_FRAC_BITS)-origin),
                                  (float)(h->phase&SAM_FRAC)*(1.f/SAM_ONE),pair);
        else sam_edge_read(r,h->phase,pair);
        if(p->filter){
            pair[0]=sam_filter_sample(p->filter,&block.filter,&h->modulation.filter[0],pair[0]);
            pair[1]=sam_filter_sample(p->filter,&block.filter,&h->modulation.filter[1],pair[1]);
        }
        if(h->fading)amp*=(65-h->fading++)/64.f;
        if(v->guard_in){amp*=(STEAL_FADE-v->guard_in)/(float)STEAL_FADE;v->guard_in--;}
        v->guard_l=(int32_t)sam_limit(pair[0]*amp*block.left,-131072,131071);
        v->guard_r=(int32_t)sam_limit(pair[1]*amp*block.right,-131072,131071);
        out[2*j]+=v->guard_l;out[2*j+1]+=v->guard_r;
        block.amp+=block.amp_step;h->phase+=step;
    }
    v->ae.stage=v->gate?E_SUS:E_REL;
}
