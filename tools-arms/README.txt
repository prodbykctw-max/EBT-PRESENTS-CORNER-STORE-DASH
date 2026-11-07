Proof tools for the arm swing (public/drive/people.js addArmSwing / ARMS; standalone/tools/arm_swing.py).

pages/*.html are test pages that load public/drive's own files: copy one into public/drive/ (it is not shipped from
here), run `node scripts/serve.mjs`, then:
  node tools-arms/probe.mjs  "http://localhost:5173/drive/arms-probe.html?clip=run&view=back&opt=<json>" out.png
      six poses across one stride, side or back view (opt: addArmSwing options; omit for the model's own clip)
  node tools-arms/sheet.mjs  "http://localhost:5173/drive/arms-sheet.html?clip=walk&opt=<json>" out.png
      the store's three rows (front, back, side) x 8 frames, camera 22 degrees up like the sprite bake
  node tools-arms/width.mjs  http://localhost:5173/drive/arms-width.html
      how far out the arm joints reach (bully size), before and after: drive.js BODY assumes ~0.42 m
tools-arms/chase.mjs runs against the real drive (no copy needed):
  node tools-arms/chase.mjs "http://localhost:5173/drive/index.html?qa" <tag>
      phone-size, seeded Math.random, GAS held through the on-foot chase on fixed ticks; prints Math.random calls,
      your and the bully's positions, errors; writes tools-arms/out/<tag>_<k>.jpg. Run it on main and on a branch to
      prove a change leaves the chase itself alone (the call count wobbles by 1-3 between two runs of main too).
tools-arms/store.mjs plays the store run (?nodrive, phone size), walks the shopper up/right/down/left and saves
  tools-arms/out/<tag>_store_<k>.png:  node tools-arms/store.mjs http://localhost:5173/standalone.html <tag>
tools-arms/rec_drive.mjs records the on-foot chase as a 60 fps video with its own sound (frames stepped 1/60 s with
  __drive.manual + tick, the game's WebAudio rendered offline on the same clock); part 1 the chase camera, part 2 a
  camera beside the bully. Writes <out>/f0000.jpg... + audio.wav; mux with ffmpeg -framerate 60.
