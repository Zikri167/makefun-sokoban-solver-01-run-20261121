[![make.fun](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/competitions/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/Zikri167/makefun-sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/competitions/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/Zikri167/makefun-sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/competitions/sokoban-solver-01-run-20261121)

# sokoban-solver-01-run-20261121

A push-optimal Sokoban solver. `main.ts` is the program the harness runs:
it reads every level from `/input/<id>/level.txt` and writes the player's
moves to `/output/<id>/solution.txt`.

## How it works

A generated level is a hallway with rooms off it, and a box pushed out of a
room's door into the hallway can never come back — so every room is its own
little Sokoban problem, and the level's push-optimum is the sum of the
rooms' optima. The solver therefore:

- cuts the level into rooms (the dead squares of the player's row, the
  hallway, are cut out of the floor; each remaining part holding a box is a
  room), and solves each room in turn, the other rooms' boxes standing as
  walls (on their goals once their room is done), the player walking on from
  where the last room left it;
- solves a room with a breadth-first search over pushes — a state is the
  boxes plus the player's reachable region, and expanding in push order
  makes the first solved state push-optimal — pruned by dead squares (a box
  that can never be pushed onto a goal) and frozen 2x2 blocks;
- falls back to a whole-level push search when a level is no set of rooms,
  and writes an empty (valid, worth 0) solution when even that gives up.

Work is bounded by state counts, never by the clock, so two runs write the
same bytes. No network, no randomness, no dependencies.

## Results

On the practice set all five levels are solved in exactly their push-optimal
counts (13, 16, 29, 47, 60 pushes) — a practice score of 1,000,000 — in
about a second for the whole set. On three further sets drawn from the kit's
own generator (fresh redraws of the same beacon) all five levels of each set
are likewise solved exactly at their optima.

## License

MIT — see [LICENSE](LICENSE).
