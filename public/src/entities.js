/**
 * Actors move tile-to-tile on the grid. Position is kept in float tile units so
 * rendering is smooth, but every turn decision happens exactly on a tile centre —
 * that is what keeps the player from ever clipping a shelf corner.
 */

import { DIRS } from './maze.js';
import { TUNING } from './config.js';

export class Actor {
  constructor(maze, tile, speed) {
    this.maze = maze;
    this.speed = speed;
    this.reset(tile);
  }

  reset(tile) {
    this.tile = { ...tile };
    this.next = { ...tile };
    this.x = tile.x;
    this.y = tile.y;
    this.facing = DIRS.left;
  }

  atNode() {
    return this.tile.x === this.next.x && this.tile.y === this.next.y;
  }

  #commit(dir) {
    if (!dir) return false;
    const nx = this.tile.x + dir.x;
    const ny = this.tile.y + dir.y;
    if (!this.maze.isOpen(nx, ny)) return false;
    this.next = { x: nx, y: ny };
    this.facing = dir;
    return true;
  }

  update(dt) {
    let budget = this.speed * dt;
    let guard = 0;
    while (budget > 0 && guard < 64) {
      guard += 1;
      if (this.atNode() && !this.#commit(this.chooseDir())) break;
      const dx = this.next.x - this.x;
      const dy = this.next.y - this.y;
      const remaining = Math.hypot(dx, dy);
      if (remaining <= budget || remaining === 0) {
        this.x = this.next.x;
        this.y = this.next.y;
        this.tile = { ...this.next };
        budget -= remaining;
      } else {
        this.x += (dx / remaining) * budget;
        this.y += (dy / remaining) * budget;
        budget = 0;
      }
    }
  }

  distanceTo(other) {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }

  // eslint-disable-next-line class-methods-use-this
  chooseDir() {
    return null;
  }
}

/** You. One shopper, one cart, one list. */
export class Player extends Actor {
  constructor(maze) {
    super(maze, maze.spawn, TUNING.PLAYER_SPEED);
    this.queued = null;
  }

  reset(tile) {
    super.reset(tile);
    this.queued = null;
  }

  turn(dir) {
    this.queued = dir;
  }

  chooseDir() {
    if (this.queued && this.maze.isOpen(this.tile.x + this.queued.x, this.tile.y + this.queued.y)) {
      const d = this.queued;
      this.queued = null;
      return d;
    }
    return this.facing;
  }
}

/**
 * The bully. Single antagonist, so his behaviour has to carry the whole chase:
 * mostly a shortest-path hunt, with a scatter roll so he is readable but not
 * perfectly predictable, and no reversing unless he is boxed in.
 */
export class Bully extends Actor {
  constructor(maze, target) {
    super(maze, maze.penSpawn, TUNING.BULLY_SPEED_BASE);
    this.target = target;
    this.penTimer = TUNING.PEN_DELAY;
    this.rng = Math.random;
  }

  reset(tile) {
    super.reset(tile);
    this.penTimer = TUNING.PEN_DELAY;
  }

  /** Speed ramps with the player's progress — the store gets meaner as you fill the cart. */
  setPressure(itemsCollected) {
    this.speed = TUNING.BULLY_SPEED_BASE + itemsCollected * TUNING.BULLY_SPEED_PER_ITEM;
  }

  update(dt) {
    if (this.penTimer > 0) {
      this.penTimer -= dt;
      return;
    }
    super.update(dt);
  }

  chooseDir() {
    const exits = this.maze.exits(this.tile.x, this.tile.y);
    if (!exits.length) return null;
    const forward = exits.filter((e) => !(e.x === -this.facing.x && e.y === -this.facing.y));
    const options = forward.length ? forward : exits;
    if (this.rng() < TUNING.SCATTER_CHANCE) {
      return options[Math.floor(this.rng() * options.length)];
    }
    const step = this.maze.nextStepToward(this.tile, this.target.tile);
    if (step && options.some((e) => e.x === step.x && e.y === step.y)) return step;
    return options[Math.floor(this.rng() * options.length)];
  }
}
