// The site's one script. Everything reads and plays without it: the film has the
// browser's own controls, her screen is a still, the page is all in ink, and the stick's
// command is selected with one click. With it, the film gets the quiet player, the
// camera pushes into her screen, Zuhd mode follows the reader, the caret and the dawn
// wake when they come into view, and the command has a copy button.

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 0:42, the player's time. */
const clock = (seconds: number) => {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

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
  if (!video || !controls || !hit || !play || !now || !total || !position) return;
  if (!mute || !full) return;

  video.controls = false;
  controls.hidden = false;
  hit.hidden = false;
  root.toggleAttribute("data-ready", true);

  const state = (name: "idle" | "playing" | "paused" | "ended") => {
    root.setAttribute("data-state", name);
    const label = play.getAttribute(name === "playing" ? "data-label-pause" : "data-label-play");
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
      if (
        root.getAttribute("data-state") === "playing" &&
        !controls.contains(document.activeElement)
      ) {
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
    const label = mute.getAttribute(video.muted ? "data-label-unmute" : "data-label-mute");
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

  let queued = false;
  const update = () => {
    queued = false;
    const box = section.getBoundingClientRect();
    const travel = box.height - window.innerHeight;
    const p = travel > 0 ? clamp(-box.top / travel, 0, 1) : 0;
    const e = p * p * (3 - 2 * p);
    camera.style.transform = `translate(${move.x * e}px, ${move.y * e}px) scale(${1 + (move.scale - 1) * e})`;
    light.style.opacity = String(clamp((p - 0.5) / 0.35, 0, 1));
    veil.style.opacity = String(clamp((p - 0.85) / 0.15, 0, 1));
  };
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };

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
  const blocks = Array.from(article.querySelectorAll<HTMLElement>(".text > *"));
  const first = blocks[0];
  if (!first) return;
  let current = first;
  current.classList.add("current");
  article.toggleAttribute("data-zuhd-on", true);

  // The typewriter line: 42% from the top, where the editor keeps the caret.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.target === current) continue;
        current.classList.remove("current");
        current = entry.target as HTMLElement;
        current.classList.add("current");
      }
    },
    { rootMargin: "-42% 0px -57% 0px" },
  );
  for (const block of blocks) observer.observe(block);
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

for (const root of document.querySelectorAll<HTMLElement>("[data-film]")) film(root);
for (const section of document.querySelectorAll<HTMLElement>("[data-push]")) push(section);
for (const article of document.querySelectorAll<HTMLElement>("[data-zuhd]")) zuhd(article);
for (const box of document.querySelectorAll<HTMLElement>("[data-command]")) command(box);

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

// Only this computer's command and where to paste it, without the label that tells the
// commands apart. Without the script, or on a computer that can't make a stick, both
// stay.
const own = computer();
if (own && document.querySelector(`#stick [data-os="${own}"]`)) {
  for (const box of document.querySelectorAll<HTMLElement>("#stick [data-os]")) {
    if (box.dataset.os === own) {
      const label = box.querySelector<HTMLElement>(".label");
      if (label) label.hidden = true;
    } else box.hidden = true;
  }
}
for (const article of document.querySelectorAll<HTMLElement>("[data-caret]")) {
  const last = article.querySelector(".text > :last-child");
  if (last) onceInView(last, () => article.toggleAttribute("data-awake", true));
}
for (const video of document.querySelectorAll<HTMLVideoElement>("[data-dawn]")) {
  if (!reduceMotion.matches) onceInView(video, () => void video.play().catch(() => {}));
}

// The editor's screens on her laptop: one at a time, changed by the four words under
// it, or by a click on the screen itself, which shows the next. Nothing changes on
// its own.
const screens = document.querySelector<HTMLElement>("[data-screens]");
if (screens) {
  const states = [...screens.querySelectorAll<HTMLElement>("[data-state]")];
  const words = screens.querySelector<HTMLElement>("[data-words]");
  const buttons = [...screens.querySelectorAll<HTMLButtonElement>("[data-show]")];
  let current = 0;
  const show = (next: number): void => {
    current = next;
    states.forEach((state, i) => {
      state.toggleAttribute("data-current", i === next);
      state.setAttribute("aria-hidden", String(i !== next));
    });
    buttons.forEach((button, i) => {
      button.setAttribute("aria-pressed", String(i === next));
    });
  };
  if (words && states.length > 1) {
    screens.dataset["live"] = "";
    words.hidden = false;
    buttons.forEach((button, i) => {
      button.addEventListener("click", () => show(i));
    });
    for (const state of states)
      state
        .querySelector("img")
        ?.addEventListener("click", () => show((current + 1) % states.length));
    show(0);
  }
}

// The corner button leads to the stick; while the stick is on the screen it steps aside.
const stick = document.querySelector("#stick");
if (stick)
  new IntersectionObserver(([entry]) => {
    document.documentElement.toggleAttribute("data-at-stick", entry?.isIntersecting ?? false);
  }).observe(stick);
