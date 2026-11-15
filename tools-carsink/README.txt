Proof tools for the moving-car ride height (runner.js trail / clearRoad). Run from the repo root with the dev server up (npm run dev, or node scripts/serve.mjs <port>),
inside `flock /tmp/claude-browser.lock` when other browser jobs share the machine.
  measure.mjs <port> <out.json> [samples] [every]   bot run; every `every` frames, for every car instance and each LOD, the lowest tyre vertices and lowest body vertices against
                                                    world.surfAt under them (negative = under the road). Groups: role, LOD, parked/moving, climbing (up) / descending (down), decks, slopes.
  stills.mjs <port> <outdir> <tag>                   close-ups at car height of a moving concept car (BONLY=1) or a car under the road (SUNK=1) on a slope
  unit.mjs                                           node: the wheel heights clearRoad assumes against the pose World.render composes
  prepstart.mjs <url of standalone.html>             tap START DRIVE after the prepare finished -> ms until the drive is visible
