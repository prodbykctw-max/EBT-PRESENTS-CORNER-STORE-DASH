/** Rules of the run: collect the list, dodge the bully, clear the checkout lane. */

import { TUNING } from './config.js';
import { Maze } from './maze.js';
import { Player, Bully } from './entities.js';

export const STATE = {
  READY: 'ready',
  PLAYING: 'playing',
  CAUGHT: 'caught',
  WON: 'won',
  OVER: 'over',
};

export class Game {
  constructor({ onChange } = {}) {
    this.maze = new Maze();
    this.player = new Player(this.maze);
    this.bully = new Bully(this.maze, this.player);
    this.onChange = onChange ?? (() => {});
    this.newRun();
  }

  newRun() {
    this.items = this.maze.buildItems();
    this.score = 0;
    this.lives = TUNING.LIVES;
    this.timeLeft = TUNING.TIME_LIMIT;
    this.grace = 0;
    this.state = STATE.READY;
    this.message = 'Grab the whole list, then hit checkout.';
    this.#respawn();
    this.#publish();
  }

  start() {
    if (this.state === STATE.READY || this.state === STATE.CAUGHT) {
      this.state = STATE.PLAYING;
      this.message = '';
      this.#publish();
    }
  }

  get collected() {
    return this.items.filter((i) => i.collected).length;
  }

  get listComplete() {
    return this.collected === this.items.length;
  }

  #respawn() {
    this.player.reset(this.maze.spawn);
    this.bully.reset(this.maze.penSpawn);
    this.bully.setPressure(this.collected);
    this.grace = TUNING.RESPAWN_GRACE;
  }

  #publish() {
    this.onChange(this.snapshot());
  }

  snapshot() {
    return {
      state: this.state,
      score: this.score,
      lives: this.lives,
      timeLeft: Math.max(0, Math.ceil(this.timeLeft)),
      collected: this.collected,
      total: this.items.length,
      items: this.items.map(({ id, label, emoji, collected }) => ({ id, label, emoji, collected })),
      listComplete: this.listComplete,
      message: this.message,
    };
  }

  update(dt) {
    if (this.state !== STATE.PLAYING) return;
    const step = Math.min(dt, 0.05); // clamp: a backgrounded tab must not teleport the bully
    this.timeLeft -= step;
    if (this.grace > 0) this.grace -= step;

    this.player.update(step);
    if (this.grace <= 0) this.bully.update(step);

    this.#collect();
    this.#checkout();
    this.#collide();

    if (this.timeLeft <= 0 && this.state === STATE.PLAYING) {
      this.state = STATE.OVER;
      this.message = 'Store closed. Run out of time.';
    }
    this.#publish();
  }

  #collect() {
    for (const item of this.items) {
      if (item.collected) continue;
      if (item.x === this.player.tile.x && item.y === this.player.tile.y) {
        item.collected = true;
        this.score += item.points;
        this.bully.setPressure(this.collected);
        this.message = this.listComplete ? 'List done — get to checkout!' : `Bagged ${item.label}.`;
      }
    }
  }

  #checkout() {
    const { x, y } = this.maze.checkout;
    if (this.player.tile.x !== x || this.player.tile.y !== y) return;
    if (!this.listComplete) {
      this.message = 'Checkout is locked until the list is done.';
      return;
    }
    this.score += Math.ceil(this.timeLeft) * TUNING.TIME_BONUS + this.lives * TUNING.LIFE_BONUS;
    this.state = STATE.WON;
    this.message = 'Checked out clean. Nothing but EBT.';
  }

  #collide() {
    if (this.grace > 0) return;
    if (this.player.distanceTo(this.bully) > 0.7) return;
    this.lives -= 1;
    if (this.lives <= 0) {
      this.state = STATE.OVER;
      this.message = 'Caught at the cooler. Run over.';
      return;
    }
    this.state = STATE.CAUGHT;
    this.message = `Caught! ${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left.`;
    this.#respawn();
  }
}
