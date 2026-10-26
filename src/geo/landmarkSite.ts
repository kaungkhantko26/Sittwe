import type { ChunkRoad } from './chunkFormat';
import { pointInRing, ringCentroid, signedArea, type Pt } from './geometry2d';

/** Resolve a small closed mapped roundabout, using an area centroid (not vertex average). */
export function roundaboutSite(x:number,z:number,roads:Pick<ChunkRoad,'p'|'w'>[]): {x:number;z:number;ring:Pt[];halfWidth:number}|null {
  for(const road of roads){
    const p=road.p;
    if(p.length<8||p[0]!==p[p.length-2]||p[1]!==p[p.length-1])continue;
    const ring:Pt[]=[];for(let i=0;i<p.length-2;i+=2)ring.push([p[i]!,p[i+1]!]);
    const area=Math.abs(signedArea(ring));
    if(area<10||area>2500||!pointInRing(x,z,ring))continue;
    const [cx,cz]=ringCentroid(ring);
    return {x:cx,z:cz,ring,halfWidth:road.w/2};
  }
  return null;
}
