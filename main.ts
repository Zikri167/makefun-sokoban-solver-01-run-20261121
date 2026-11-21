// Sokoban solver: push-optimal, room by room.
//
// A generated level is a hallway with rooms off it; a box pushed out of a
// room's door into the hallway can never come back, so every room is its own
// little Sokoban problem and the level's optimum is the sum of the rooms'.
// Each room is solved with a breadth-first search over pushes (the first
// solved state met is push-optimal), pruned by dead squares and frozen 2x2
// blocks. Work is bounded by state counts, never by the clock, so two runs
// write the same bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INPUT_DIR: string = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUTPUT_DIR: string = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
// States one push search may keep before it gives up (the generator only
// keeps rooms this search solves inside this budget).
const MAX_STATES: number = 250000;
const RETRY_STATES: number = 750000;

type Dir = [number, number, string, string];
const DIRS: Dir[] = [
  [0, -1, "u", "U"],
  [0, 1, "d", "D"],
  [-1, 0, "l", "L"],
  [1, 0, "r", "R"],
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** Parse XSB text: # wall, space floor, . goal, $ box, * box on goal, @ player, + player on goal. */
function parseLevel(text: string): Level {
  const rows: string[] = text.split("\n").filter((r: string): boolean => r.length > 0);
  const h: number = rows.length;
  const w: number = Math.max(...rows.map((r: string): number => r.length));
  const wall: Uint8Array = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player: number = -1;
  rows.forEach((row: string, y: number): void => {
    for (let x: number = 0; x < row.length; x++) {
      const ch: string = row[x] as string;
      const i: number = y * w + x;
      if (ch === "#") continue;
      wall[i] = 0;
      if (ch === "." || ch === "*" || ch === "+") goals.push(i);
      if (ch === "$" || ch === "*") boxes.push(i);
      if (ch === "@" || ch === "+") player = i;
    }
  });
  for (let y: number = 0; y < h; y++) {
    for (let x: number = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a: number, b: number): number => a - b), player };
}

/** Squares a lone box can be pushed from onto some goal, by pulling back from the goals. */
function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live: Uint8Array = new Uint8Array(wall.length);
  const queue: number[] = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi: number = 0; qi < queue.length; qi++) {
    const x: number = queue[qi] as number;
    for (const [dx, dy] of DIRS) {
      const d: number = dy * w + dx;
      const y: number = x - d;
      if (y < 0 || y >= wall.length) continue;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * Flood fill from `from` around walls and boxes; marks the region with
 * `stamp` in `seen` and returns its lowest square (the region's name).
 */
function reach(
  level: Level,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  const { w, wall } = level;
  let low: number = from;
  let n: number = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p: number = stack[--n] as number;
    if (p < low) low = p;
    for (let k: number = 0; k < 4; k++) {
      const q: number = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
      if (q < 0 || q >= wall.length) continue;
      if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

/** True when the box just pushed to `t` sits in a frozen 2x2 block of walls and boxes with a box off its goal. */
function frozenBlock(level: Level, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  const { w, wall } = level;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    if (a < 0 || a + w + 1 >= wall.length || (a % w) === w - 1) continue;
    const b: number = a + 1;
    const c: number = a + w;
    const d: number = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b])) continue;
    if (!(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

/** Shortest walk from `from` to `to` around walls and boxes, lower-case LURD, first direction first on ties. */
function walkTo(level: Level, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = level;
  if (from === to) return "";
  const prev: Int32Array = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array<string>(wall.length);
  const queue: number[] = [from];
  prev[from] = from;
  for (let qi: number = 0; qi < queue.length; qi++) {
    const p: number = queue[qi] as number;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q: number = p + dy * w + dx;
      if (q < 0 || q >= wall.length) continue;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error("walkTo: push square out of reach");
  let s: string = "";
  for (let p: number = to; p !== from; p = prev[p] as number) s = (how[p] as string) + s;
  return s;
}

/** The square the player stands on after `moves` (case aside) from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p: number = from;
  for (const ch of moves.toLowerCase()) p += ch === "u" ? -w : ch === "d" ? w : ch === "l" ? -1 : 1;
  return p;
}

interface Solution {
  pushes: number;
  moves: string;
}

/**
 * Push-optimal solution of `level` within `maxStates` states, or null when
 * the search gives up (or the level has no solution). States are the boxes
 * plus the player's reachable region; expanding in push order makes the
 * first solved state optimal. `bigKey` uses a string key (for many boxes);
 * otherwise a numeric key, exact while size ** (boxes + 1) stays under 2**53.
 */
function solvePushOptimal(level: Level, maxStates: number, bigKey: boolean): Solution | null {
  const { w, wall, goals } = level;
  const size: number = wall.length;
  const goal: Uint8Array = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live: Uint8Array = liveSquares(level);
  if (level.boxes.some((b: number): boolean => !live[b])) return null;
  const occupied: Uint8Array = new Uint8Array(size);
  const seen: Int32Array = new Int32Array(size);
  // Two stamp arrays: `seen` marks the expanded state's region, `mark` the
  // region of each state a push makes (sharing one array would clobber the
  // expansion region while keys are computed).
  const mark: Int32Array = new Int32Array(size);
  const stack: Int32Array = new Int32Array(size);
  let stamp: number = 0;
  const solved = (boxes: number[]): boolean => boxes.every((b: number): boolean => goal[b] === 1);
  const keyOf = (boxes: number[], low: number): number | string => {
    if (bigKey) return `${low}:${boxes.join(",")}`;
    let k: number = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };

  const statesBoxes: number[][] = [level.boxes];
  const statesPlayer: number[] = [level.player];
  const parent: number[] = [-1];
  const index: Map<number | string, number> = new Map();
  for (const b of level.boxes) occupied[b] = 1;
  index.set(keyOf(level.boxes, reach(level, occupied, level.player, seen, ++stamp, stack)), 0);
  for (const b of level.boxes) occupied[b] = 0;
  let found: number = solved(level.boxes) ? 0 : -1;
  for (let head: number = 0; found < 0 && head < statesBoxes.length; head++) {
    const boxes: number[] = statesBoxes[head] as number[];
    for (const b of boxes) occupied[b] = 1;
    reach(level, occupied, statesPlayer[head] as number, seen, ++stamp, stack);
    const here: number = stamp;
    for (let bi: number = 0; bi < boxes.length && found < 0; bi++) {
      const b: number = boxes[bi] as number;
      for (const [dx, dy] of DIRS) {
        const d: number = dy * w + dx;
        const t: number = b + d;
        if (t < 0 || t >= size) continue;
        // The player must be able to stand on the far side of the box.
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const frozen: boolean = frozenBlock(level, occupied, goal, t);
        let key: number | string = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x: number, y: number): number => x - y);
          key = keyOf(next, reach(level, occupied, b, mark, ++stamp, stack));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (frozen || index.has(key)) continue;
        if (statesBoxes.length >= maxStates) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        index.set(key, statesBoxes.length);
        statesBoxes.push(next as number[]);
        statesPlayer.push(b);
        parent.push(head);
        if (solved(next as number[])) {
          found = statesBoxes.length - 1;
          break;
        }
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let s: number = found; s > 0; s = parent[s] as number) path.push(s);
  path.reverse();
  let moves: string = "";
  let player: number = level.player;
  let boxes: number[] = level.boxes;
  for (const s of path) {
    const nextBoxes: number[] = statesBoxes[s] as number[];
    const from: number = boxes.find((b: number): boolean => !nextBoxes.includes(b)) as number;
    const to: number = nextBoxes.find((b: number): boolean => !boxes.includes(b)) as number;
    const d: number = to - from;
    const dir: Dir = DIRS.find(([dx, dy]: Dir): boolean => dy * w + dx === d) as Dir;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += dir[3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
  done: boolean;
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway:
 * a box there reaches no goal) out of the floor; each remaining part holding
 * a box is a room. Null when a box starts in the hallway or a part's boxes
 * and goals do not match.
 */
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live: Uint8Array = liveSquares(level);
  const row: number = Math.floor(player / w);
  const cut: Uint8Array = new Uint8Array(wall.length);
  for (let i: number = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b: number): boolean => cut[b] === 1)) return null;
  const part: Int32Array = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s: number = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares: number[] = [s];
    part[s] = rooms.length;
    for (let i: number = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q: number = (squares[i] as number) + dy * w + dx;
        if (q < 0 || q >= wall.length) continue;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [], done: false });
  }
  for (const b of boxes) (rooms[part[b] as number] as Room).boxes.push(b);
  for (const g of goals) {
    if (part[g] as number >= 0) (rooms[part[g] as number] as Room).goals.push(g);
  }
  if (goals.some((g: number): boolean => (part[g] as number) < 0)) return null;
  if (rooms.some((r: Room): boolean => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r: Room): boolean => r.boxes.length > 0);
}

/**
 * Solve room by room: each room push-optimal in turn, the other rooms'
 * boxes standing as walls (on their goals once their room is done), the
 * player walking on from where the last room left it.
 */
function solveByRooms(level: Level, maxStates: number): Solution | null {
  const rooms: Room[] | null = roomsOf(level);
  if (rooms === null) return null;
  let player: number = level.player;
  let pushes: number = 0;
  let moves: string = "";
  for (const room of rooms) {
    const wall: Uint8Array = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
    }
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a: number, b: number): number => a - b),
      boxes: room.boxes.slice().sort((a: number, b: number): number => a - b),
      player,
    };
    let solved: Solution | null = solvePushOptimal(sub, maxStates, false);
    if (solved === null) solved = solvePushOptimal(sub, RETRY_STATES, false);
    if (solved === null) return null;
    pushes += solved.pushes;
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
    room.done = true;
  }
  return { pushes, moves };
}

/** One level's moves: room by room, else a whole-level search, else empty (valid, worth 0). */
function solveLevel(text: string): string {
  const level: Level = parseLevel(text);
  const byRooms: Solution | null = solveByRooms(level, MAX_STATES);
  if (byRooms !== null) return byRooms.moves;
  const whole: Solution | null = solvePushOptimal(level, MAX_STATES, true);
  if (whole !== null) return whole.moves;
  return "";
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  const moves: string = solveLevel(readFileSync(join(INPUT_DIR, id, "level.txt"), "utf8"));
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, "solution.txt"), `${moves}\n`);
}
