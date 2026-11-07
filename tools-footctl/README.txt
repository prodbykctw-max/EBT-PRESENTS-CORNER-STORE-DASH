Proof tools for the on-foot controls (drag anywhere to run, like the store: drive.js footVec + the stick block).
Run the dev server (node scripts/serve.mjs), then:
  node tools-footctl/drag.mjs  "http://localhost:5173/drive/index.html?qa"   touches in every direction, keys, a drag held into the car
  node tools-footctl/lat.mjs   "http://localhost:5173/drive/index.html?qa"   straight across / back up with the bully held back; slide after release
  node tools-footctl/mouse.mjs "http://localhost:5173/drive/index.html?qa&look=comic"   desktop mouse drag
  node tools-footctl/chase.mjs "http://localhost:5173/drive/index.html?qa" <tag>   a held-↑ run, positions + Math.random count (compare with main)
Touches and pointer events are dispatched in the page to the element under the finger: headless Chrome here stalls its
animation frames and holds real touchmove events back until a frame is drawn (a phone draws 60 a second).
  node tools-footctl/rec_foot.mjs "http://localhost:5173/drive/index.html?qa" <out dir>   a scripted thumb run recorded at 60 fps
      with the game's own sound: game-camera frames + ui.json (ring/thumb per frame) + audio.wav
