/**
 * Keyboard + mouse input with pointer lock. Keys are tracked by
 * KeyboardEvent.code so controls work on any keyboard layout.
 */
export class InputManager {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  enabled = true;
  readonly touchMove={x:0,y:0};
  private readonly touchKeys=new Set<string>();
  setTouchKey(code:string,down:boolean):void {if(down){if(!this.touchKeys.has(code))this.pressed.add(code);this.touchKeys.add(code)}else this.touchKeys.delete(code)}
  addTouchLook(dx:number,dy:number):void {this.mouseDX+=dx;this.mouseDY+=dy}
  clearTouch():void {this.touchKeys.clear();this.touchMove.x=0;this.touchMove.y=0}


  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private readonly onBlur = () => {
    this.down.clear();
    this.clearTouch();
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    if (!this.isPointerLocked()) return;
    // Ignore absurd spikes some browsers emit when (re)acquiring pointer lock.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };

  private readonly onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  isDown(code: string): boolean {
    return this.enabled && (this.down.has(code)||this.touchKeys.has(code));
  }

  /** True only on the first frame a key goes down. */
  wasPressed(code: string): boolean {
    return this.enabled && this.pressed.has(code);
  }

  /** Axis in [-1, 1] from two keys. */
  axis(neg: string, pos: string): number {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }

  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  requestPointerLock(): void {
    if(document.documentElement.classList.contains('touch-enabled'))return;
    if (this.isPointerLocked()) return;
    const p = this.target.requestPointerLock() as unknown as Promise<void> | undefined;
    // Newer browsers return a promise that rejects if the request is too soon after an exit.
    if (p && typeof p.catch === 'function') p.catch(() => undefined);
  }

  exitPointerLock(): void {
    if (this.isPointerLocked()) document.exitPointerLock();
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('wheel', this.onWheel);
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
