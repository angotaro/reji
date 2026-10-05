// A two-note chime, synthesised with WebAudio (no audio assets to host).
let ctx = null;

/** Call from a user gesture (e.g. the Charge button) so iOS allows playback later. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* ignore */ }
}

export function chime() {
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [[1318.51, 0], [1975.53, 0.13]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.3, now + delay + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.75);
    });
  } catch { /* ignore */ }
}
