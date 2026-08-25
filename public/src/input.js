/** Keyboard, swipe and on-screen D-pad, all funnelled into one turn/action API. */

import { DIRS } from './maze.js';

const KEY_MAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

export function bindInput({ onTurn, onStart, onRestart, surface }) {
  const turn = (name) => name && onTurn(DIRS[name]);

  globalThis.addEventListener('keydown', (e) => {
    const dir = KEY_MAP[e.code];
    if (dir) {
      e.preventDefault();
      turn(dir);
      onStart();
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      onStart();
    }
    if (e.code === 'KeyR') onRestart();
  }, { passive: false });

  let touch = null;
  surface.addEventListener('touchstart', (e) => {
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    onStart();
  }, { passive: true });

  surface.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.hypot(dx, dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 'right' : 'left');
    else turn(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  for (const btn of document.querySelectorAll('[data-dir]')) {
    const fire = (e) => {
      e.preventDefault();
      turn(btn.dataset.dir);
      onStart();
    };
    btn.addEventListener('pointerdown', fire);
  }

  surface.addEventListener('click', () => onStart());
}
