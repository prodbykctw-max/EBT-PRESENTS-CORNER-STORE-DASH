// evaluated in the 3D page: where does the floor land on screen, against where the 2D game puts it? (placeView: screen = board * scale + (tx, ty))
(() => {
  const s = window.__s3d, c = s.centre, L = s.layout, out = { scale: c.scale, tx: c.tx, ty: c.ty, errs: [] };
  let max = 0, sum = 0, n = 0, worst = null;
  for (let by = 0; by <= L.board.h; by += 60) for (let bx = 0; bx <= L.board.w; bx += 60) {
    const sx2 = c.tx + bx * c.scale, sy2 = c.ty + by * c.scale;
    if (sx2 < -5 || sx2 > s.view.w + 5 || sy2 < -5 || sy2 > s.view.h + 5) continue;
    const [sx3, sy3] = s.project(bx / 48, 0, by / 48), e = Math.hypot(sx3 - sx2, sy3 - sy2); n++; sum += e; if (e > max) { max = e; worst = { bx, by, e2d: [sx2, sy2], e3d: [sx3, sy3] }; }
  }
  out.points = n; out.meanErrPx = +(sum / n).toFixed(3); out.maxErrPx = +max.toFixed(3); out.worst = worst;
  // tilt direction: a 2 m tall post on the floor must rise UP the screen
  const [a, b] = [s.project(10, 0, 10), s.project(10, 2, 10)]; out.twoMetreHeightPx = +(a[1] - b[1]).toFixed(1); out.personSpritePx = L.PLAYER_DISPLAY * c.scale;
  return out;
})()
