/**
 * The stick's last screen: the ﷽ frame with *Powering off…* or *Restarting…*, over
 * everything from the moment the writer asks until the session ends. Without it the
 * text would vanish into an empty console (os/PLAN.md, *Power*).
 */
export type FarewellAction = "off" | "reboot";

export const farewell = $state<{ action: FarewellAction | null }>({ action: null });

/** Long enough to read as a screen rather than a flicker: shutdown itself takes
 * well under a second once the helper is asked. */
export const HOLD_MS = 600;
/** After this the computer is plainly still on, and the writer gets the text back. */
export const STILL_ON_MS = 20_000;

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const painted = () =>
  new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

/**
 * Shows the farewell, waits for `saved` (the save, or its timeout) and for the screen
 * to be drawn and held, then makes `request`. Resolves only if the computer is still
 * on: the request failed, or nothing happened within STILL_ON_MS. The farewell is
 * gone by then, so the caller can say so.
 */
export async function farewellThen(
  action: FarewellAction,
  saved: Promise<unknown>,
  request: () => Promise<unknown>,
): Promise<void> {
  farewell.action = action;
  await Promise.all([saved, painted(), wait(HOLD_MS)]);
  try {
    await request();
    await wait(STILL_ON_MS);
  } catch {
    // Still on: say so below.
  }
  farewell.action = null;
}
