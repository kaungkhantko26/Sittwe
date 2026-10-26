/** Slow, bounded resolution changes; ignore stalls and use hysteresis to avoid oscillation. */
export class AdaptiveResolution {
  scale=1;
  private elapsed=0;
  private frames=0;
  private fastWindows=0;
  reset():void {this.scale=1;this.elapsed=0;this.frames=0;this.fastWindows=0;}
  sample(dt:number):number|null {
    if(!Number.isFinite(dt)||dt<=0||dt>.25)return null;
    this.elapsed+=dt;this.frames++;
    if(this.elapsed<4)return null;
    const fps=this.frames/this.elapsed;this.elapsed=0;this.frames=0;
    const before=this.scale;
    if(fps<38){this.scale=Math.max(.6,Math.round((this.scale-.1)*10)/10);this.fastWindows=0;}
    else if(fps>55){if(++this.fastWindows>=3){this.scale=Math.min(1,Math.round((this.scale+.1)*10)/10);this.fastWindows=0;}}
    else this.fastWindows=0;
    return this.scale!==before?this.scale:null;
  }
}
