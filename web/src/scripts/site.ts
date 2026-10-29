// The site's one script. Everything reads and plays without it: the film has the
// browser's own controls, her screen is a still, the page is all in ink, and the stick's
// command is selected with one click. With it, the film gets the quiet player, the
// camera pushes into her screen, her page is written as it is read and Zuhd mode follows
// the reader, the caret wakes when it comes into view, and the command has a copy button.
// ARIA is set as attributes: Firefox reflects it as properties only from 119.

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

/** The typewriter line: 42% from the top, where the editor keeps the caret. */
const TYPEWRITER_LINE = "-42% 0px -57% 0px";

/** A document's paragraphs and headings, in order. */
const blocksOf = (article: HTMLElement) => [...article.querySelectorAll<HTMLElement>(".text > *")];

/** Runs `wake` once, when the element is well into view. */
function onceInView(element: Element, wake: () => void): void {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      wake();
    },
    { threshold: 0.6 },
  );
  observer.observe(element);
}

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

  const state = (name: "idle" | "playing" | "paused" | "ended") => {
    root.dataset.state = name;
    const label = name === "playing" ? play.dataset.labelPause : play.dataset.labelPlay;
    if (label) play.setAttribute("aria-label", label);
  };

  // The playhead moves every frame while the film plays, so the caret glides.
  let frame = 0;

  // If no source can play in this browser, hand over to the browser's own player,
  // which says why, rather than leave a play button that does nothing.
  const giveUp = () => {
    cancelAnimationFrame(frame);
    controls.hidden = true;
    hit.hidden = true;
    root.toggleAttribute("data-ready", false);
    video.controls = true;
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
    const label = video.muted ? mute.dataset.labelUnmute : mute.dataset.labelMute;
    if (label) mute.setAttribute("aria-label", label);
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
    const target = event.target as HTMLElement;
    const onButton = target instanceof HTMLButtonElement;
    const onRange = target === position;
    switch (event.key) {
      case " ":
      case "k":
        if (onButton && event.key === " ") return;
        event.preventDefault();
        toggle();
        break;
      case "ArrowLeft":
      case "ArrowRight":
        if (onRange) return;
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

/** Her laptop's screen in still 03, as fractions of the frame: its centre and size. */
const SCREEN = { x: 0.744, y: 0.583, width: 0.3219, height: 0.4111 };
const STILL_RATIO = 16 / 9;

function push(section: HTMLElement): void {
  const camera = section.querySelector<HTMLElement>("[data-camera]");
  const light = section.querySelector<HTMLElement>("[data-light]");
  const veil = section.querySelector<HTMLElement>("[data-veil]");
  if (!camera || !light || !veil || reduceMotion.matches) return;
  section.toggleAttribute("data-live", true);

  // The camera box is the still's own frame, covering the stage with her screen as
  // near the centre as the frame allows; from there the move ends with her screen
  // centred and larger than the stage.
  let move = { x: 0, y: 0, scale: 1 };
  const measure = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const frameWidth = Math.max(width, height * STILL_RATIO);
    const frameHeight = frameWidth / STILL_RATIO;
    const left = clamp(width / 2 - SCREEN.x * frameWidth, width - frameWidth, 0);
    const top = clamp(height / 2 - SCREEN.y * frameHeight, height - frameHeight, 0);
    camera.style.inlineSize = `${frameWidth}px`;
    camera.style.blockSize = `${frameHeight}px`;
    camera.style.insetInlineStart = `${left}px`;
    camera.style.insetBlockStart = `${top}px`;
    move = {
      x: width / 2 - (left + SCREEN.x * frameWidth),
      y: height / 2 - (top + SCREEN.y * frameHeight),
      scale:
        1.08 *
        Math.max(width / (SCREEN.width * frameWidth), height / (SCREEN.height * frameHeight)),
    };
  };

  const update = () => {
    const box = section.getBoundingClientRect();
    const travel = box.height - window.innerHeight;
    const p = travel > 0 ? clamp(-box.top / travel, 0, 1) : 0;
    const e = p * p * (3 - 2 * p);
    camera.style.transform = `translate(${move.x * e}px, ${move.y * e}px) scale(${1 + (move.scale - 1) * e})`;
    light.style.opacity = String(clamp((p - 0.5) / 0.35, 0, 1));
    veil.style.opacity = String(clamp((p - 0.85) / 0.15, 0, 1));
  };
  const queue = perFrame(update);

  measure();
  update();
  window.addEventListener("resize", () => {
    measure();
    queue();
  });
  // Listen to scrolling only while the stage is near the screen.
  new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) window.addEventListener("scroll", queue, { passive: true });
      else window.removeEventListener("scroll", queue);
      queue();
    },
    { rootMargin: "50% 0px" },
  ).observe(section);
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

/** Writes a document as it is read: each paragraph arrives when it reaches the typewriter
 * line, the caret after it, and once the last is written the caret blinks. */
function written(article: HTMLElement): void {
  const blocks = blocksOf(article);
  const first = blocks[0];
  const last = blocks.at(-1);
  if (!first || !last || reduceMotion.matches) return;
  let end = first;
  first.classList.add("written", "end");
  article.toggleAttribute("data-writing", true);

  const write = (block: HTMLElement) => {
    const at = blocks.indexOf(block);
    if (at <= blocks.indexOf(end)) return;
    for (const done of blocks.slice(0, at + 1)) done.classList.add("written");
    end.classList.remove("end");
    end = block;
    end.classList.add("end");
    if (block === last) {
      observer.disconnect();
      article.toggleAttribute("data-awake", true);
    }
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) write(entry.target as HTMLElement);
    },
    { rootMargin: TYPEWRITER_LINE },
  );
  for (const block of blocks) observer.observe(block);
  // A visitor who arrives below it (a reload further down) finds it written.
  if (article.getBoundingClientRect().bottom < window.innerHeight * 0.42) write(last);
}

/** A text's caret blinks once its last line is in view. A document being written wakes
 * its caret itself, once its last line is written. */
function caret(text: HTMLElement): void {
  if (text.hasAttribute("data-writing")) return;
  const last = text.querySelector(".text > :last-child");
  if (last) onceInView(last, () => text.toggleAttribute("data-awake", true));
}

/** The editor's screens on her laptop: one at a time, changed by the five words under
 * it, or by a click on the screen itself, which shows the next. Nothing changes on its
 * own. */
function screens(section: HTMLElement): void {
  const states = [...section.querySelectorAll<HTMLElement>("[data-state]")];
  const words = section.querySelector<HTMLElement>("[data-words]");
  const buttons = [...section.querySelectorAll<HTMLButtonElement>("[data-show]")];
  if (!words || states.length < 2) return;

  let current = 0;
  const show = (next: number): void => {
    current = next;
    for (const [i, state] of states.entries()) {
      state.toggleAttribute("data-current", i === next);
      state.setAttribute("aria-hidden", String(i !== next));
    }
    for (const [i, button] of buttons.entries())
      button.setAttribute("aria-pressed", String(i === next));
  };

  section.toggleAttribute("data-live", true);
  words.hidden = false;
  for (const [i, button] of buttons.entries()) button.addEventListener("click", () => show(i));
  for (const state of states) {
    state
      .querySelector("img")
      ?.addEventListener("click", () => show((current + 1) % states.length));
  }
  show(0);
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
  button.addEventListener("click", () => {
    navigator.clipboard.writeText((code.textContent ?? "").trim()).then(
      () => {
        button.textContent = copied;
        status.textContent = copied;
        clearTimeout(rest);
        rest = window.setTimeout(() => {
          button.textContent = label;
          status.textContent = "";
        }, 2000);
      },
      // Refused (no permission, or the page lost focus): the command is still there to
      // select by hand, and one click on it selects all of it.
      () => {},
    );
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
  for (const box of boxes) {
    if (box.dataset.os !== own) box.hidden = true;
    else {
      const label = box.querySelector<HTMLElement>(".label");
      if (label) label.hidden = true;
    }
  }
}

/** The corner button takes the ground of the world it is over, the night or the page, so
 * its quiet words read on both; and it leads to the stick, so while the stick is on the
 * screen it steps aside. */
function corner(button: HTMLElement, stick: Element | null): void {
  const root = document.documentElement;
  const mark = () => {
    const box = button.getBoundingClientRect();
    const under = document
      .elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      .find((element) => element !== button && !button.contains(element))
      ?.closest(".night, .page");
    // Her screen is the night until its light, the veil, has become the page.
    const veil = under?.querySelector<HTMLElement>("[data-veil]");
    const page = under?.classList.contains("page") || Number(veil?.style.opacity ?? 0) > 0.5;
    root.dataset.under = page ? "page" : "night";
  };
  const queue = perFrame(mark);
  mark();
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);

  if (stick) {
    new IntersectionObserver(([entry]) => {
      root.toggleAttribute("data-at-stick", entry?.isIntersecting ?? false);
    }).observe(stick);
  }
}

const all = (selector: string) => document.querySelectorAll<HTMLElement>(selector);

for (const root of all("[data-film]")) film(root);
for (const section of all("[data-push]")) push(section);
for (const article of all("[data-zuhd]")) zuhd(article);
for (const article of all("[data-written]")) written(article);
for (const text of all("[data-caret]")) caret(text);
for (const section of all("[data-screens]")) screens(section);
for (const box of all("[data-command]")) command(box);
for (const stick of all("#stick")) ownCommand(stick);
for (const button of all(".to-stick")) corner(button, document.querySelector("#stick"));
