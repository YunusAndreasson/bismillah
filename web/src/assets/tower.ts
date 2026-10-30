// The tower at night (stills/loop-night.jpg, the film's first shot) as fractions of its
// 1600 × 900 frame, measured by hand on the still: its bays, row by row and column by
// column, and the one window that stays lit. She is in it, at her laptop, under the
// film's play button.

const fractions = (pairs: readonly (readonly [number, number])[], size: number) =>
  pairs.map(([from, to]) => [from / size, to / size] as const);

export const TOWER_COLUMNS = fractions(
  [
    [25, 160],
    [185, 345],
    [360, 525],
    [530, 720],
    [728, 878],
    [895, 1075],
    [1090, 1245],
    [1262, 1425],
    [1440, 1600],
  ],
  1600,
);

export const TOWER_ROWS = fractions(
  [
    [0, 70],
    [124, 208],
    [260, 345],
    [398, 486],
    [538, 622],
    [676, 762],
    [830, 900],
  ],
  900,
);

/** Her window: its centre and size, and the bay it is in. */
export const HER_WINDOW = { x: 0.501, y: 0.491, width: 143 / 1600, column: 4, row: 3 };

export const TOWER_RATIO = 16 / 9;
