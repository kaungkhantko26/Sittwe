import {describe,it,expect} from 'vitest';
import {MISSIONS,MissionEngine,PLACES,validMissionState,loadProgress,type MissionContext,type PlayerPos} from '../src/systems/Missions';
import {isThadingyut,festivalActive,thadingyutFullMoon} from '../src/systems/Thadingyut';

const at:Record<string,{x:number;z:number}>={campfire:{x:150,z:2800},[PLACES.goldenFish]:{x:-60,z:-547},[PLACES.viewPoint]:{x:95,z:2887},[PLACES.mayYu]:{x:-916,z:213},[PLACES.lawkanandar]:{x:-1181,z:288},[PLACES.uOttama]:{x:68,z:-201},[PLACES.clockTower]:{x:-64,z:306},[PLACES.danyawaddyStadium]:{x:-756,z:394},home:{x:500,z:500}};
const ctx=(players:PlayerPos[],hours=12,now=0):MissionContext=>({players,hours,now,place:r=>at[r]??null});
const P=(id:string,where:string,dx=0):PlayerPos=>({id,name:id.toUpperCase(),x:at[where]!.x+dx,z:at[where]!.z});

describe('missions',()=>{
  it('uses only real mapped places (or home) and every mission can be finished',()=>{
    const known=new Set(Object.values(PLACES));
    for(const m of MISSIONS){expect(m.steps.length).toBeGreaterThan(0);for(const s of m.steps)expect(known.has(s.place as never)).toBe(true);}
  });
  it('beer run: buy for everyone, meet at Point Beach, everyone drinks, then pays out with a sunset bonus',()=>{
    let a=P('a',PLACES.goldenFish),b=P('b',PLACES.mayYu);
    const e=new MissionEngine();expect(e.start('point-beers',false)?.en).toContain('Friends only');expect(e.start('point-beers',false,ctx([a,b]))).toBeNull();
    e.update(ctx([a,b]));expect(e.state.step).toBe(1); // arrived at the shop
    expect(e.actionFor('b',ctx([a,b]))).toBeNull(); // b is not at the shop
    expect(e.act('a',ctx([a,b]))).toBeNull();
    expect(e.state.items.beer).toBe(2);expect(e.state.budget).toBe(12000-5000);expect(e.state.step).toBe(2);
    a=P('a',PLACES.viewPoint);e.update(ctx([a,b]));expect(e.state.step).toBe(2); // waiting for b
    b=P('b',PLACES.viewPoint,10);e.update(ctx([a,b],17.5));expect(e.state.step).toBe(3);
    expect(e.act('a',ctx([a,b],17.5,1000))).toBeNull();expect(e.state.step).toBe(3); // b still has to drink
    expect(e.act('a',ctx([a,b],17.5,1500))?.en).toContain('already');
    expect(e.act('b',ctx([a,b],17.5,3000))).toBeNull();
    expect(e.state.done?.reward).toBe(4500);expect(e.state.items.beer).toBe(0);expect(e.state.event?.text.en).toContain('sunset bonus');
  });
  it('blocks night steps by day and refuses purchases beyond the budget',()=>{
    const e=new MissionEngine();expect(e.start('thadingyut-lamps',false)?.en).toContain('Thadingyut');
    expect(e.start('thadingyut-lamps',true)).toBeNull();
    const team=[P('a',PLACES.mayYu),P('b',PLACES.mayYu),P('c',PLACES.mayYu),P('d',PLACES.mayYu),P('e',PLACES.mayYu)];
    expect(e.act('a',ctx(team))?.en).toContain('Not enough money'); // 5 × 2,000 > 8,000
    const duo=team.slice(0,2);expect(e.act('a',ctx(duo))).toBeNull();
    const there=duo.map(p=>({...p,...at[PLACES.lawkanandar]!}));
    e.update(ctx(there,14));expect(e.state.step).toBe(1);
    e.update(ctx(there,20));expect(e.state.step).toBe(2);
    e.act('a',ctx(there,20));e.act('b',ctx(there,20));
    expect(e.state.done).not.toBeNull();
  });
  it('race: the first player at the finish wins',()=>{
    let team=[P('a',PLACES.uOttama),P('b',PLACES.uOttama,5)];
    const e=new MissionEngine();e.start('race-point',false,ctx(team));e.update(ctx(team));expect(e.state.step).toBe(1);
    team=[P('a',PLACES.goldenFish),P('b',PLACES.viewPoint)];e.update(ctx(team));
    expect(e.state.done?.winner).toBe('b');expect(e.state.event?.text.en).toContain('B wins');
  });
  it('accepts only well-formed network state',()=>{
    const e=new MissionEngine();e.start('point-beers',false);
    expect(validMissionState(JSON.parse(JSON.stringify(e.state)))).toBe(true);
    for(const bad of [null,{...e.state,id:'nope'},{...e.state,items:{gold:1}},{...e.state,budget:-1},{...e.state,acted:'x'}])expect(validMissionState(bad)).toBe(false);
  });
  it('loads saved progress defensively',()=>{
    expect(loadProgress({getItem:()=>'{bad'}).kyat).toBe(0);
    const p=loadProgress({getItem:()=>JSON.stringify({v:1,kyat:500,done:{'point-beers':2,fake:1},festival:'on'})});
    expect(p).toEqual({v:1,kyat:500,done:{'point-beers':2},festival:'on'});
  });
});

describe('friends-only mini-games',()=>{
  it('cheers must happen together: too slow resets the round',()=>{
    const a=P('a',PLACES.viewPoint),b=P('b',PLACES.viewPoint,5);
    const e=new MissionEngine();e.start('point-beers',false,ctx([a,b]));
    Object.assign(e.state,{step:3,items:{beer:2}});
    e.act('a',ctx([a,b],12,0));e.update(ctx([a,b],12,7000));
    expect(e.state.acted).toEqual([]);expect(e.state.event?.text.en).toContain('Too slow');
    e.state.items.beer=2;e.act('a',ctx([a,b],12,8000));e.act('b',ctx([a,b],12,9000));
    expect(e.state.done).not.toBeNull();
  });
  it('shell hunt: walking over shells collects them and the most shells wins',()=>{
    const a=P('a',PLACES.viewPoint),b=P('b',PLACES.viewPoint);
    const pts:Array<[number,number]>=Array.from({length:10},(_,i)=>[i*10,0]);
    const c=(players:PlayerPos[])=>({...ctx(players),scatter:(_x:number,_z:number,n:number)=>pts.slice(0,n)});
    const e=new MissionEngine();e.start('shell-hunt',false,c([a,b]));
    expect(e.state.pickups.length).toBe(30);
    const at=(id:string,x:number)=>({id,name:id.toUpperCase(),x,z:0});
    // a sweeps shells 0–60, b grabs 70–90.
    for(let x=0;x<=60;x+=10)e.update(c([at('a',x),at('b',500)]));
    for(let x=70;x<=90;x+=10)e.update(c([at('a',500),at('b',x)]));
    expect(e.state.scores).toEqual({a:7,b:3});expect(e.state.done?.winner).toBe('a');
  });
  it('places the full number of pickups even when the map has few free spots',()=>{
    const a=P('a',PLACES.viewPoint),b=P('b',PLACES.viewPoint);
    const e=new MissionEngine();e.start('campfire-night',false,{...ctx([a,b]),scatter:()=>[[1,1]]});
    expect(e.state.pickups.length).toBe(15);
  });
  it('tag: touching passes IT, and the least time as IT wins',()=>{
    const a=P('a',PLACES.viewPoint),b=P('b',PLACES.viewPoint,30);
    const e=new MissionEngine();e.start('tag-point',false,ctx([a,b]));e.update(ctx([a,b]));expect(e.state.step).toBe(1);
    e.state.it='a';e.state.lastTag=0;e.state.lastTick=0;
    e.update(ctx([a,b],12,10000)); // a is IT for ~1 s (ticks are capped at 1 s)
    e.update(ctx([a,{...b,x:a.x+1}],12,11000)); // a touches b
    expect(e.state.it).toBe('b');
    e.update(ctx([a,b],12,200000));
    expect(e.state.done?.winner).toBeDefined();
  });
  it('hide and seek: the seeker waits, then finds everyone to win',()=>{
    const a=P('a',PLACES.viewPoint),b=P('b',PLACES.viewPoint,40);
    const e=new MissionEngine();e.start('hide-seek',false,ctx([a,b],12,0));e.update(ctx([a,b],12,0));
    expect(e.state.phase).toBe('hide');const seeker=e.state.seeker!;const hider=seeker==='a'?b:a;const s=seeker==='a'?a:b;
    e.update(ctx([a,b],12,10000));expect(e.state.phase).toBe('hide'); // still counting
    e.update(ctx([a,b],12,26000));expect(e.state.phase).toBe('seek');
    e.update(ctx([{...s,x:hider.x+1,z:hider.z},hider],12,40000));
    expect(e.state.found).toEqual([hider.id]);expect(e.state.done?.winner).toBe(seeker);
  });
});

describe('Thadingyut festival dates',()=>{
  it('covers the official holidays of recent years',()=>{
    for(const d of ['2019-10-13','2021-10-20','2022-10-09','2023-10-28','2024-10-17','2025-10-06'])expect(isThadingyut(new Date(d+'T06:00:00Z'))).toBe(true);
  });
  it('is off in other weeks and can be forced on or off',()=>{
    expect(isThadingyut(new Date('2025-11-20T06:00:00Z'))).toBe(false);
    expect(festivalActive('on',new Date('2025-03-01'))).toBe(true);
    expect(festivalActive('off',new Date('2024-10-17T06:00:00Z'))).toBe(false);
    expect(thadingyutFullMoon(2026).getUTCMonth()).toBe(9);
  });
  it('motorbike race: lineup on bikes, countdown, checkpoints in order, ranked finish with times',()=>{
    const bike=(id:string,where:string,ride:PlayerPos['ride']='motorbike'):PlayerPos=>({...P(id,where),ride});
    const e=new MissionEngine();
    let a=bike('a',PLACES.clockTower),b=bike('b',PLACES.clockTower,null);
    expect(e.start('bike-race-town',false,ctx([a,b],12,0))).toBeNull();
    e.update(ctx([a,b],12,0));expect(e.state.step).toBe(0); // b is on foot
    b=bike('b',PLACES.clockTower);e.update(ctx([a,b],12,0));expect(e.state.step).toBe(1);expect(e.state.phase).toBe('countdown');
    e.update(ctx([a,b],12,500));expect(e.state.event?.text.en).toContain('3');
    a=bike('a',PLACES.mayYu);e.update(ctx([a,b],12,2000));expect(e.state.scores.a??0).toBe(0); // no head start before GO
    e.update(ctx([a,b],12,3000));expect(e.state.phase).toBe('racing');expect(e.state.scores.a).toBe(1);
    // Skipping a checkpoint does not count: a jumps to the stadium before the pagoda.
    a=bike('a',PLACES.danyawaddyStadium);e.update(ctx([a,b],12,4000));expect(e.state.scores.a).toBe(1);
    for(const [w,t] of [[PLACES.lawkanandar,5000],[PLACES.danyawaddyStadium,6000],[PLACES.clockTower,63000]] as const){a=bike('a',w);e.update(ctx([a,b],12,t));}
    expect(e.state.finish?.[0]).toEqual({id:'a',ms:60000});
    // Getting off the bike stops checkpoints counting.
    b=bike('b',PLACES.mayYu,null);e.update(ctx([a,b],12,64000));expect(e.state.scores.b??0).toBe(0);
    for(const [w,t] of [[PLACES.mayYu,65000],[PLACES.lawkanandar,66000],[PLACES.danyawaddyStadium,67000],[PLACES.clockTower,73000]] as const){b=bike('b',w);e.update(ctx([a,b],12,t));}
    expect(e.state.done?.winner).toBe('a');expect(e.state.event?.text.en).toContain('1. A 1:00.0 · 2. B 1:10.0');
    expect(validMissionState(JSON.parse(JSON.stringify(e.state)))).toBe(true);
  });
  it('motorbike race ends with DNF 45 s after the winner',()=>{
    const bike=(id:string,where:string):PlayerPos=>({...P(id,where),ride:'motorbike'});
    const e=new MissionEngine();let a=bike('a',PLACES.clockTower);const b=bike('b',PLACES.clockTower);
    e.start('bike-race-town',false,ctx([a,b],12,0));e.update(ctx([a,b],12,0));
    for(const [w,t] of [[PLACES.mayYu,3000],[PLACES.lawkanandar,4000],[PLACES.danyawaddyStadium,5000],[PLACES.clockTower,13000]] as const){a=bike('a',w);e.update(ctx([a,b],12,t));}
    e.update(ctx([a,b],12,40000));expect(e.state.done).toBeNull();
    e.update(ctx([a,b],12,59000));expect(e.state.done?.winner).toBe('a');expect(e.state.event?.text.en).toContain('B DNF');
  });
});
