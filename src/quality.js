// Watches real frame times and asks for a cheaper graphics setting when the
// game stays below ~30 fps. No DOM here so it can be unit-tested.

export class FrameBudget {
  /**
   * slowMs: average frame time that counts as too slow (≈ 30 fps).
   * hitchSec: a frame longer than this is a hitch unless it repeats.
   * maxFrameSec: longer gaps mean a throttled or suspended page, not a slow GPU.
   */
  constructor({ slowMs = 34, holdSec = 3, warmupSec = 4, cooldownSec = 6, hitchSec = 0.25, maxFrameSec = 0.75 } = {}) {
    this.slowMs = slowMs;
    this.holdSec = holdSec;
    this.warmupSec = warmupSec;
    this.cooldownSec = cooldownSec;
    this.hitchSec = hitchSec;
    this.maxFrameSec = maxFrameSec;
    this.reset();
  }

  reset() {
    this.t = 0;
    this.ema = null;
    this.slowFor = 0;
    this.nextAllowed = 0;
    this.longRun = 0;
  }

  /** Feed one frame's real duration (s). Returns true when a downgrade is due. */
  sample(dtSec) {
    if (!(dtSec > 0) || dtSec > this.maxFrameSec) {
      this.slowFor = 0;
      this.longRun = 0;
      return false;
    }
    // One or two long frames are hitches (GC, shader compile); from the third
    // in a row they are how this device runs, e.g. a steady 3 fps.
    if (dtSec > this.hitchSec) {
      this.longRun++;
      if (this.longRun < 3) return false;
    } else {
      this.longRun = 0;
    }
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
