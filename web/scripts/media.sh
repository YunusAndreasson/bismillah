#!/usr/bin/env bash
# Encode the film and the tower loops for the site. Run by hand when the film or a
# loop changes; the output is committed (public/media/, src/assets/stills/).
#
#   scripts/media.sh film [cut]   # the film, from the director project's master (default cut-v35)
#   scripts/media.sh loops        # the two tower loops in media/, and their first frames
#
# DRY=12 encodes only the first 12 seconds into $TMPDIR, to check the settings first.
#
# Why these formats: Workers static assets ignore Range and always answer 200 with the
# whole file, and Safari won't play an MP4 without byte ranges. HLS splits a film into
# small whole files, so Safari and Chrome (142+) play it natively, with no script.
# Firefox and Zen have no native HLS, so they take the next <source>: one progressive
# AV1 file, kept under 24 MiB because no asset may exceed 25 MiB.
set -euo pipefail
cd "$(dirname "$0")/.."

what="${1:?usage: media.sh film [cut] | loops}"
dry="${DRY:-}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# H.264 for HLS: closed 4 s GOPs at 24 fps so every rendition's segments align. Capped
# rates keep the whole film near 100 MB; the dark scenes need far less than the cap.
x264=(-c:v libx264 -preset slower -tune film -x264-params aq-mode=3 -profile:v high -pix_fmt yuv420p
  -color_primaries bt709 -color_trc bt709 -colorspace bt709)

film() {
  local cut="${1:-cut-v35}"
  local src="$HOME/Work/director/productions/bismillah/renders/$cut.mp4"
  local out="public/media/film/$cut"
  local trim=()
  if [[ -n "$dry" ]]; then
    out="${TMPDIR:-/tmp}/bismillah-media-dry/film/$cut"
    trim=(-t "$dry")
  fi
  rm -rf "$out" && mkdir -p "$out/hls"

  # HLS: 1080p, 720p and 540p, fMP4 segments, one AAC track per rendition.
  ffmpeg -hide_banner -loglevel warning -stats "${trim[@]}" -i "$src" \
    -filter_complex "[0:v]split=3[a][b][c];[b]scale=1280:720:flags=lanczos[b2];[c]scale=960:540:flags=lanczos[c2]" \
    -map "[a]" -map "[b2]" -map "[c2]" -map 0:a -map 0:a -map 0:a \
    "${x264[@]}" -g 96 -keyint_min 96 -sc_threshold 0 -flags +cgop \
    -crf:v:0 21 -maxrate:v:0 3500k -bufsize:v:0 7000k -level:v:0 4.0 \
    -crf:v:1 22 -maxrate:v:1 1800k -bufsize:v:1 3600k -level:v:1 3.1 \
    -crf:v:2 23 -maxrate:v:2 900k -bufsize:v:2 1800k -level:v:2 3.1 \
    -c:a aac -b:a 128k -ac 2 -ar 48000 \
    -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments \
    -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$out/hls/%v/%03d.m4s" \
    -master_pl_name master.m3u8 \
    -var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:540p" "$out/hls/%v/index.m3u8"

  # AV1 for Firefox and Zen: 10-bit, film grain synthesised rather than spent on bits,
  # two-pass at 1.3 Mb/s with Opus 112k, so the file stays under 24 MiB.
  local pass
  for pass in 1 2; do
    ffmpeg -hide_banner -loglevel error "${trim[@]}" -i "$src" -map 0:v -pix_fmt yuv420p10le \
      -strict -1 -f yuv4mpegpipe - |
      SvtAv1EncApp --progress 0 -i stdin --pass "$pass" --stats "$work/av1.stats" --rc 1 --tbr 1300 \
        --preset 4 --tune 0 --keyint 240 --film-grain 10 --film-grain-denoise 1 \
        --enable-variance-boost 1 --color-primaries 1 --transfer-characteristics 1 \
        --matrix-coefficients 1 -b "$work/film.ivf"
  done
  ffmpeg -hide_banner -loglevel error "${trim[@]}" -i "$work/film.ivf" -i "$src" -map 0:v -map 1:a \
    -c:v copy -c:a libopus -b:a 112k -shortest -movflags +faststart "$out/film-av1.mp4"

  ls -l "$out/film-av1.mp4"
  du -sh "$out/hls"
}

loops() {
  local name out
  # The dawn loop is no longer on the page (2026-10-29: the notebook closes it).
  for name in night; do
    local src="media/loop-tower-$name.mp4"
    out="public/media/loops/v1/$name"
    rm -rf "$out" && mkdir -p "$out"
    # HLS, one segment: the source's own H.264, tagged BT.709.
    ffmpeg -hide_banner -loglevel error -i "$src" -map 0:v -c:v copy \
      -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1 \
      -f hls -hls_time 10 -hls_playlist_type vod -hls_segment_type fmp4 \
      -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$out/%03d.m4s" "$out/index.m3u8"
    ffmpeg -hide_banner -loglevel error -i "$src" -map 0:v -c:v copy \
      -bsf:v h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1 \
      -movflags +faststart "$out/h264.mp4"
    ffmpeg -hide_banner -loglevel error -i "$src" -map 0:v -pix_fmt yuv420p10le -c:v libsvtav1 \
      -preset 4 -crf 30 -svtav1-params tune=0:film-grain=8 \
      -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart "$out/av1.mp4"
    # The first frame is the poster, so nothing changes when the loop starts.
    ffmpeg -hide_banner -loglevel error -y -i "$src" -frames:v 1 -q:v 2 "src/assets/stills/loop-$name.jpg"
    ls -l "$out"
  done
}

case "$what" in
  film) film "${2:-}" ;;
  loops) loops ;;
  *) echo "usage: media.sh film [cut] | loops" >&2 && exit 2 ;;
esac
