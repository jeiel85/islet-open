// Keyboard, gamepad and touch input, folded into one snapshot per frame:
// { move: {x, y}, aim: {x, y}, shots: [...], challenge, ... }.

const SHOT_KEYS = {
  KeyJ: 'topspin', Space: 'topspin',
  KeyK: 'slice',
  KeyL: 'lob',
  KeyI: 'flat',
  KeyU: 'drop',
};

export class Input {
  constructor() {
    this.down = new Set();
    this.queue = [];
    this.actions = [];
    this.touchMove = { x: 0, y: 0 };
    this.padPrev = [];
    const ignore = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA');
    window.addEventListener('keydown', (e) => {
      if (ignore(e)) return;
      if (e.repeat) { if (SHOT_KEYS[e.code] || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); return; }
      this.down.add(e.code);
      let shot = SHOT_KEYS[e.code];
      if (shot === 'slice' && e.shiftKey) shot = 'drop';
      if (shot) { this.queue.push(shot); e.preventDefault(); }
      if (e.code === 'KeyC') this.actions.push('challenge');
      if (e.code === 'Escape' || e.code === 'KeyP') this.actions.push('pause');
      if (e.code === 'KeyV') this.actions.push('camera');
      if (e.code === 'KeyM') this.actions.push('mute');
      if (e.code === 'KeyH') this.actions.push('panel');
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  pressShot(type) { this.queue.push(type); }
  pressAction(a) { this.actions.push(a); }
  setTouchMove(x, y) { this.touchMove.x = x; this.touchMove.y = y; }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (!gp) return { x: 0, y: 0 };
    const map = { 0: 'topspin', 1: 'slice', 2: 'flat', 3: 'lob', 5: 'drop' };
    gp.buttons.forEach((b, i) => {
      const was = this.padPrev[i];
      if (b.pressed && !was) {
        if (map[i]) this.queue.push(map[i]);
        if (i === 4) this.actions.push('challenge');
        if (i === 9) this.actions.push('pause');
        if (i === 8) this.actions.push('camera');
      }
      this.padPrev[i] = b.pressed;
    });
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    let x = dz(gp.axes[0] || 0), y = -dz(gp.axes[1] || 0);
    if (gp.buttons[14]?.pressed) x = -1;
    if (gp.buttons[15]?.pressed) x = 1;
    if (gp.buttons[12]?.pressed) y = 1;
    if (gp.buttons[13]?.pressed) y = -1;
    return { x, y };
  }

  snapshot() {
    const d = this.down;
    let x = (d.has('KeyD') || d.has('ArrowRight') ? 1 : 0) - (d.has('KeyA') || d.has('ArrowLeft') ? 1 : 0);
    let y = (d.has('KeyW') || d.has('ArrowUp') ? 1 : 0) - (d.has('KeyS') || d.has('ArrowDown') ? 1 : 0);
    const pad = this.pollGamepad();
    if (pad.x || pad.y) { x = pad.x; y = pad.y; }
    if (this.touchMove.x || this.touchMove.y) { x = this.touchMove.x; y = this.touchMove.y; }
    const shots = this.queue.splice(0);
    const actions = this.actions.splice(0);
    return {
      move: { x, y },
      aim: { x, y },
      shots,
      challenge: actions.includes('challenge'),
      actions,
    };
  }
}
