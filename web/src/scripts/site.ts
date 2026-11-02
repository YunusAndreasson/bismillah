// The site's one script. Everything reads and plays without it: the film has the
// browser's own controls, her screen is a still, the page is all in ink, and the stick's
// command is selected with one click. With it, the film gets the quiet player, the
// camera pushes into her screen, her page is written as it is read and Zuhd mode follows
// the reader, the caret wakes when it comes into view, and the command has a copy button.
// ARIA is set as attributes: Firefox reflects it as properties only from 119.

import { HER_WINDOW, TOWER_COLUMNS, TOWER_RATIO, TOWER_ROWS } from "../assets/tower";

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 0:42, the player's time. */
const clock = (seconds: number) => {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Runs `paint` once in the next frame, however often it is asked for before then. */
const perFrame = (paint: () => void) => {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      paint();
    });
  };
};

/** Hermite easing, for the camera: it starts and arrives gently. */
const ease = (p: number) => p * p * (3 - 2 * p);

/** How far through `from`–`to` the progress `p` is, from 0 to 1. */
const within = (p: number, from: number, to: number) => clamp((p - from) / (to - from), 0, 1);

/** How far the page has scrolled through a scene that holds still in a window of this height. */
const scrolled = (scene: Element, windowHeight = window.innerHeight) => {
  const { top, height } = scene.getBoundingClientRect();
  const room = height - windowHeight;
  return room > 0 ? clamp(-top / room, 0, 1) : 0;
};

/** Tells `change` whether the element is in view, whenever that changes. */
function watchView(
  element: Element,
  change: (inView: boolean) => void,
  options?: IntersectionObserverInit,
): IntersectionObserver {
  const observer = new IntersectionObserver(([entry]) => {
    change(entry?.isIntersecting ?? false);
  }, options);
  observer.observe(element);
  return observer;
}

/** Runs `wake` once, when the element is well into view. */
function onceInView(element: Element, wake: () => void): void {
  const observer = watchView(
    element,
    (inView) => {
      if (!inView) return;
      observer.disconnect();
      wake();
    },
    { threshold: 0.6 },
  );
}

/**
 * Keeps a scene in step with the page. `measure` runs now and when the window changes;
 * `update` runs now, and in the next frame after a change of window or, while the scene is
 * near the screen, any scrolling.
 */
function follow(scene: Element, update: () => void, measure?: () => void): void {
  const queue = perFrame(update);
  measure?.();
  update();
  window.addEventListener("resize", () => {
    measure?.();
    queue();
  });
  watchView(
    scene,
    (near) => {
      if (near) window.addEventListener("scroll", queue, { passive: true });
      else window.removeEventListener("scroll", queue);
      queue();
    },
    { rootMargin: "50% 0px" },
  );
}

/** Lays an element over its parent, in fractions of it. Through the CSSOM, which the CSP
 * allows (a style attribute it refuses). */
function lay(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  element.style.left = `${left * 100}%`;
  element.style.top = `${top * 100}%`;
  element.style.width = `${width * 100}%`;
  element.style.height = `${height * 100}%`;
}

/** Names a button for screen readers, from one of the labels the page gave it. */
function setLabel(button: HTMLElement, label?: string): void {
  if (label) button.setAttribute("aria-label", label);
}

/** The typewriter line: 42% from the top, where the editor keeps the caret. */
const TYPEWRITER_LINE = "-42% 0px -57% 0px";

/** A document's paragraphs and headings, in order. */
const blocksOf = (article: HTMLElement) => [...article.querySelectorAll<HTMLElement>(".text > *")];

function film(root: HTMLElement): void {
  const video = root.querySelector<HTMLVideoElement>("[data-video]");
  const loop = root.querySelector<HTMLVideoElement>(".loop");
  const controls = root.querySelector<HTMLElement>("[data-controls]");
  const hit = root.querySelector<HTMLButtonElement>("[data-hit]");
  const play = root.querySelector<HTMLButtonElement>("[data-play]");
  const now = root.querySelector<HTMLElement>("[data-now]");
  const total = root.querySelector<HTMLElement>("[data-total]");
  const position = root.querySelector<HTMLInputElement>("[data-position]");
  const mute = root.querySelector<HTMLButtonElement>("[data-mute]");
  const full = root.querySelector<HTMLButtonElement>("[data-full]");
  if (!video || !controls || !hit || !play || !now || !total || !position || !mute || !full) return;

  video.controls = false;
  controls.hidden = false;
  hit.hidden = false;
  root.toggleAttribute("data-ready", true);

  const state = (next: "idle" | "playing" | "paused" | "ended") => {
    root.dataset.state = next;
    setLabel(play, next === "playing" ? play.dataset.labelPause : play.dataset.labelPlay);
  };

  // The playhead moves every frame while the film plays, so the caret glides.
  let frame = 0;

  // If no source can play in this browser, say so where the page offers the other way in,
  // rather than leave controls that do nothing. The film never played, so the opening
  // shot is still to come.
  const line = root.querySelector<HTMLElement>(".or-scroll");
  const giveUp = () => {
    cancelAnimationFrame(frame);
    controls.hidden = true;
    hit.hidden = true;
    state("idle");
    root.closest(".film")?.toggleAttribute("data-seen", false);
    if (line?.dataset.cannot) line.textContent = line.dataset.cannot;
  };
  video.querySelector("source:last-of-type")?.addEventListener("error", giveUp);
  video.addEventListener("error", giveUp);

  const toggle = () => {
    if (video.paused || video.ended) {
      loop?.pause();
      video.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "NotSupportedError") giveUp();
        else state(video.currentTime > 0 ? "paused" : "idle");
      });
    } else {
      video.pause();
    }
  };
  const draw = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : Number(position.max);
    position.value = String(video.currentTime);
    position.setAttribute("aria-valuetext", `${clock(video.currentTime)} / ${clock(duration)}`);
    now.textContent = clock(video.currentTime);
  };
  const run = () => {
    draw();
    if (!video.paused) frame = requestAnimationFrame(run);
  };

  // The controls rest while the film plays, and come back for the pointer or the keys.
  let rest = 0;
  const wake = () => {
    root.toggleAttribute("data-idle", false);
    clearTimeout(rest);
    rest = window.setTimeout(() => {
      if (root.dataset.state === "playing" && !controls.contains(document.activeElement)) {
        root.toggleAttribute("data-idle", true);
      }
    }, 2500);
  };

  video.addEventListener("loadedmetadata", () => {
    position.max = String(video.duration);
    total.textContent = clock(video.duration);
  });
  video.addEventListener("play", () => {
    state("playing");
    wake();
  });
  video.addEventListener("playing", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(run);
  });
  video.addEventListener("pause", () => {
    if (!video.ended) state("paused");
    wake();
  });
  video.addEventListener("ended", () => {
    state("ended");
    wake();
  });
  video.addEventListener("seeked", draw);

  play.addEventListener("click", toggle);
  hit.addEventListener("click", toggle);
  position.addEventListener("input", () => {
    video.currentTime = Number(position.value);
    now.textContent = clock(video.currentTime);
  });

  mute.addEventListener("click", () => {
    video.muted = !video.muted;
    root.toggleAttribute("data-muted", video.muted);
    setLabel(mute, video.muted ? mute.dataset.labelUnmute : mute.dataset.labelMute);
  });

  full.addEventListener("click", () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (root.requestFullscreen) {
      void root.requestFullscreen();
    } else {
      // iPhone: only the video itself goes full screen, with the system's controls.
      (
        video as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
      ).webkitEnterFullscreen?.();
    }
  });

  root.addEventListener("pointermove", wake);
  root.addEventListener("focusin", wake);
  root.addEventListener("keydown", (event) => {
    switch (event.key) {
      case " ":
      case "k":
        if (event.target instanceof HTMLButtonElement && event.key === " ") return;
        event.preventDefault();
        toggle();
        break;
      case "ArrowLeft":
      case "ArrowRight":
        if (event.target === position) return;
        event.preventDefault();
        video.currentTime = clamp(
          video.currentTime + (event.key === "ArrowLeft" ? -5 : 5),
          0,
          video.duration || 0,
        );
        break;
      case "m":
        mute.click();
        break;
      case "f":
        full.click();
        break;
      default:
        return;
    }
    wake();
  });
}

/** A point in a still, as fractions of its frame. */
type Point = { x: number; y: number };

/** Where the camera ends a move: how far it has travelled, and how close it has come. */
type Move = Point & { scale: number };

/** The camera `e` of the way through a move. */
const shot = ({ x, y, scale }: Move, e: number) =>
  `translate(${x * e}px, ${y * e}px) scale(${1 + (scale - 1) * e})`;

/**
 * Sizes a 16:9 picture's own frame to cover `width` × `height` with `point` as near the
 * centre as the frame allows, turns the camera on that point, and says how far the camera
 * must still move to centre it.
 */
function cover(
  element: HTMLElement,
  width: number,
  height: number,
  point: Point,
): Point & { frameWidth: number; frameHeight: number } {
  const frameWidth = Math.max(width, height * TOWER_RATIO);
  const frameHeight = frameWidth / TOWER_RATIO;
  const left = clamp(width / 2 - point.x * frameWidth, width - frameWidth, 0);
  const top = clamp(height / 2 - point.y * frameHeight, height - frameHeight, 0);
  element.style.inlineSize = `${frameWidth}px`;
  element.style.blockSize = `${frameHeight}px`;
  element.style.insetInlineStart = `${left}px`;
  element.style.insetBlockStart = `${top}px`;
  element.style.transformOrigin = `${point.x * 100}% ${point.y * 100}%`;
  return {
    x: width / 2 - (left + point.x * frameWidth),
    y: height / 2 - (top + point.y * frameHeight),
    frameWidth,
    frameHeight,
  };
}

/**
 * The opening shot. The first screen holds while the page scrolls: the name, the title and
 * the play button leave, which uncovers her, in the window they were on; the tower's
 * lights go out, the far ones first, until only hers is left; and the camera goes to it.
 * The film's own shots, at the visitor's pace, and all of it undone by scrolling back.
 */
function tower(scene: HTMLElement): void {
  const screen = scene.querySelector<HTMLElement>("[data-screen]");
  const layer = scene.querySelector<HTMLElement>("[data-tower-layer]");
  const lights = scene.querySelector<HTMLElement>("[data-lights]");
  const dusk = scene.querySelector<HTMLElement>("[data-dusk]");
  const video = scene.querySelector<HTMLVideoElement>("[data-video]");
  if (!screen || !layer || !lights || !dusk || !video || reduceMotion.matches) return;

  const pane = (left: number, top: number, width: number, height: number) => {
    const element = document.createElement("span");
    lay(element, left, top, width, height);
    return element;
  };

  // One dark pane to a bay, in the order they go out: furthest from her first, a little
  // unevenly, as people go to bed. A fixed scatter, so the shot is the same every time.
  const panes = TOWER_ROWS.flatMap(([top, bottom], row) =>
    TOWER_COLUMNS.flatMap(([left, right], column) => {
      if (row === HER_WINDOW.row && column === HER_WINDOW.column) return [];
      const away = Math.hypot(column - HER_WINDOW.column, (row - HER_WINDOW.row) * 1.4);
      return [
        {
          element: pane(left, top, right - left, bottom - top),
          order: away + ((column * 7 + row * 13) % 5) * 0.9,
        },
      ];
    }),
  )
    .sort((a, b) => b.order - a.order)
    .map(({ element }) => element);
  // The rest of the front: all of the picture around her window, in four panes.
  const [herLeft = 0, herRight = 1] = TOWER_COLUMNS[HER_WINDOW.column] ?? [];
  const [herTop = 0, herBottom = 1] = TOWER_ROWS[HER_WINDOW.row] ?? [];
  const rest = [
    pane(0, 0, 1, herTop),
    pane(0, herBottom, 1, 1 - herBottom),
    pane(0, herTop, herLeft, herBottom - herTop),
    pane(herRight, herTop, 1 - herRight, herBottom - herTop),
  ];
  for (const element of rest) element.className = "rest";
  panes.push(...rest);
  lights.replaceChildren(...panes);

  scene.toggleAttribute("data-live", true);

  let move: Move = { x: 0, y: 0, scale: 1 };
  const measure = () => {
    const { width, height } = screen.getBoundingClientRect();
    const placed = cover(layer, width, height, HER_WINDOW);
    // Her window takes about a third of the screen, the frame's pixels allowing.
    const scale = clamp((0.36 * width) / (HER_WINDOW.width * placed.frameWidth), 1.6, 4);
    move = { x: placed.x, y: placed.y, scale };
  };

  const update = () => {
    if (scene.hasAttribute("data-seen")) return;
    const p = scrolled(scene);
    scene.toggleAttribute("data-left", p > 0.015);
    scene.toggleAttribute("data-done", p >= 1);
    const out = within(p, 0.05, 0.62) * panes.length;
    for (const [i, pane] of panes.entries()) pane.toggleAttribute("data-out", i < out);
    layer.style.transform = shot(move, ease(within(p, 0.62, 1)));
    dusk.style.opacity = String(within(p, 0.86, 1));
  };

  // Once it has played it is a film like any other, and the page just scrolls past it.
  video.addEventListener("play", () => {
    if (scene.hasAttribute("data-seen")) return;
    scene.toggleAttribute("data-seen", true);
    scene.toggleAttribute("data-left", false);
    scene.toggleAttribute("data-done", false);
    layer.style.transform = "";
    dusk.style.opacity = "0";
    window.scrollTo(0, 0);
  });

  follow(scene, update, measure);
}

/** Her laptop's screen in still 03 (x 1120–1738, y 408–852 of 1920 × 1080): its centre and
 * size, as fractions of the frame. */
const SCREEN = { x: 1429 / 1920, y: 630 / 1080, width: 618 / 1920, height: 444 / 1080 };
/** Her laptop on the table in still 02, a little towards her. */
const ROOM = { x: 0.46, y: 0.59, scale: 1.2 };

/** Where her lit screen is in the window just now, once the room has dissolved to it. */
let herScreen: { left: number; top: number; right: number; bottom: number } | null = null;

function push(section: HTMLElement): void {
  const camera = section.querySelector<HTMLElement>("[data-camera]");
  const room = section.querySelector<HTMLElement>("[data-room]");
  const light = section.querySelector<HTMLElement>("[data-light]");
  const veil = section.querySelector<HTMLElement>("[data-veil]");
  if (!camera || !room || !light || !veil || reduceMotion.matches) return;
  section.toggleAttribute("data-live", true);
  // Her laptop's screen, whose light rises to the page's as the camera arrives.
  lay(
    light,
    SCREEN.x - SCREEN.width / 2,
    SCREEN.y - SCREEN.height / 2,
    SCREEN.width,
    SCREEN.height,
  );

  // Each camera box is its still's own frame, covering the stage with what it looks at as
  // near the centre as the frame allows; the move ends with her screen centred and larger
  // than the stage.
  let move: Move = { x: 0, y: 0, scale: 1 };
  let roomMove: Move = { x: 0, y: 0, scale: ROOM.scale };
  const measure = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const placed = cover(camera, width, height, SCREEN);
    move = {
      x: placed.x,
      y: placed.y,
      scale:
        1.08 *
        Math.max(
          width / (SCREEN.width * placed.frameWidth),
          height / (SCREEN.height * placed.frameHeight),
        ),
    };
    roomMove = { ...cover(room, width, height, ROOM), scale: ROOM.scale };
  };

  const update = () => {
    const p = scrolled(section);
    // Her room comes up out of the dark, the camera drifting towards her, then dissolves to
    // her hands, and the camera pushes into her screen.
    room.style.opacity = String(Math.min(within(p, 0, 0.1), 1 - within(p, 0.32, 0.46)));
    // Her hands stay unseen until her room covers them, so the room rises out of the dark.
    camera.style.visibility = p < 0.1 ? "hidden" : "visible";
    room.style.transform = shot(roomMove, ease(within(p, 0, 0.5)));
    const q = within(p, 0.42, 1);
    camera.style.transform = shot(move, ease(q));
    light.style.opacity = String(within(q, 0.5, 0.85));
    veil.style.opacity = String(within(q, 0.85, 1));
    if (p < 0.46) {
      herScreen = null;
    } else {
      const frame = camera.getBoundingClientRect();
      const x = frame.left + SCREEN.x * frame.width;
      const y = frame.top + SCREEN.y * frame.height;
      // Its lit middle: the screen stands at an angle, so its box's corners are still dark.
      // A tall window meets it nearer the edge, as the corner is nearer the screen's middle.
      const lit = window.innerWidth < window.innerHeight ? 0.96 : 0.88;
      const halfWidth = (lit * SCREEN.width * frame.width) / 2;
      const halfHeight = (lit * SCREEN.height * frame.height) / 2;
      herScreen = {
        left: x - halfWidth,
        top: y - halfHeight,
        right: x + halfWidth,
        bottom: y + halfHeight,
      };
    }
  };

  follow(section, update, measure);
}

function zuhd(article: HTMLElement): void {
  const blocks = blocksOf(article);
  const first = blocks[0];
  if (!first) return;
  let current = first;
  current.classList.add("current");
  article.toggleAttribute("data-zuhd-on", true);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.target === current) continue;
        current.classList.remove("current");
        current = entry.target as HTMLElement;
        current.classList.add("current");
      }
    },
    { rootMargin: TYPEWRITER_LINE },
  );
  for (const block of blocks) observer.observe(block);
}

/** One thing written at the caret: a line or a sentence, or the machine's offer. */
type Beat = { block: HTMLElement; words: HTMLElement; offer: boolean };

/**
 * Rewrites a block's words as pieces, one for each sentence (or, for the line the machine
 * offers to finish, for what comes either side of its offer), with the same text in the
 * same order, so what a screen reader reads and what can be copied are unchanged. The
 * offer is hidden from screen readers: it isn't hers, and without the script it isn't there.
 */
function beatsOf(block: HTMLElement, after?: string, words?: string): Beat[] {
  const text = block.textContent ?? "";
  const offered = Boolean(after && words && text.startsWith(after));
  const parts =
    offered && after ? [after, text.slice(after.length).trim()] : text.split(/(?<=[.?!])\s+/);
  const beats: Beat[] = [];
  const nodes: Node[] = [];
  for (const [i, part] of parts.entries()) {
    if (i > 0) nodes.push(document.createTextNode(" "));
    const piece = document.createElement("span");
    piece.className = "piece";
    piece.textContent = part;
    nodes.push(piece);
    beats.push({ block, words: piece, offer: false });
    if (offered && i === 0) {
      const offer = document.createElement("span");
      offer.className = "offer";
      offer.textContent = words ?? "";
      offer.hidden = true;
      offer.setAttribute("aria-hidden", "true");
      nodes.push(document.createTextNode(" "), offer);
      beats.push({ block, words: offer, offer: true });
    }
  }
  block.replaceChildren(...nodes);
  return beats;
}

/**
 * Writes a document as it is read, in the editor's typewriter mode: the page holds still
 * while the visitor scrolls, each stretch of scrolling is one beat, and the beat's
 * line stays on the typewriter line. What is written follows from where the page is, so
 * no way of getting there (a key, a link, a reload) can miss a line. Returns false if the
 * document isn't written like this, and all of it is simply there.
 */
function written(article: HTMLElement): boolean {
  const stage = article.querySelector<HTMLElement>(".stage");
  const sheet = article.querySelector<HTMLElement>(".sheet");
  const blocks = blocksOf(article);
  if (!stage || !sheet || !blocks.length || reduceMotion.matches) return false;

  const { offerAfter, offerWords } = article.dataset;
  const beats = blocks.flatMap((block) => beatsOf(block, offerAfter, offerWords));

  // Each beat is a stretch of scrolling, and the hinge of the page gets more: the machine's
  // offer has to be read, even at a steady roll of the wheel, and her answer has to land.
  // One more at the end: the last line holds a while before the page moves on.
  let scrolling = 0;
  const ends = beats.map((beat, i) => {
    scrolling += beat.offer ? 3 : beats[i - 1]?.offer ? 2 : 1;
    return scrolling;
  });
  const total = scrolling + 1;
  article.style.setProperty("--beats", String(total));
  article.toggleAttribute("data-live", true);
  article.toggleAttribute("data-writing", true);
  article.toggleAttribute("data-zuhd-on", true);

  // The tops are the page without the offer, which only ever pushes down what is unseen.
  let tops = new Map<HTMLElement, number>();
  let shown = -1;

  const hold = () => {
    const beat = beats[shown];
    if (!beat) return;
    const y = stage.clientHeight * 0.42 - (tops.get(beat.block) ?? 0);
    sheet.style.transform = `translateY(${Math.round(y)}px)`;
  };

  const measure = () => {
    tops = new Map(blocks.map((block) => [block, block.offsetTop]));
    hold();
  };

  const show = (at: number) => {
    if (at === shown) return;
    shown = at;
    const beat = beats[at];
    if (!beat) return;
    // The caret stays after the last thing she wrote, even while the machine offers more.
    const last = beats.slice(0, at + 1).findLast((each) => !each.offer);
    for (const [i, each] of beats.entries()) {
      if (each.offer) {
        each.words.hidden = i !== at;
      } else {
        each.words.classList.toggle("written", i <= at);
        each.words.classList.toggle("end", each === last);
      }
    }
    for (const block of blocks) {
      block.classList.toggle("current", block === beat.block);
      block.classList.toggle("end", block === beat.block);
    }
    article.toggleAttribute("data-awake", at === beats.length - 1);
    hold();
  };

  const update = () => {
    article.toggleAttribute("data-arrived", article.getBoundingClientRect().top <= 1);
    const place = scrolled(article, stage.clientHeight) * total;
    const at = ends.findIndex((end) => place < end);
    show(at === -1 ? beats.length - 1 : at);
  };

  follow(article, update, measure);
  void document.fonts.ready.then(measure);
  return true;
}

/** A text's caret blinks once its last line is in view. A document being written wakes
 * its caret itself, once its last line is written. */
function caret(text: HTMLElement): void {
  if (text.hasAttribute("data-writing")) return;
  const last = text.querySelector(".text > :last-child");
  if (last) onceInView(last, () => text.toggleAttribute("data-awake", true));
}

/** The editor's screens on her laptop: one at a time, changed by scrolling. The laptop
 * holds still (the stage is sticky) while the track scrolls past, and each equal
 * stretch of it is one screen, so scrolling back brings the last one back. Nothing
 * changes on its own. */
function screens(section: HTMLElement): void {
  const track = section.querySelector<HTMLElement>("[data-track]");
  const states = [...section.querySelectorAll<HTMLElement>("[data-state]")];
  const marks = section.querySelector<HTMLElement>("[data-marks]");
  const lines = [...section.querySelectorAll<HTMLElement>("[data-mark]")];
  if (!track || !marks || states.length < 2) return;

  let current = -1;
  const show = (next: number): void => {
    if (next === current) return;
    current = next;
    for (const [i, state] of states.entries()) state.toggleAttribute("data-current", i === next);
    for (const [i, line] of lines.entries()) line.toggleAttribute("data-current", i === next);
  };

  // Set through the CSSOM, which the CSP allows (a style attribute it refuses).
  track.style.setProperty("--n", String(states.length));
  section.toggleAttribute("data-live", true);
  marks.hidden = false;
  follow(section, () => {
    show(Math.min(states.length - 1, Math.floor(scrolled(track) * states.length)));
  });
}

/** Each of the stick's commands: one press copies it, and the button says so for two seconds. */
function command(box: HTMLElement): void {
  const code = box.querySelector("code");
  const button = box.querySelector<HTMLButtonElement>("[data-copy]");
  const status = box.querySelector<HTMLElement>("[data-copy-status]");
  if (!code || !button || !status || !navigator.clipboard) return;
  const label = button.textContent;
  const copied = button.dataset.copied ?? label;
  button.hidden = false;

  let rest = 0;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText((code.textContent ?? "").trim());
    } catch {
      // Refused (no permission, or the page lost focus): the command is still there to
      // select by hand, and one click on it selects all of it.
      return;
    }
    button.textContent = copied;
    status.textContent = copied;
    clearTimeout(rest);
    rest = window.setTimeout(() => {
      button.textContent = label;
      status.textContent = "";
    }, 2000);
  });
}

/**
 * Which command this computer runs: "windows", "unix" (macOS and Linux), or null for a
 * phone, a tablet or a Chromebook, which can't make a stick, or a platform not read.
 */
function computer(): string | null {
  const hints = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = hints?.platform || navigator.platform || "";
  if (/android|cros|chrome os|iphone|ipad/i.test(`${platform} ${navigator.userAgent}`)) return null;
  if (/^win/i.test(platform)) return "windows";
  // An iPad asks for the desktop site as a Mac; only it has a touch screen.
  if (/^mac/i.test(platform)) return navigator.maxTouchPoints > 1 ? null : "unix";
  if (/^linux/i.test(platform)) return "unix";
  return null;
}

/** Only this computer's command and where to paste it, without the label that tells the
 * commands apart. Without the script, or on a computer that can't make a stick, both
 * stay. */
function ownCommand(stick: HTMLElement): void {
  const own = computer();
  const boxes = [...stick.querySelectorAll<HTMLElement>("[data-os]")];
  if (!own || !boxes.some((box) => box.dataset.os === own)) return;
  for (const box of boxes) box.hidden = box.dataset.os !== own;
  for (const label of stick.querySelectorAll<HTMLElement>(".label")) label.hidden = true;
}

/** The corner button takes the ground of the world it is over, the night or the page, so
 * its quiet words read on both; and it leads to the stick, so while the stick is on the
 * screen it steps aside. */
function corner(button: HTMLElement): void {
  const root = document.documentElement;
  const mark = () => {
    const box = button.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const under = document
      .elementsFromPoint(x, y)
      .find((element) => element !== button && !button.contains(element))
      ?.closest(".night, .page");
    // Her scene is the night until her lit screen has come up behind the button, or, in a
    // window too tall for it to reach the corner, its light has become the page.
    const veil = under?.querySelector<HTMLElement>("[data-veil]");
    const lit = veil ? herScreen : null;
    const onHerScreen =
      lit !== null && x > lit.left && x < lit.right && y > lit.top && y < lit.bottom;
    const page =
      under?.classList.contains("page") || onHerScreen || Number(veil?.style.opacity ?? 0) > 0.15;
    root.dataset.under = page ? "page" : "night";
  };
  // A frame later than the scenes, whose state in this frame it reads, and again when the
  // scrolling stops, as after a jump a scene only hears of it a moment later.
  let settle = 0;
  const queue = perFrame(() => {
    requestAnimationFrame(mark);
    clearTimeout(settle);
    settle = window.setTimeout(mark, 150);
  });
  mark();
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);

  const stick = document.querySelector("#stick");
  if (stick) watchView(stick, (inView) => root.toggleAttribute("data-at-stick", inView));
}

const scenes: [string, (element: HTMLElement) => void][] = [
  ["[data-film]", film],
  ["[data-tower]", tower],
  ["[data-push]", push],
  [
    "[data-zuhd]",
    (article) => {
      if (!(article.hasAttribute("data-written") && written(article))) zuhd(article);
    },
  ],
  ["[data-caret]", caret],
  ["[data-screens]", screens],
  ["[data-command]", command],
  ["#stick", ownCommand],
  [".to-stick", corner],
];
for (const [selector, start] of scenes) {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) start(element);
}

// The scenes above make the page longer, so a link to a later scene lands where it points.
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
