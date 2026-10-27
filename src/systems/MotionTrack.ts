export interface MotionPose {x:number;y:number;z:number;yaw:number}
interface Sample extends MotionPose {time:number}
/** Render behind the newest network state, interpolating snapshots rather than chasing each packet. */
export class MotionTrack {
 private samples:Sample[]=[];
 constructor(private readonly delay=.12){}
 push(p:MotionPose,time:number):void {
  const last=this.samples.at(-1);if(last&&time<=last.time)return;
  if(last&&Math.hypot(p.x-last.x,p.y-last.y,p.z-last.z)>40)this.samples=[];
  this.samples.push({...p,time});if(this.samples.length>8)this.samples.shift();
 }
 sample(now:number):MotionPose|null {
  const target=now-this.delay;
  while(this.samples.length>2&&this.samples[1]!.time<=target)this.samples.shift();
  const a=this.samples[0];if(!a)return null;const b=this.samples[1];if(!b)return a;
  const t=Math.max(0,Math.min(1,(target-a.time)/(b.time-a.time)));
  const turn=Math.atan2(Math.sin(b.yaw-a.yaw),Math.cos(b.yaw-a.yaw));
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,yaw:a.yaw+turn*t};
 }
}
