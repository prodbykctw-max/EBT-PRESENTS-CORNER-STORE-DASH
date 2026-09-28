// Haptics for the drive, the same as the store's (standalone/csd.js):
//   Android: the Vibration API.
//   iPhone: Safari has no Vibration API, but since iOS 17.4 toggling an <input type="checkbox" switch> plays the
//   system haptic tick, so a hidden one is clicked once per pulse of the pattern. iOS only allows it while the page
//   is handling a touch: taps and steering always tick, other events tick when they land mid-gesture.
const VIBRATE = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
let sw = null, last = 0;
function tickIOS() {
  if (sw === null) {
    sw = false;
    try {
      const lb = document.createElement('label'), inp = document.createElement('input');
      inp.type = 'checkbox'; inp.setAttribute('switch', ''); lb.appendChild(inp); lb.setAttribute('aria-hidden', 'true');
      lb.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(lb); sw = lb;
    } catch {}
  }
  if (sw) try { sw.click(); } catch {}
}
/** pattern: ms (one pulse) or [off, on, off, on, ...] like navigator.vibrate; minGap throttles repeats */
export function haptic(pattern, minGap = 0) {
  const now = performance.now();
  if (minGap && now - last < minGap) return;
  last = now;
  if (VIBRATE) { try { navigator.vibrate(pattern); } catch {} return; }
  const segs = typeof pattern === 'number' ? [0, pattern] : pattern;
  let at = 0;
  segs.forEach((ms, i) => { if (i % 2) { if (at === 0) tickIOS(); else setTimeout(tickIOS, at); } at += ms; });
}
export const HAP = {
  tap: 12,                        // a button
  lane: 10,                       // steering across a lane line
  edge: 22,                       // steering into the curb
  token: [0, 14],
  nearMiss: [0, 18, 40, 12],
  bump: 25,                       // cones, a dog, someone jumping clear
  crash: [0, 30, 40, 60],
  go: [0, 20, 60, 30],
  parked: [0, 30, 55, 30, 55, 60],
  busted: [0, 60, 80, 60, 80, 200],
};

/** iPhone: since iOS 26.5 Safari only plays the switch haptic for a REAL tap on a switch's label (the scripted
 *  label.click() above no longer buzzes). So every button gets an invisible label + switch laid over it: your
 *  finger taps the label, the switch flips, the phone ticks. (It fires on the tap itself, as iOS does for any
 *  switch; a long hold that iOS doesn't count as a tap gets no tick.) Android keeps navigator.vibrate. */
export function tapHaptic(el) {
  if (VIBRATE || !el || el.querySelector(':scope > .hapl')) return;
  const lb = document.createElement('label'); lb.className = 'hapl'; lb.setAttribute('aria-hidden', 'true');
  const inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', ''); inp.tabIndex = -1;
  inp.addEventListener('click', (e) => e.stopPropagation());        // the label's own click is the one the button hears
  lb.appendChild(inp); el.appendChild(lb);
}
