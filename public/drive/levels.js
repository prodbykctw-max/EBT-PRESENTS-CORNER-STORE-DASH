// One height stack for the whole city, so nothing ever sits inside anything else.
// All values are metres above the terrain function ground(x, y) (bilinear over the DEM).
//   terrain mesh (lots, plazas, sidewalks) ... TERRAIN
//   lawns, parks, parking surfaces ........... AREA
//   road surface (every drivable ribbon) ..... ROAD (+ a tiny per-class bias so crossings don't z-fight)
//   the drive route's own road ............... ROUTE
//   top of curbs ............................. CURB_TOP
// Anything that stands on a surface uses that surface's level: cars/cones on ROAD, people/trees on TERRAIN.
export const LEVEL = { TERRAIN: -0.05, AREA: 0.02, ROAD: 0.14, ROUTE: 0.17, CURB_TOP: 0.29 };

/** Where a vehicle's body sits on a surface: sample the ground under its four WHEELS (±hl along, ±hw across),
 *  return the centre height plus the pitch (nose up +) and roll (right side up +) of the plane through them.
 *  `a` is the heading (world radians), hl/hw are half the wheelbase and half the track. */
export function standOn(ground, x, y, a, hl, hw) {
  const c = Math.cos(a), s = Math.sin(a), at = (f, r) => ground(x + c * f + s * r, y + s * f - c * r);
  const fl = at(hl, -hw), fr = at(hl, hw), bl = at(-hl, -hw), br = at(-hl, hw);
  const z = (fl + fr + bl + br) / 4, dp = (fl + fr - bl - br) / 4, dr = (fr + br - fl - bl) / 4;
  // on a twisted surface a rigid body can't touch all four: settle it so no wheel is ever below the road
  // (like suspension, the others hang a few centimetres)
  const lift = Math.max(0, fl - (z + dp - dr), fr - (z + dp + dr), bl - (z - dp - dr), br - (z - dp + dr));
  return { z: z + lift, pitch: Math.atan2(2 * dp, 2 * hl), roll: Math.atan2(2 * dr, 2 * hw) };
}

/** Top of a freeway deck (before the road lift) at world (x, y) for deck height h above terrain.
 *  High decks ride the smooth shared grade (so a ramp merging into the Connector lines up exactly); low ramp
 *  ends blend onto the real ground (so a ramp lands on the street instead of stepping off a ledge). */
export function deckTop(ground, x, y, h) {
  const g = ground(x, y);
  if (h <= 0.05) return g;
  const k = Math.min(1, Math.max(0, (h - 1) / 4)), t = k * k * (3 - 2 * k); // 0 below 1 m, 1 above 5 m
  return Math.max(g + (ground.grade(x, y) - g) * t + h, g);
}
