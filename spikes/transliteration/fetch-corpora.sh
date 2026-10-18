#!/usr/bin/env bash
# Downloads the corpora used in docs/spikes/transliteration.md into an empty directory
# (outside the repo; they are not committed). Dev-time only: the app itself never fetches.
#   ./fetch-corpora.sh <empty-dir>
#   node harness.ts --corpus gutenberg=<dir>/gutenberg --corpus wikipedia=<dir>/wikipedia
set -euo pipefail
dir=${1:?usage: fetch-corpora.sh <empty-dir>}
mkdir -p "$dir/gutenberg" "$dir/wikipedia"
ua="bismillah-spike/0 (dev-time test corpus)"

# Austen, Melville, Darwin, the Federalist Papers, Montaigne, Gibbon (complete), Joyce.
for id in 1342 2701 1228 1404 3600 25717 4300; do
  curl -sSfL -A "$ua" -o "$dir/gutenberg/pg$id.txt" "https://www.gutenberg.org/cache/epub/$id/pg$id.txt"
done

titles=(
  Ibn_Taymiyya Hadith Sharia Al-Ghazali Hanbali_school "Mu'tazila" "Ash'arism" Quran
  Abbasid_Caliphate Ibn_Khaldun Fiqh Principles_of_Islamic_jurisprudence Sufism Tafsir Kalam
  Ibn_Arabi Abu_Hanifa Malik_ibn_Anas Ahmad_ibn_Hanbal Muhammad_al-Bukhari Sahih_al-Bukhari
  Hanafi_school Maliki_school Ibn_Rushd Al-Tabari Ijma Qiyas Ibn_Qayyim_al-Jawziyya
  Ilm_al-Kalam Maturidism Isnad Shia_Islam Umayyad_Caliphate Rashidun_Caliphate
  Fatimid_Caliphate Ibn_Sina Al-Farabi Uthman
)
for t in "${titles[@]}"; do
  q=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$t")
  curl -sSf -A "$ua" "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=$q" |
    jq -r '.query.pages[].extract // empty' >"$dir/wikipedia/$(tr -c 'A-Za-z0-9_\n-' '_' <<<"$t").txt"
  sleep 1.5 # stay well inside the API's rate limit
done
