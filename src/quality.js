// Watches real frame times and asks for a cheaper graphics setting when the
// game stays below ~30 fps. No DOM here so it can be unit-tested.

export class FrameBudget {
  constructor({ slowMs = 34, holdSec = 3, warmupSec = 4, cooldownSec = 6 } = {}) {
    this.slowMs = slowMs;
    this.holdSec = holdSec;
    this.warmupSec = warmupSec;
    this.cooldownSec = cooldownSec;
    this.reset();
  }

  reset() {
    this.t = 0;
    this.ema = null;
    this.slowFor = 0;
    this.nextAllowed = 0;
  }

  /** Feed one frame's real duration (s). Returns true when a downgrade is due. */
  sample(dtSec) {
    // Background tabs and one-off hitches are not a performance signal.
    if (!(dtSec > 0) || dtSec > 0.25) { this.slowFor = 0; return false; }
    this.t += dtSec;
    const ms = dtSec * 1000;
    this.ema = this.ema === null ? ms : this.ema * 0.9 + ms * 0.1;
    if (this.t < this.warmupSec || this.t < this.nextAllowed) return false;
    this.slowFor = this.ema > this.slowMs ? this.slowFor + dtSec : 0;
    if (this.slowFor < this.holdSec) return false;
    this.slowFor = 0;
    this.ema = null;
    this.nextAllowed = this.t + this.cooldownSec;
    return true;
  }
}

/** The next cheaper setting: shadows off first, then bigger pixels. */
export function nextCheaperSetting(settings) {
  if (settings.shadows === 'on') return { key: 'shadows', value: 'off', label: '그림자 끔' };
  const px = Number(settings.pixel) || 2;
  if (px < 4) return { key: 'pixel', value: String(px + 1), label: `픽셀 크기 ${px + 1}×` };
  return null;
}
