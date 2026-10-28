/** systemd-analyze's kernel and initrd times, in seconds to switch-root. */
export function switchRootSeconds(line: string): number {
  const stages: Record<string, number> = {};
  for (const m of line.matchAll(/((?:\d+(?:\.\d+)?(?:h|min|ms|s)\s*)+)\((\w+)\)/g)) {
    let seconds = 0;
    for (const duration of (m[1] ?? "").matchAll(/(\d+(?:\.\d+)?)(h|min|ms|s)/g)) {
      const scale =
        duration[2] === "h" ? 3600 : duration[2] === "min" ? 60 : duration[2] === "ms" ? 0.001 : 1;
      seconds += Number(duration[1]) * scale;
    }
    stages[m[2] ?? ""] = seconds;
  }
  const kernel = stages["kernel"];
  const initrd = stages["initrd"];
  if (kernel === undefined || initrd === undefined || !Number.isFinite(kernel + initrd))
    throw new Error("systemd-analyze did not report valid kernel and initrd timings");
  return kernel + initrd;
}
