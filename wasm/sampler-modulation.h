/* SPDX-License-Identifier: GPL-3.0-only
 * Per-region settings are immutable after publication. Envelopes are linear in
 * amplitude. The control tick is 16 frames; the amplifier interpolates between
 * ticks. Filter coefficients are shared; integrators remain independent per side.
 */
typedef struct { float attack,decay,sustain,release; unsigned enabled; } sam_env_t;
typedef struct { uint8_t source,dest,bipolar; float depth; } sam_mod_route_t;
typedef struct {
    unsigned enabled, filter, lfo, routes;
    float cutoff_q8, resonance, pan, gain;
    uint32_t lfo_step;
    sam_env_t env[3];
    sam_mod_route_t route[16];
} sam_program_t;
typedef struct {
    uint8_t cc[128], pressure[128], channel_pressure, has_bend;
    int16_t bend;
} sam_controls_t;
typedef struct {
    uint32_t age,release_age,lfo_phase;
    unsigned released;
    float start_release[3];
    svf_state_t filter[2];
} sam_mod_voice_t;
typedef struct {
    float amp,amp_step,pitch_ratio,left,right;
    svf_coef_t filter;
    unsigned done;
} sam_block_t;

static float sam_limit(float x,float lo,float hi) {
    return __builtin_fminf(hi,__builtin_fmaxf(lo,x));
}
static float sam_exp2(float octaves) {
    octaves=sam_limit(octaves,-24,24);
    int whole=(int)__builtin_floorf(octaves);
    union { uint32_t bits; float value; } scale={(uint32_t)(whole+127)<<23};
    return scale.value*dx_exp2((int)((octaves-whole)*16777216.f))/16777216.f;
}
static float sam_held_env(const sam_env_t *e,unsigned age) {
    if(age<e->attack)return age/e->attack;
    float decay_age=age-e->attack;
    if(decay_age<e->decay)return 1.f+(e->sustain-1.f)*decay_age/e->decay;
    return e->sustain;
}
static float sam_env_value(const sam_env_t *e,const sam_mod_voice_t *v,unsigned env,unsigned ahead) {
    if(!e->enabled)return env==0?1.f:0.f;
    if(!v->released)return sam_held_env(e,v->age+ahead);
    unsigned age=v->release_age+ahead;
    return age<e->release ? v->start_release[env]*(1.f-age/e->release):0.f;
}
static sam_block_t sam_controls_block(const sam_program_t *p,sam_mod_voice_t *v,
                                     const sam_controls_t *controls,unsigned note,unsigned velocity,unsigned gate) {
    if(!gate&&!v->released){
        for(unsigned i=0;i<3;i++)v->start_release[i]=sam_held_env(&p->env[i],v->age);
        v->released=1;
    }
    float env[3];
    for(unsigned i=0;i<3;i++)env[i]=sam_env_value(&p->env[i],v,i,0);
    float lfo=0;
    if(p->lfo==1)lfo=dx_sin(v->lfo_phase>>8)/16777216.f;
    else if(p->lfo==2){float phase=v->lfo_phase/4294967296.f;lfo=1.f-4.f*__builtin_fabsf(phase-.5f);}
    v->lfo_phase+=p->lfo_step;
    float mod[5]={0};
    for(unsigned i=0;i<p->routes;i++){
        sam_mod_route_t route=p->route[i];
        float value;
        switch(route.source){
            case 0: value=velocity/127.f;break;
            case 1: value=controls->cc[1]/127.f;break;
            case 2: value=(controls->bend/8192.f+1.f)*.5f;break;
            case 3: value=controls->channel_pressure/127.f;break;
            case 4: value=controls->pressure[note]/127.f;break;
            case 5: case 6: case 7: value=env[route.source-5];break;
            case 8: value=(lfo+1.f)*.5f;break;
            default: value=controls->cc[route.source-16]/127.f;break;
        }
        mod[route.dest]+=(route.bipolar?2.f*value-1.f:value)*route.depth;
    }
    float volume=p->gain*(mod[0]?sam_exp2(mod[0]/6.02059991f):1.f);
    float pan=sam_limit(p->pan+mod[4],-1,1);
    sam_block_t block={.amp=env[0],.amp_step=(sam_env_value(&p->env[0],v,0,CTL)-env[0])/CTL,
        .left=volume*__builtin_fminf(1.f,1.f-pan),.right=volume*__builtin_fminf(1.f,1.f+pan),
        .pitch_ratio=mod[1]?sam_exp2(mod[1]/1200.f):1.f,
        .done=v->released&&p->env[0].enabled&&v->release_age>=p->env[0].release};
    if(p->filter){
        int32_t damping=(int32_t)(8192.f-7987.f*sam_limit(p->resonance+mod[3],0,1));
        svf_coef(&block.filter,(int32_t)sam_limit(p->cutoff_q8+mod[2]*3072.f,0,136<<8),damping);
    }
    /* An hour-long voice already reached the sustain stage of every supported envelope. */
    if(v->age<44100u*3600u)v->age+=CTL;
    if(v->released&&v->release_age<44100u*3600u)v->release_age+=CTL;
    return block;
}
static float sam_filter_sample(unsigned type,const svf_coef_t *c,svf_state_t *s,float input) {
    int32_t lp,bp,hp;
    svf_step(c,s,(int32_t)sam_limit(input,-32768,32767),&lp,&bp,&hp);
    return type==1?lp:type==2?hp:bp;
}
