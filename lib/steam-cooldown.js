export function steamCooldown(retryAfter,time) {
  if(!retryAfter)return time+120_000;
  const delay=/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Date.parse(retryAfter)-time;
  return time+(Number.isFinite(delay)?Math.max(delay,60_000):120_000);
}

export function steamRateLimitError(service,until,time) {
  const retryAfter=Math.max(1,Math.ceil((until-time)/1000));
  const minutes=Math.ceil(retryAfter/60);
  return Object.assign(new Error(`${service} is rate limited. Try again in ${minutes} ${minutes===1?'minute':'minutes'}.`),{status:429,retryAfter});
}
