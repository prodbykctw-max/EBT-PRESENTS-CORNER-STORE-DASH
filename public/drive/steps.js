// Helpers for builders that can be run in pieces. A builder written as a generator (`function*`) yields wherever the browser may be given a turn;
// the sync version everyone always called is `drain(builder())`, the same code run to the end, so its results (and every Math.random draw and object id) are exactly what they were.
// The drive's background prepare (drive.js) steps a builder and lets the page run (the title's animation) between the pieces.
/** run a builder to the end without stopping: its return value */
export function drain(it) { let r = it.next(); while (!r.done) r = it.next(); return r.value; }
/** Whether the builders should give the page a turn. True only while a prepared drive builds behind the title screen; once START DRIVE has been tapped (or for any normal start) it is false and `due()` is never true, so the build runs back to back */
export const pace = { slow: false };
/** a stopwatch: `if (due()) yield 'what';` is true once `ms` have passed since it last was (so a loop yields every few milliseconds of work, not every turn). The clock is read every 16th call only. */
export function slicer(ms = 8) { let t = performance.now(), c = 0; return () => { if (!pace.slow || (++c & 15)) return false; const n = performance.now(); if (n - t < ms) return false; t = n; return true; }; }
