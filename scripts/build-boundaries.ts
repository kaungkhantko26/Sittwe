/** Preserve mapped walls and fences as geographic linework, without inventing property borders. */
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {projection} from '../src/geo/GeoProjection';
import {WORLD_BOUNDS} from '../src/config';
import {clipPolyline, type Pt} from '../src/geo/geometry2d';
const root=join(import.meta.dirname,'..');
const files=readdirSync(join(root,'data/osm')).filter(f=>/^region_.*pbf\.json$/.test(f));
const lines:Array<{id:string;kind:string;p:number[];height:number}>=[];
for(const file of files){
 const raw=JSON.parse(readFileSync(join(root,'data/osm',file),'utf8'));
 for(const e of raw.elements){
  if(e.type!=='way'||!['fence','wall','hedge'].includes(e.tags?.barrier)||!e.geometry?.length)continue;
  const points:Pt[]=e.geometry.filter((p:{lat:number;lon:number}|null)=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)).map((p:{lat:number;lon:number})=>projection.lonLatToXZ(p.lon,p.lat));
  const rect={minX:WORLD_BOUNDS.minX,maxX:WORLD_BOUNDS.maxX,minY:WORLD_BOUNDS.minZ,maxY:WORLD_BOUNDS.maxZ};
  for(const part of clipPolyline(points,rect))lines.push({id:`way/${e.id}`,kind:e.tags.barrier,p:part.points.flat().map(n=>Math.round(n*100)/100),height:Math.min(3,Math.max(.5,parseFloat(e.tags.height)||1.4))});
 }
}
writeFileSync(join(root,'public/data/boundaries.json'),JSON.stringify({version:1,lines}));
console.log(`Wrote ${lines.length} mapped fence/wall lines.`);
