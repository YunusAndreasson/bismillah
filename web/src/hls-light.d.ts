// hls.js ships types for its full build only; the light build (site.ts) has the same API
// without subtitles, alternate audio or DRM, none of which the film uses.
declare module "hls.js/light" {
  export * from "hls.js";
  export { default } from "hls.js";
}
