'use strict';
// Tiny WebAudio sound effects - no audio files needed.
const Sound = (() => {
  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // call on first user gesture to unlock audio on mobile
  function unlock() { ac(); }

  function tone(freq, dur, type = 'sine', gain = 0.15, when = 0, slideTo = null) {
    const c = ac(); if (!c || !enabled) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime + when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + when + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(gain, c.currentTime + when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + when);
    o.stop(c.currentTime + when + dur + 0.05);
  }

  return {
    unlock,
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; },
    click() { tone(600, 0.06, 'triangle', 0.08); },
    tap() { tone(480, 0.05, 'sine', 0.06); },
    correct() { tone(880, 0.1, 'sine', 0.15); tone(1320, 0.14, 'sine', 0.15, 0.09); },
    wrong() { tone(220, 0.22, 'sawtooth', 0.12, 0, 150); },
    star() { tone(1040, 0.08, 'triangle', 0.12); tone(1560, 0.12, 'triangle', 0.12, 0.07); },
    levelup() { [523,659,784,1047].forEach((f,i)=>tone(f,0.16,'triangle',0.15,i*0.09)); },
    tick() { tone(900, 0.05, 'square', 0.05); },
    pop() { tone(700, 0.09, 'triangle', 0.12, 0, 1400); },
    whoosh() { tone(300, 0.25, 'sine', 0.08, 0, 1200); },
  };
})();
window.Sound = Sound;
