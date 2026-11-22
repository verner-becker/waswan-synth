// SPDX-License-Identifier: GPL-3.0-only
export const PROGRESS_KEY='waswan-music-lab-progress-v1';
const FORMAT='waswan-music-lab-progress';
const HISTORY_LIMIT=8;
const KEY_PATTERN=/^[a-z0-9-]{1,64}@[1-9]\d{0,5}:[A-G][#b]?$/;
const COUNT_LIMIT=1000000;
const count=value=>Number.isInteger(value)&&value>=0&&value<=COUNT_LIMIT;

export function lessonProgressKey(lesson) {
  return `${lesson.id}@${lesson.version}:${lesson.key.tonic}`;
}

function checkedAttempt(attempt) {
  if(!attempt||!Number.isFinite(attempt.at)||attempt.at<0||attempt.at>8.64e15||
    !['strict','guided','creative'].includes(attempt.mode))return null;
  const {expected,matched,extras,retries,holdSamples,holdMeanMs,windowUnavailable}=attempt.summary??{};
  if(![expected,matched,extras,retries,holdSamples].every(count)||!expected||matched>expected||
    (holdSamples>0&&(!Number.isSafeInteger(holdMeanMs)||holdMeanMs<0)))return null;
  return {at:attempt.at,mode:attempt.mode,summary:{
    expected,matched,missing:expected-matched,extras,retries,holdSamples,
    holdMeanMs:holdSamples?holdMeanMs:null,windowUnavailable:windowUnavailable===true
  }};
}

export function readLabProgress(storage) {
  try {
    const raw=storage.getItem(PROGRESS_KEY);
    if(!raw||raw.length>262144)return new Map();
    const data=JSON.parse(raw);
    if(data?.format!==FORMAT||data.version!==1||!data.lessons||Array.isArray(data.lessons))return new Map();
    const lessons=new Map();
    for(const [key,record] of Object.entries(data.lessons).slice(0,64)){
      if(!KEY_PATTERN.test(key)||!count(record?.attempts)||!Array.isArray(record.history))continue;
      const history=record.history.slice(0,HISTORY_LIMIT).map(checkedAttempt).filter(Boolean);
      if(history.length&&record.attempts>=history.length)lessons.set(key,{attempts:record.attempts,history});
    }
    return lessons;
  }catch{
    return new Map();
  }
}

export class LabProgress {
  constructor(storage) {
    this.storage=storage;
    this.lessons=readLabProgress(storage);
  }

  get(lesson) {
    return this.lessons.get(lessonProgressKey(lesson));
  }

  record(lesson,summary) {
    const key=lessonProgressKey(lesson),attempt=checkedAttempt({at:Date.now(),mode:lesson.mode,summary});
    if(!attempt||!KEY_PATTERN.test(key))return false;
    if(!this.unsaved)this.lessons=readLabProgress(this.storage);
    const current=this.lessons.get(key);
    this.lessons.set(key,{attempts:Math.min(COUNT_LIMIT,(current?.attempts??0)+1),
      history:[attempt,...(current?.history??[])].slice(0,HISTORY_LIMIT)});
    try {
      this.storage.setItem(PROGRESS_KEY,JSON.stringify({format:FORMAT,version:1,lessons:Object.fromEntries(this.lessons)}));
      this.unsaved=false;
    }catch{
      this.unsaved=true;
    }
    return !this.unsaved;
  }
}
