import type {InputManager} from '../core/InputManager';

/** Pointer events cover iOS, iPadOS, Android and touch-enabled laptops. */
export class TouchControls {
  readonly root=document.createElement('div');
  constructor(parent:HTMLElement,input:InputManager,actions:{map:()=>void;pause:()=>void}) {
    this.root.className='touch-controls';
    this.root.innerHTML=`<div class="touch-look" aria-label="Drag to look around"></div>
      <div class="touch-joystick" role="group" aria-label="Movement joystick"><div class="touch-stick"></div></div>
      <div class="touch-top"><button aria-label="Open map">Map</button><button aria-label="Pause game">Ⅱ</button></div>
      <div class="touch-actions"><button data-key="KeyE" aria-label="Interact">E · Use</button><button data-key="KeyF" aria-label="Enter or exit vehicle">Car</button><button data-key="Space" aria-label="Jump or fly up">↑ Jump</button><button data-key="ControlLeft" aria-label="Fly down">↓</button><button data-key="KeyG" aria-label="Toggle flight or land">Fly</button><button data-key="KeyV" aria-label="Spawn vehicle">+ Car</button><button data-key="KeyC" aria-label="Change camera">View</button><button data-key="KeyJ" aria-label="Dance">Dance</button><button data-key="ShiftLeft" aria-label="Sprint or boost">Run</button></div>`;
    parent.append(this.root);
    const joystick=this.root.querySelector('.touch-joystick') as HTMLElement,stick=this.root.querySelector('.touch-stick') as HTMLElement;
    let joystickPointer:number|null=null;
    const move=(e:PointerEvent)=>{if(e.pointerId!==joystickPointer)return;const r=joystick.getBoundingClientRect(),dx=(e.clientX-r.left-r.width/2)/(r.width*.36),dy=(e.clientY-r.top-r.height/2)/(r.height*.36),len=Math.max(1,Math.hypot(dx,dy));input.touchMove.x=dx/len;input.touchMove.y=dy/len;stick.style.transform=`translate(${dx/len*36}px,${dy/len*36}px)`};
    joystick.addEventListener('pointerdown',e=>{e.preventDefault();joystickPointer=e.pointerId;joystick.setPointerCapture(e.pointerId);move(e)});
    joystick.addEventListener('pointermove',move);
    const stop=(e:PointerEvent)=>{if(e.pointerId!==joystickPointer)return;joystickPointer=null;input.touchMove.x=0;input.touchMove.y=0;stick.style.transform='translate(0,0)'};
    joystick.addEventListener('pointerup',stop);joystick.addEventListener('pointercancel',stop);joystick.addEventListener('lostpointercapture',stop);
    const look=this.root.querySelector('.touch-look') as HTMLElement;
    let lookPointer:number|null=null,lastX=0,lastY=0;
    look.addEventListener('pointerdown',e=>{e.preventDefault();lookPointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;look.setPointerCapture(e.pointerId)});
    look.addEventListener('pointermove',e=>{if(e.pointerId!==lookPointer)return;input.addTouchLook((e.clientX-lastX)*1.6,(e.clientY-lastY)*1.6);lastX=e.clientX;lastY=e.clientY});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])look.addEventListener(type,()=>{lookPointer=null});
    this.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button=>{
      const key=button.dataset['key']!;
      button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);input.setTouchKey(key,true);button.classList.add('pressed')});
      const release=()=>{input.setTouchKey(key,false);button.classList.remove('pressed')};
      for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,release);
    });
    this.root.querySelector('[aria-label="Open map"]')!.addEventListener('click',()=>{input.clearTouch();actions.map()});
    this.root.querySelector('[aria-label="Pause game"]')!.addEventListener('click',()=>{input.clearTouch();actions.pause()});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)input.clearTouch()});
  }
}
