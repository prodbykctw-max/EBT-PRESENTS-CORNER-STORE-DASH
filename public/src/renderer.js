/**
 * Canvas 2D renderer. Draws a vector store by default; if the client's board art
 * is dropped in at public/assets/board.png it is used as the floor layer instead,
 * with shelves drawn as a translucent overlay so collision stays readable.
 */

import { COLORS, GRID } from './config.js';
import { STATE } from './game.js';

export class Renderer {
  constructor(canvas, maze) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.maze = maze;
    this.tile = GRID.TILE;
    this.board = null;
    this.#loadBoard();
    this.resize();
  }

  #loadBoard() {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { this.board = img; };
    img.onerror = () => { this.board = null; };
    img.src = 'assets/board.png';
  }

  /** Fit the grid to the container while staying pixel-crisp on high-DPI screens. */
  resize() {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const box = this.canvas.parentElement?.getBoundingClientRect();
    const avail = Math.min(box?.width || 640, globalThis.innerHeight * 0.7, 720);
    this.tile = Math.max(14, Math.floor(avail / this.maze.cols));
    const w = this.tile * this.maze.cols;
    const h = this.tile * this.maze.rowCount;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(game) {
    const { ctx } = this;
    const t = this.tile;
    const w = t * this.maze.cols;
    const h = t * this.maze.rowCount;

    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, w, h);
    if (this.board) ctx.drawImage(this.board, 0, 0, w, h);

    this.#drawShelves(w, h);
    this.#drawCheckout(game);
    this.#drawItems(game);
    this.#drawBully(game);
    this.#drawPlayer(game);
    if (game.state !== STATE.PLAYING) this.#drawOverlay(game, w, h);
  }

  #drawShelves() {
    const { ctx } = this;
    const t = this.tile;
    ctx.fillStyle = this.board ? 'rgba(31,111,235,0.55)' : COLORS.shelf;
    ctx.strokeStyle = COLORS.shelfEdge;
    ctx.lineWidth = Math.max(1, t * 0.06);
    for (let y = 0; y < this.maze.rowCount; y += 1) {
      for (let x = 0; x < this.maze.cols; x += 1) {
        if (!this.maze.isWall(x, y)) continue;
        const px = x * t;
        const py = y * t;
        ctx.beginPath();
        ctx.roundRect(px + t * 0.08, py + t * 0.08, t * 0.84, t * 0.84, t * 0.22);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  #drawCheckout(game) {
    const { ctx } = this;
    const t = this.tile;
    const { x, y } = this.maze.checkout;
    const open = game.listComplete;
    ctx.fillStyle = open ? COLORS.checkoutOpen : COLORS.checkoutLocked;
    ctx.globalAlpha = open ? 0.9 : 0.45;
    ctx.fillRect(x * t + t * 0.1, y * t + t * 0.1, t * 0.8, t * 0.8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.text;
    ctx.font = `${Math.floor(t * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(open ? '🛒' : '🔒', x * t + t / 2, y * t + t / 2);
  }

  #drawItems(game) {
    const { ctx } = this;
    const t = this.tile;
    ctx.font = `${Math.floor(t * 0.6)}px system-ui, "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const item of game.items) {
      if (item.collected) continue;
      ctx.fillText(item.emoji, item.x * t + t / 2, item.y * t + t / 2);
    }
  }

  #drawPlayer(game) {
    const { ctx } = this;
    const t = this.tile;
    const cx = game.player.x * t + t / 2;
    const cy = game.player.y * t + t / 2;
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#101318';
    const f = game.player.facing;
    ctx.beginPath();
    ctx.arc(cx + f.x * t * 0.12, cy + f.y * t * 0.12 - t * 0.05, t * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  #drawBully(game) {
    const { ctx } = this;
    const t = this.tile;
    const cx = game.bully.x * t + t / 2;
    const cy = game.bully.y * t + t / 2;
    ctx.fillStyle = game.grace > 0 ? COLORS.bullyScared : COLORS.bully;
    ctx.beginPath();
    ctx.arc(cx, cy - t * 0.05, t * 0.36, Math.PI, 0);
    ctx.lineTo(cx + t * 0.36, cy + t * 0.3);
    ctx.lineTo(cx - t * 0.36, cy + t * 0.3);
    ctx.closePath();
    ctx.fill();
  }

  #drawOverlay(game, w, h) {
    const { ctx } = this;
    const titles = {
      [STATE.READY]: 'CORNER STORE DASH',
      [STATE.CAUGHT]: 'CAUGHT',
      [STATE.WON]: 'CHECKED OUT',
      [STATE.OVER]: 'RUN OVER',
    };
    ctx.fillStyle = 'rgba(8,10,14,0.78)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.floor(w * 0.062)}px system-ui, sans-serif`;
    ctx.fillText(titles[game.state] ?? '', w / 2, h / 2 - w * 0.05);
    ctx.font = `${Math.floor(w * 0.032)}px system-ui, sans-serif`;
    ctx.fillText(game.message, w / 2, h / 2);
    ctx.fillStyle = COLORS.player;
    const hint = game.state === STATE.WON || game.state === STATE.OVER
      ? 'Press R to run it back'
      : 'Press SPACE or tap to go';
    ctx.fillText(hint, w / 2, h / 2 + w * 0.055);
  }
}
