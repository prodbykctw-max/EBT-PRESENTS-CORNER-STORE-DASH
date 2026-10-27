# Start flow and screen changes

What a player sees from opening the game to the first store run, in order, and how each screen hands off to the
next. The code is `standalone/csd.js` (the flow functions, `show` / `hide`, the `motion (GSAP)` block),
`standalone/shell2.html` (the screens and their CSS) and, for the drive, `public/drive/drive.js` (its loader and
`finish()`) and `public/drive/drive.css`.

## The rule

- **One how-to-play per part, at the moment it's needed.** The drive's how-to-play (`ovDriveHow`) comes right
  before the drive; the store's (`ovHow`) comes once you're at the store, right before the run. Nothing else
  teaches the controls on screen. (The drive used to also flash "GAS to go · ◀ ▶ change lanes · HORN clears the
  way" for 5 s at the start, while you were still on foot, where it was the wrong instruction. It's gone.) The
  drive's short in-game nudges ("Hold GAS — run to your car", "Pull right to the curb ▸") stay: they react to what
  you're doing.
- **The store only shows on its own turn**: dimmed behind the title card, then the run and its pause / end screens.
  From the drive's how-to-play until START RUN it is hidden (`storeView(false)`) and not drawn at all, so no fade or
  hand-off can flash it, and a phone isn't drawing a hidden store under the 3D drive.
- **Every screen-to-screen fade takes 0.3 s** (`SCREEN_FADE` in `csd.js` and `drive.js`). Fades go through black or
  the dark loader colour, never through another screen. If the phone stalls (the first sound starting up on the
  START DRIVE tap took ~0.4 s in testing), GSAP counts any gap over 0.2 s as one frame (`lagSmoothing(200, 33)`), so
  a fade plays from its start instead of being already over on the first frame you see.
- **Nothing shows before it's ready**: the title's card and button rise only after LOADING has faded; the drive's
  loader stays on top of its HUD and buttons until the first 3D frame is on screen.
- **Reduced motion** (phone setting) or no GSAP: the same order, with instant changes instead of fades and rises
  (the drive's fade to black stays as a plain 0.3 s CSS fade).

## The flow

| # | Screen | How it arrives | How it leaves |
| --- | --- | --- | --- |
| 1 | **LOADING…** (`#loading`, black) | first paint (the page's own colour is the game's black from the first frame) | when the store art has decoded: fades 0.3 s off the title's dimmed backing, which is already up underneath (the store never shows undimmed) |
| 2 | **Title** (`ovTitle`: EBT PRESENTS / CORNER STORE DASH, TAP TO START, credits) over the dimmed store | its card and button rise once LOADING is gone; TAP TO START starts pulsing after its entrance (1 s) | TAP TO START: the drive's how-to-play covers it at once, the title fades away underneath |
| 3 | **Drive how-to-play** (`ovDriveHow`, plain black) | solid at once, its lines and START DRIVE rise | START DRIVE: the AUBURN AVE screen's dark backing fades up over it (0.3 s), the how-to-play is removed underneath, then "AUBURN AVE / Get to the corner store" fades in (0.2 s). The drive is mounted in a hidden box until the backing is fully up, so its own loader can't show through the fade |
| 4 | **AUBURN AVE loading screen** | the store page's copy (`driveCover`) while the drive's code arrives, then the drive's own (`.drive-loading`, with the progress bar). The two are laid out identically (measured: same positions to 0.1 px), so the switch is invisible | the first 3D frame is drawn under it; two display frames later it fades 0.3 s; the world holds still until it's gone, then the chase starts; the HUD drops in from the top and the pedals rise as it lifts |
| 5 | **The drive** (on foot to your car, then the race) | | parked, too late, SKIP or BUSTED → "Drive again": a black veil fades over it (0.3 s), then the drive is removed |
| 6 | **Store how-to-play** (`ovHow`, plain black) | solid at once on the black (black to black: nothing flashes), its lines and START RUN rise | START RUN: fades 0.3 s onto the store, which then shows its whole layout for 1.6 s and zooms in on you (1 s) before anyone moves |
| 7 | **The run**, then the end / pause screens | | |

After BUSTED, "Drive again" fades to black and the AUBURN AVE loading screen fades in from black (step 4 again).
"Run it back" on the end screen goes straight into a new store run; MAIN MENU goes back to the title.

## Phones

- Every screen keeps clear of the notch, home bar and rounded corners (`env(safe-area-inset-*)`, 20 px minimum).
  Screens are centred with auto margins, so one taller than a small phone (the end screen with the leaderboard on a
  375 x 667 iPhone SE) scrolls from its top instead of being cut off at both ends.
- No rubber-band bounce or pull-to-refresh (`overscroll-behavior: none`), no text enlarging on rotation
  (`text-size-adjust: 100%`), no pinch zoom on iPhone (`gesturestart` is cancelled; Safari ignores the viewport tag's
  zoom settings).
- **Home screen:** `public/game.webmanifest` (name, standalone display, the game's black as background and theme
  colour, the cart icons) on the main link, plus the Apple tags: `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style: black` (an opaque black status bar above the game, so the top of the store
  never sits under the notch), `apple-mobile-web-app-title`, and `color-scheme: dark`. The GitHub Pages copy leaves
  the manifest out (its start address would be the old modular build); the Apple tags still apply there.
- Known iOS limit, not ours to fix: on a cold launch from the home screen in dark mode, iOS can show a white frame
  between its own splash and the first paint (WebKit bug 311569; no page setting removes it).

## Testing it

This flow was checked by recording it in a headless phone-sized browser (390 x 844): a screen-capture frame
sequence plus a log, every animation frame, of which screens were up and at what opacity, and whether the store
canvas was visible. On a computer: `npm run dev`, open `http://localhost:5173/standalone.html` in a phone-sized
window, and go through it once with the browser's "reduce motion" setting on and once off.
