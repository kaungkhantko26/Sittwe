import {describe,it,expect} from 'vitest';
import {AdaptiveResolution} from '../src/systems/AdaptiveResolution';
const run=(a:AdaptiveResolution,fps:number,seconds:number)=>{for(let i=0;i<fps*seconds;i++)a.sample(1/fps)};
describe('adaptive resolution',()=>{
 it('reduces sustained slow rendering but never falls below its floor',()=>{const a=new AdaptiveResolution();run(a,25,40);expect(a.scale).toBe(.6)});
 it('requires sustained headroom before restoring detail',()=>{const a=new AdaptiveResolution();run(a,25,5);expect(a.scale).toBe(.9);run(a,60,8);expect(a.scale).toBe(.9);run(a,60,9);expect(a.scale).toBe(1)});
 it('ignores background stalls and resets on quality changes',()=>{const a=new AdaptiveResolution();for(let i=0;i<30;i++)a.sample(2);expect(a.scale).toBe(1);run(a,25,5);a.reset();expect(a.scale).toBe(1)});
});
