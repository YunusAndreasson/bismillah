# Paper and photographing the screen: what they can really do

Current as of 2026-10-31. Evidence labels used throughout:

- **Claimed**: the project or vendor states it, with no test described.
- **Measured (third party)**: a described test by the project or a paper.
- **Measured here**: run on 2026-10-31 on the author's machine, using `tesseract 5.5.3` with `tessdata_best` `ara` and `eng` models, `pango-view`, `qrencode`, `zbarimg`, the repo's fonts in `fonts/source/`, and the repo's texts `docs/specimen.md` and `tests/fixtures/quran/tanzil-uthmani.txt`. Samples are small. These runs are rendered images, not a real camera, printer or scanner. "Light degrade" means simulated: 0.5° rotation, 0.7 px Gaussian blur, slight noise, JPEG at quality 90. The scripts were in the session scratchpad and are not committed.

## Data on paper: capacity, equipment, error recovery, phone cameras

### Takeaway
Pure data pages reach about 200 KB per A4 on a laser printer and a 1200 dpi flatbed, and the evidence is one good test plus author claims. Nothing dense has a documented phone-camera path. QR grids are the only family a phone can plausibly read, and they drop to about 3 KB per page at conservative settings (up to 130 KB claimed). A writer's chapter still fits comfortably on paper, because a page of text is only a few KB.

### Cited Findings

| System | Capacity per A4 | Equipment | Error recovery | Evidence |
|---|---|---|---|---|
| Optar | About 200 KB default; about 50 KB with lowered settings | Laser. Tested on an HP LaserJet 2200dtn with a CanoScan N650U at 1200 dpi | Golay (24,12): fixes 3 bad bits per codeword, with bits spread across 24 strips | Capacity claimed; error statistics measured once |
| PaperBack (Yuschuk) | "Up to 500,000 bytes" uncompressed at 600 dpi laser; "3,000,000+" of C code with packer | Dot density at most half the printer's resolution; scanner at least 900 dpi physical for a 600 dpi printer; grayscale; inkjet limited to about 200 dpi | Reed-Solomon per block, plus redundancy groups (1:5 restores one of each 5 blocks) | Claimed; author gives no test results |
| qr-backup | About 3 KB default; up to 130 KB denser | Webcam or scanner; Linux command line for restore | "Lose up to 30% of pages or QR codes" | Claimed |
| paperbackup (intra2net) | 140 bytes per barcode by design | Printer and scanner; ZBar | QR's own ECC, plus a per-line checksum on the printed plaintext | Measured on survival, not capacity |
| Pawpyrus | About 4.3 "kb" per A4 (unit as written) | QR and ArUco | Not checked | Claimed |
| Ca' Foscari thesis (2024/25) | About 300 KB | "Realistic printing and scanning" | Not read | Abstract snippet only; full page returned 403 |

- Optar's single test: ordinary office paper, folded twice, carried in a pocket, weighted, scanned at 1200 dpi. Result: 132,814 codewords with 0 bad bits, 368 with 1, none with 2 to 4 bad bits. The "once in 105,531 pages" failure figure is extrapolated, not observed. The nominal 600 dpi is not reliable for single dots, so the working limit is 200 dpi (3×3 squares) — [Optar](https://ronja.twibright.com/optar/).
- Optar on cameras: there is no current camera readout, and multi-page camera reading is called not yet possible because a "digital camera blurs at the sides of the picture" — [Optar](https://ronja.twibright.com/optar/). Paper stretch and twist from heated rollers and moisture are handled with calibration targets — [Hackaday](https://hackaday.com/2024/09/15/archiving-data-on-paper-using-2d-images/).
- PaperBack figures and requirements; a 900 dpi A4 grayscale scan needs about 80 MB of memory; the page contains no measured results — [PaperBack](https://ollydbg.de/Paperbak/).
- One hands-on PaperBack review restored a zipped executable from a 600 dpi scan saved as JPEG. It states neither file size, page count nor printer, so it confirms that a round trip works, not the capacity — [Gigazine](https://gigazine.net/gsc_news/en/20120817-paperback).
- qr-backup figures; the README does not mention phones, and states no test results — [qr-backup](https://github.com/za3k/qr-backup).
- paperbackup's survival tests (measured): DataMatrix with libdmtx decoded after 3 print-scan generations, a commercial library after 5; QR with ZBar and the commercial library after 7; a laser-printed QR soaked in dirty water for hours, rinsed and dried, decoded first try. It caps each code at 140 bytes because larger codes are more likely to become unreadable from wrinkles and deformation. Its author chose QR for having several independent decoders — [paperbackup](https://github.com/intra2net/paperbackup).
- Pawpyrus — [Pawpyrus](https://git.disroot.org/spable/pawpyrus). Thesis — [Ca' Foscari](https://unitesi.unive.it/handle/20.500.14247/27031).
- A theoretical 2018 estimate gives about 48 KB per page for standard QR codes — [ITPro Today](https://itprotoday.com/backup/why-your-data-backup-strategy-should-include-paper). This is arithmetic, not a test.
- paperkey is a different kind of tool: it prints only the secret bytes of an OpenPGP key, as base16 with a checksum on each line, for re-entry by hand, OCR or QR. Size falls to about 10% for DSA/Elgamal keys and 50% for RSA. It applies to keys, not documents — [paperkey](https://jabberwocky.com/software/paperkey).
- libcimbar is screen-to-phone, not paper: animated colour tiles shown on a monitor, read by a phone camera. Claimed 850 kbit/s (about 106 KB/s), Reed-Solomon plus fountain codes, files up to 33 MB compressed, decoder app on arm64 Android. Paper isn't mentioned — [libcimbar](https://github.com/sz3/libcimbar).
- Microsoft's HCCB colour barcode was described as decodable in real time on a phone, but this is colour and old — [Microsoft Research](https://www.microsoft.com/en-us/research/?p=169590).

**Measured here, QR capacity** (largest payload `qrencode -8` accepts; Level L at v40 matches the [published 2,953 bytes](https://en.wikipedia.org/wiki/QR_code)):

| Version (modules) | L | M | Q | H |
|---|---|---|---|---|
| v10 (57) | 271 | 213 | 151 | 119 |
| v20 (97) | 858 | 666 | 482 | 382 |
| v25 (117) | 1273 | 997 | 715 | 535 |
| v27 (125) | 1465 | 1125 | 805 | 625 |
| v30 (137) | 1732 | 1370 | 982 | 742 |
| v40 (177) | 2953 | 2331 | 1663 | 1273 |

**Measured here, how big writers' text is.** Uthmani fixture: 16 lines, 2,527 bytes, 150 words, 16.8 bytes per word, deflating to 828 bytes (3.05×). Specimen lines: fully vocalised 17.8 bytes per word (only 4 words), plain Arabic 10.6, IJMES 9.3. Deflate on the repo's English README: 3,086 to 1,670 bytes (1.85×).

### Inferences
- A 300-word vocalised Arabic page is about 5 KB raw and roughly 1.7 KB deflated, if the 3× ratio holds beyond this tiny sample. That fits one v40-L or v40-M QR. A 100,000-word Arabic book at about 17 bytes per word is about 1.7 MB raw and very roughly 560 KB deflated: about 3 Optar pages at the claimed density, or about 190 v40-L codes.
- So capacity is not the bottleneck for this use. **Readback equipment is.** A 1200 dpi flatbed is a heavier demand on the writer than the printer is. For a writer with only a phone, low-density QR is the only family here with a credible path.
- Optar's and PaperBack's density depends on single printed dots surviving, so inkjets and thermal printers should be assumed out. PaperBack's own page says inkjets top out near 200 dpi.

### Gaps
- No independent, repeated measurement of Optar or PaperBack at full density across printers was found. The 200 KB figure rests on one author test; the 500 KB figure on none.
- No measured phone-camera decode rate for a printed page of dense QR codes (v25 to v40) was found. qr-backup's webcam route gives no density limit. **This is the most valuable test to run: real phone, real laser page.**
- JAB Code capacity and phone results were not found. The Ca' Foscari thesis could not be read.

## A page both readable and machine-recoverable

### Takeaway
The concept has solid precedents (Piql film, ICAO digital seals, paperbackup), but no found system does it per page for manuscripts. The geometry is the catch: a QR holding a whole page's compressed bytes is about 47 mm square at conservative print settings, too big to call a margin strip. Dense codes on a facing page or an appendix are more realistic than a code in every footer.

### Cited Findings
- Piql: a visual frame beside a digital frame encoded as a high-resolution QR code; visual storage is opt-in and black and white — [Piql visual storage](https://piql.notion.site/Visual-storage-on-piqlFilm-19772961908f804caaadcd2feffb3e3a).
- Piql writes human-readable documentation on the medium on how to decode the QR and read file formats, and can include render tools and source — [Representation Information](https://piql.notion.site/Representation-Information-Format-Description-20372961908f8003accff0f013209737). The format documentation is always written to the film — [Format Description](https://piql.notion.site/piqlFilm-Format-Description-20372961908f805dbf76d9fa22eeb15d). These are vendor documents; I did not find an independent audit.
- ICAO's Visible Digital Seal is a signed data structure holding document features, as a 2D barcode printed on the document — [Doc 9303 Part 13](https://www.icao.int:443/publications/Documents/9303_p13_cons_en.pdf). It verifies offline, and capacity is "usually limited to a few kByte at most" — [ICAO TRIP presentation](https://www.icao.int:443/Meetings/TRIP-Symposium-2022/Documents/Presentations/Day1/6.RAJESHKUMAR.pdf).
- paperbackup prints the plaintext under the codes with a 6-character MD5-based checksum on every line, so a missing portion can be typed in and verified line by line — [paperbackup](https://github.com/intra2net/paperbackup). This is the closest precedent for a human-repairable page.
- qr-backup embeds restore instructions in the PDF, so it does not need to be installed for restore, though `zbar` and a Linux command line are needed — [qr-backup](https://github.com/za3k/qr-backup).
- paperkey's maintainer advises verifying that you can restore from paper before filing it away — [paperkey](https://jabberwocky.com/software/paperkey).

### Inferences
- Size arithmetic: v40 plus the 4-module quiet zone is 185 modules. At 6 dots per module on a 600 dpi laser (0.254 mm, a conservative choice of mine, not a standard), that is 47 mm square, about 16% of A4's height. v25-Q (715 bytes) is about 32 mm.
- Workable layouts, best first:
  1. **Text pages plus a data appendix.** The manuscript is an ordinary, clean printout; the last sheets carry QR grids of the exact file, with a hash and restore notes. This keeps the page clean, which matters for this product.
  2. **Duplex.** Page text on the front, that page's code on the back.
  3. **Per-page footer code**, only for pages under about 700 bytes compressed, or holding a page hash and document ID rather than the bytes. A hash without the bytes helps only if OCR can reproduce the page, which it can't for vocalised Arabic (next section).
- The readable page is also the human fallback: if a code is destroyed, the writer can retype that part and a line checksum confirms it, as in paperbackup. Vocalised lines remain the hard case for checksums, since a retyped line may use a different but visually identical mark order. Unicode sequence order is invisible on paper, so retyping cannot guarantee exact bytes. The code is the only exact copy.
- Project Silica appears not to apply: it isn't a paper or consumer medium. That is my understanding and was not researched here.

### Gaps
- No precedent was found for a per-page code in a printed manuscript or book holding that page's exact bytes.
- ICAO's MRZ (OCR-B with check digits) is a likely precedent for machine-read print with checks, but it was not confirmed from Doc 9303 Part 3 in this research.
- No source compared PDF417 with QR for this use; the paperbackup README as fetched covers QR and DataMatrix only.

## Photographing the screen and running OCR

### Takeaway
Exact recovery of vocalised Arabic by OCR is not achievable today. The two phone systems writers would reach for don't list Arabic at all. The most careful open-source study puts accuracy on marks at about 80 to 89%, and that is on scans of ordinary print. English prose can come out exact in clean conditions, but IJMES diacritics are destroyed by a standard Tesseract English model. Verification by hash works, but it mostly reports failure.

### Cited Findings

**Phone systems**
- Apple Live Text: the list on Apple's iOS 26 availability page has no Arabic. It has "English (Saudi Arabia)" and "English (United Arab Emirates)", but no Arabic entry (checked in the page source, 2026-10-31) — [Apple](https://www.apple.com/ios/feature-availability/).
- Google ML Kit Text Recognition v2 lists Latin, Chinese, Devanagari, Japanese and Korean; Arabic is not listed — [Google](https://developers.google.com/ml-kit/vision/text-recognition/v2/languages).
- A 2021 article says Google Photos handled Arabic where Live Text did not. It gives no accuracy, and it is old — [iPhoneIslam](https://iphoneislam.com/en/2021/10/substitute-for-live-text-on-unsupported-devices/98800).

**Benchmarks (measured, third party; none tests a photographed screen)**

| Source | Data | Results |
|---|---|---|
| KITAB-Bench (3,760 image-to-text samples) | Mixed Arabic | CER: Gemini-2.0-Flash 0.13, GPT-4o 0.31, Tesseract 0.54, EasyOCR 0.58, PaddleOCR 0.79, Qwen2.5-VL-7B 1.20, Surya 4.95 |
| QARI-OCR paper | Synthetic, diacritic-rich test set | CER/WER: QARI v0.2 0.061/0.160, Mistral OCR 0.210/0.440, Tesseract 0.436/0.889, EasyOCR 0.791/0.918 |
| OpenITI / Kraken (al-Abhath journal scans) | Print, CER reports | Generalised model: total 97.41%, Arabic-script 98.46%, **inherited characters (including vocalisation) 89.44%**. Typeface-specific models: 79.67% and 85.18% on inherited characters |
| Farazi et al., Aug 2026, SARD clean print | Print | CER%: Tesseract 4.7, Qwen 3.8 (2,048 tokens), OCR-conditioned corrector 2.6; Qwen at 512 tokens 36.3 from truncation |

- KITAB-Bench gives no diacritic CER and no exact-match figure; on 104 hand-picked diacritics samples it scores ChrF, with Azure 40.5 and Tesseract 15.3. CER above 1 means the output contains far more errors than the reference has characters — [KITAB-Bench](https://arxiv.org/html/2502.14949v2).
- QARI also lost overall to Mistral on the SARD dataset's five fonts (1,000 images) — [QARI-OCR](https://arxiv.org/pdf/2506.02295).
- Kraken's training data deliberately does not reproduce vocalisation (with one exception), so missing vocalisation counts as correct behaviour under that practice. Fatḥatan is among the top error sources, along with whitespace. A contractor's 10-page check got 93.5% to 99.5% on nine pages and 27% on a 37-character page, and OpenITI found that some counted "errors" were diacritic and numeral conventions — [OpenITI study](https://arxiv.org/pdf/2402.10943).
- Earlier OpenITI work: 97.56% whole text, 99.68% Arabic script alone with punctuation and spacing excluded — [Romanov et al.](https://arxiv.org/pdf/1703.09550).
- Tesseract's low diacritics penalty is misleading: "The low penalty reflects omission of tashkeel, not faithful preservation." On Muharaf (manuscripts), CER with and without diacritics: Tesseract 69.6/69.2, Qwen 86.7/70.4, QARI v0.4 194.7/167.2. Hallucination's share of attributed errors: Tesseract 0.1%, Qwen 15.9%, QARI 62.4%. VLMs attempt tashkeel, but many marks are misplaced — [Farazi et al.](https://arxiv.org/html/2608.22366).
- A Hugging Face Uthmani fine-tune explicitly does not claim exact accuracy, and visible mistakes remained on longer ayahs — [model card](https://huggingface.co/AyoubChLin/unlimited-ocr-quran-uthmani).
- Hegghammer: Document AI best, server processors substantially better than Tesseract, English considerably better than Arabic (100 Arabic scans, 43 noise variants). Exact Arabic figures were not obtained — [Oxford record](https://ora.ox.ac.uk/objects/uuid:0f922084-1e7a-425a-92b0-7cbc7aba7626).

**Quran-specific (self-reported, single source, easy conditions)**
- Mushaf Al-Madinah study: CRR 99%, WRR 95% on 604 pages / 8,927 images — [Academia copy](https://www.academia.edu/61367037/Quranic_Optical_Text_Recognition_Using_Deep_Learning_Models).
- QTID word images: CRR with diacritics 98.90% (CNN), 97.60% (seq2seq). Random split over one font, with no noise or skew assumed, so test words are not independent of training. Tesseract and ABBYY scored 6 to 21% on the same images (table labelling unclear) — [TechScience](https://www.techscience.com/cmc/v68n2/42154/html).

**Screen capture**
- Moiré arises because screen dots are similar in size to the camera's samplers — [arXiv 2111.14075](https://arxiv.org/pdf/2111.14075). I found no accuracy study of photographed screens that is relevant to Arabic. The one screenshot study found used true screenshots: its best character accuracy was about 69% — [Chiatti et al.](https://arxiv.org/pdf/1801.01316).

**Diacritic restoration tools (Mishkal etc.) guess; they do not read**
- Diacritic Error Rates on Tashkeela: Mishkal 13.78%, Shakkala 2.88% — [Fadel et al.](https://arxiv.org/pdf/1905.01965); D3 about 1.5 to 1.8% — [Deep Diacritization](https://arxiv.org/pdf/2011.00538). Settings differ between papers, so these aren't strictly comparable. The newer CATT used other data — [CATT](https://arxiv.org/html/2407.03236v3).

**Measured here (Tesseract `ara`/`eng` best, 300 dpi rendered image, psm 6; not a real camera)**

| Text (font) | Condition | CER | Letters-only CER | Marks kept / reference | Lines exact |
|---|---|---|---|---|---|
| Uthmani, al-Baqara from fixture (Amiri Quran) | Clean | 77.7% | 85.5% | 18/427 | 0/16 |
| Same (Amiri) | Clean | 78.8% | 85.0% | 31/427 | 0/16 |
| Same (IBM Plex Sans Arabic) | Clean | 34.9% | 22.6% | 242/427 | 0/16 |
| Same (IBM Plex Sans Arabic) | Light degrade | 27.3% | 16.6% | 304/427 | 0/16 |
| Specimen Arabic, 4 lines (IBM Plex, Amiri Quran, Amiri) | Clean | 29.7 / 41.7 / 44.9% | 18.4 / 28.5 / 35.7% | 33, 9, 10 of 73 | 0/4 each |
| English, 330 characters (Source Serif) | Clean and light degrade | 0% | n/a | n/a | 5/5, byte exact |
| English, same (iA Writer Mono) | Clean | 0.61% | n/a | n/a | 3/5 |

- Marks kept is a count, not correctness: marks can be present but wrong, so these figures flatter the result.
- The IJMES line through Tesseract `eng`, Source Serif: reference `al-Fātiḥa, Qurʾān, ḥadīth, ʿilm, ṣalāh, ḍalāl, ṭahāra, ẓulm` came back as `al-Fatiha, Qur'an, hadith, 'ilm, salah, dalal, tahara, zulm`. All macrons and underdots were gone. `Āl ʿImrān` became `Al Tmran`.
- Tesseract is the weakest serious recogniser here, used because it runs locally, so this is a floor and says nothing about QARI, Mistral or Kraken. Its poor Amiri scores probably reflect stacked marks and tall lines upsetting its layout analysis (not investigated), and the degraded image beating the clean one for IBM Plex shows how noisy these small samples are. A first, harsher photo simulation gave 83% CER even on English; I discarded it as unrealistic.

### Inferences
- **Why exactness fails, at three levels:**
  1. *Accuracy arithmetic.* If errors were independent, the chance of an exact 3,000-character page is: 99% per character, about 10⁻¹³; 99.68%, about 7×10⁻⁵; 99.99%, about 74%; 99.999%, about 97%. No Arabic result found is near 99.99%, and marks at 89% imply on the order of 100 wrong marks on a page with 1,000 marks.
  2. *The rendered image loses information.* Several distinct codepoint sequences render identically: shadda+fatḥa versus fatḥa+shadda, precomposed versus combining, tatweel variants, Arabic Yeh versus Farsi Yeh in some positions, ʿ versus ‘ in a given font. No recogniser can recover what the picture doesn't hold. **So even a perfect reader cannot promise the writer's bytes**, which is trust rule 3 (AGENTS.md). This follows from Unicode and shaping; it holds for any glyph-based view.
  3. *Models normalise toward their training data*, as Kraken's convention shows, and VLMs hallucinate plausible text. In scripture a plausible error is the worst kind. This was reported on manuscripts, so print rates would be lower but not zero.
- **Policy.** A VLM or OCR model used purely as a reader, whose output is accepted only if a hash matches exactly, seems consistent with ADR-0004. If it doesn't match, nothing is accepted. Diacritic-restoration tools like Mishkal, CATT and Shakkala are a different matter: they insert marks the writer may not have written, so they must not be used for recovery. That needs the author's confirmation, since it is my reading of the ADR.
- **A hash alone only says yes or no**, and for vocalised Arabic it will nearly always say no.
- **Parity to close the gap is theoretically fine and practically dominated.** OCR errors include insertions and deletions, and Reed-Solomon assumes alignment, so plain RS breaks. Document-exchange sketches handle edits at order k·log(n/k) bits for k edits, which is optimal — [Cheng et al.](https://arxiv.org/pdf/1804.05776), [Haeupler](https://arxiv.org/abs/1804.03604). For 3,000 characters at 1% CER (k=30), that is on the order of 200 bits times a real-world constant, so perhaps 100 to 300 bytes. That is my estimate, not a measurement. But:
  - that parity needs a lossless channel of its own, in practice a QR code;
  - a real recogniser's CER on marks is around 10% or more, which pushes the sketch toward the size of the compressed page itself (about 1.7 KB);
  - that same QR area could carry the whole page. v27-M holds 1,125 bytes and v40-L 2,953.
  - **Therefore: if the screen can show a code, show the data, not the parity.** OCR-plus-parity would still need a custom decoder on the receiving side, so it saves nothing there either.
- **Where OCR is still useful:** as a convenience for plain English, labelled as unverified, or as a search index on the receiving side. It should not be a route to the writer's exact text.

### Gaps
- **No benchmark was found of phone OCR on photographed screens for vocalised Arabic or Quran text.** A real test with the writer's phone and panel would settle it cheaply.
- Apple's Vision API may support languages that Live Text doesn't list; only an on-device call to `supportedRecognitionLanguages()` can confirm this — [Apple](https://developer.apple.com/documentation/vision/vnrecognizetextrequest/supportedrecognitionlanguages().md). Google Lens's consumer Arabic quality: no measured data.
- Surya: no diacritic figures or current language list beyond KITAB-Bench's CER. QARI's own test-set size was not extracted. Hegghammer's Arabic figures were not obtained.
- Kraken with a model trained to keep vocalisation on a known font might do far better; OpenITI says the practice can be changed. No such published figure was found for Uthmani.
- `tessdata_best` was the default model; Tesseract's Latin script model might keep IJMES marks. Not tested.

## Machine-optimised views and hand-transcribable check characters

### Takeaway
Showing bytes as restricted-alphabet text works far better than OCRing Arabic: 0.3 to 0.5% errors in clean tests here. But it isn't lossless without error correction, and a QR code of the same bytes beat it outright, decoding exactly in every test. Base32 is suitable for short check strings and a last-resort fallback, not for carrying documents by photo.

### Cited Findings
- Crockford Base32 excludes confusable symbols and treats look-alikes as equivalent (I/L to 1, O to 0). Its claim of reduced transcription errors is a design claim, not a measurement; the IETF document is an unapproved Internet-Draft — [IETF draft](https://datatracker.ietf.org/doc/html/draft-crockford-davis-base32-for-humans-01).

**Measured here, encoded text.** About 1,950 bytes of the Arabic fixture's UTF-8 as 3,117 Crockford characters in groups of five, 78 lines (3,740 characters counting spaces, which the error rates include); Tesseract `eng` on a 300 dpi render:

| Font | Size | Condition | Whitelist off | Whitelist on (alphabet only) | Lines exact (whitelist) |
|---|---|---|---|---|---|
| iA Writer Mono | 14 pt | Clean | 1.71% | 0.29% | 67/78 |
| iA Writer Mono | 14 pt | Light degrade | 1.42% | 0.35% | 65/78 |
| iA Writer Mono | 10 pt | Light degrade | 1.23% | 0.48% | 62/78 |
| Source Serif | 14 pt | Clean | 2.35% | 0.83% | 55/78 |
| Source Serif | 14 pt | Light degrade | 1.68% | 0.37% | 64/78 |

- Hex in iA Writer Mono with a whitelist: 0.70% clean, 0.65% degraded, 41/50 and 39/50 lines exact.
- None of these was byte-exact.

**Measured here, QR through the same degrade** (`zbarimg --raw -Sbinary`; byte-for-byte comparison of Arabic UTF-8):

| Code | Payload | Pixels per module | Width | Clean | Light degrade |
|---|---|---|---|---|---|
| v40-L | 2,953 B | 3 | 555 px | Exact | Exact |
| v40-L | 2,953 B | 2 | 370 px | Exact | Exact |
| v40-M | 2,331 B | 3 | 555 px | Exact | Exact |
| v27-M | 1,125 B | 2 | 266 px | Exact | Exact |
| v20-M | 666 B | 2 | 210 px | Exact | Exact |

- Note that ZBar needs binary mode for this; its default handling of QR text may alter bytes. These are simulated images, not camera shots; a real camera on a real panel will be harder.

### Inferences
- Base32 at about 0.35% errors on 3,740 characters is about 13 errors per 2,000 payload bytes. With line-level checksums and Reed-Solomon across lines it could become exact, and unlike OCR on Arabic this is a real path. But the result needs a custom decoder, the same as QR, while QR already includes the ECC and many independent decoders exist. Base32's one benefit is that a person can read and type it.
- A codepoint grid (each codepoint in its own cell, shown as a fixed glyph) would remove shaping and mark stacking, so in principle it solves the hidden-sequence problem as well. In effect it is a large custom alphabet; base32 is the simple version of the same idea. No precedent or font was found. Fonts designed for lossless OCR: nothing usable found beyond the general OCR-A/OCR-B family, and I found no measured data on them for this use.
- Typing by hand: a 1.7 KB compressed page is about 2,700 Base32 characters. Realistic for a rescue of one short page, not for a chapter. Compressed data also means one wrong character destroys everything after it, unless blocks are independently checked. Hand transcription should be for hashes, plus uncompressed line-checked text at most.

### Gaps
- No empirical human transcription error rate for Crockford Base32 was found. Phone-camera OCR on Base32 was not tested. OCR-A/OCR-B fonts were not available in this test. A trained single-font recogniser could reach much lower error rates; no figure found.

## Human-checkable integrity: check words

### Takeaway
For accidental corruption, which is the actual risk here, 4 to 6 BIP-39 words (44 to 66 bits) or 16 hex characters (64 bits) is sufficient. Human comparison is highly reliable in this case because a corrupted file changes the whole check string. Hex has one practical edge: it can be checked with `sha256sum` on any computer, with no word list.

### Cited Findings
- BIP-39: 2,048 words, 11 bits each, from which its own checksum is derived from SHA-256 — [BIP-39](https://bitcoin.org/bip/39/).
- PGP word list: two 256-word lists, 8 bits per word, alternating two- and three-syllable words by byte position, which detects transposed, duplicated and omitted words. Designed by Juola and Zimmermann in 1995; Callas refined it — [Wikipedia](https://en.wikipedia.org/wiki/PGP_word_list). Some developer guides wrongly describe it as a 2,048-word list, e.g. [ssojet](https://ssojet.com/binary-encoding-decoding/pgp-word-list-in-nodejs).
- Dechand et al. (USENIX Security 2016), 1,047 MTurk participants, 112-bit fingerprints, attacker controlling up to 80 bits so that the strings look nearly alike: hex left 10.1% of attacks undetected. Numeric detected 93.57%; generated sentences detected 97.97%, the best. Word-based and sentence-based formats beat hex — [Dechand et al.](https://ibr.cs.tu-bs.de/papers/schuermann-usenix2016.pdf); [abstract](https://usenix.org/conference/usenixsecurity16/technical-sessions/presentation/dechand).
- From that paper's Table 3, deriving from its printed deltas, approximate undetected rate and mean comparison time: Peerio words 5.75%, 8.7 s; numeric about 6.3%, 10.6 s; Base32 about 8.5%, 10.2 s; PGP words about 8.8%, 13.0 s; hex about 10.4%, 11.2 s; sentences 2.99%, 12.3 s. Table and prose differ slightly (sentences 2.99% against 2.03% implied by the text; hex 10.4% against 10.1%). Use these as a ranking, not as exact figures.
- Chunking hex differently played only a minor role in detection — [same paper](https://ibr.cs.tu-bs.de/papers/schuermann-usenix2016.pdf).

### Inferences

| Form | Bits | Length | Chance a random corruption passes |
|---|---|---|---|
| BIP-39 words | 44 | 4 words | 5.7×10⁻¹⁴ |
| BIP-39 words | 66 | 6 words | 1.4×10⁻²⁰ |
| PGP words | 64 | 8 words | 5.4×10⁻²⁰ |
| Hex | 64 | 16 characters | 5.4×10⁻²⁰ |
| Crockford Base32 | 65 | 13 characters | 2.7×10⁻²⁰ |

- Dechand's miss rates concern a hostile attacker crafting near-matches. Accidental corruption yields a completely different check string, so a person comparing even the first and last words would catch it. These miss rates overstate the risk for this use. If the writer later needs protection against a deliberate forger, the check has to be full-length SHA-256 or a signature, carried in a code.
- Suggestion: on-screen and in print, show 6 words **and** the same check as 16 hex characters. Words are for a person comparing; hex lets any machine verify without bismillah's tools. A check string only verifies bytes; it depends on the receiving side being able to compute it, which is a tool requirement. Hash the exact file bytes, and say so, so that a recipient doesn't hash a re-saved or normalised copy.
- English BIP-39 suits an English UI; the list has other languages but this was not examined. Word pairs like Arabic-script check words were not researched.

### Gaps
- No study found on human comparison of check words on paper against a screen, for writers rather than MTurk participants, nor one for this accidental-corruption case.

## Thermal receipt printers and small USB printers

### Takeaway
A receipt printer can render Arabic with marks if the appliance sends a bitmap, and at 14 pt or more on 203 dpi it looks usable in simulation. But standard thermal paper is a poor home for a manuscript: it fades within months to a couple of years by vendors' own account, and a QR code at that resolution failed one crude simulation. It's fine as a temporary handover copy, not as an archive. A laser printer is the better physical output.

### Cited Findings
- Fading: standard thermal paper "often holds readable text for six months to two years under controlled storage" — [POSPaper](https://www.pospaper.com/blogs/news/does-thermal-paper-fade). All vendor sources, none independently tested.
- Premium papers: Zebra Z-Perform 1000D "up to ten years", expected but not warranted, under stated archive conditions, and rated for up to one year indoors — [Zebra spec sheet](https://www.zebra.com/content/dam/zebra_dam/en_gb/spec-sheets/z-perform-1000d-60-specification-sheet-en-gb.pdf). Z-Select 4000D, 25 years claimed — [Atlas RFID](https://www.atlasrfidstore.com/zebra-2-x-81-25-z-select-4000d-3-2-mil-receipt-paper-25-year-archivability-for-mobile-printers-case-of-36-rolls/). Blue4est, at least 35 years claimed, under proper storage — [Bonrollen](https://bonrollen-service.de/en-eu/blogs/faq/wie-lange-sind-belege-aus-thermopapier-lesbar).
- Paper width: 58 mm is 384 dots and 80 mm is 576 dots, at a typical 203 dpi — [thermal_unicode_print](https://pub.dev/packages/thermal_unicode_print). Some Bixolon models are 180 dpi — [Levata](https://www.levata.com/bixolon-srp-350plusii-receipt-printer).
- Arabic must travel as a bitmap, since the printer can't shape it — [thermal_unicode_print](https://pub.dev/packages/thermal_unicode_print). Printer code pages such as Windows-1256 exist but support varies, and they can't be relied on for vocalised or Uthmani text — [esc_pos_utils](https://pub-web-s2.flutter-io.cn/packages/esc_pos_utils/versions/0.3.4). Raster commands `GS v 0` (listed as obsolete) and `GS ( L` exist, with support varying by model — [ESC/POS docs](https://escpos.readthedocs.io/).
- Linux path: Epson publishes CUPS driver source for its receipt printers — [Epson](https://download3.ebz.epson.net/dsc/f/03/00/16/58/61/7c3b5632617c4aa212be830319801ecf242e73cb/ov_tmx-cups-src-ImpactReceipt-3.0.0.0_e.pdf). `ipp-usb` gives driverless printing for most modern USB multi-function devices and a few USB-only ones, and may not cover receipt printers — [ipp-usb](https://snapcraft.io/ipp-usb). Raw ESC/POS over USB is the common fallback — [escpos-php](https://github.com/f/escpos-php).

**Measured here (simulation only: pango to 1-bit at 203 dpi, inspected by eye)**
- Amiri at 10, 14 and 18 pt: harakat, shadda and IJMES underdots remain distinct at 14 and 18 pt. At 10 pt marks are readable but cramped, with little separation for stacked marks. Long lines wrap at 384 dots. The Uthmani waqf sign U+06DB did not appear visibly in this render, only a gap; this needs checking in the real editor pipeline before trusting bitmap output of that text.
- v25-M (997 bytes) at 3 dots per module fits 58 mm: 375 of 384 dots. Thresholded cleanly, ZBar read it exact. After a mild blur and re-threshold, a crude stand-in for dot spread, **it failed to decode**. No real thermal print was tested.

### Inferences
- Size on 58 mm paper at 3 dots per module: v25 (M 997 B). On 80 mm: v40 (185 × 3 = 555 of 576 dots, M 2,331 B). The failed simulation suggests allowing 4 or more dots per module, which on 58 mm means about v17 and on 80 mm about v29, allowing for the quiet zone. A long roll can still carry a whole chapter in a row of codes; capacity isn't the issue.
- Fading is the reason not to archive here. It's a poor match for the product's promise on a manuscript, and marks fade or vanish before bold strokes do, which is the failure writers would least notice. That last point is my reasoning, not from a source.
- Any printer path means USB device handling plus print stack (CUPS or raw ESC/POS) on an appliance whose attack surface and image size are carefully kept small. Raw raster to one narrow class of printers would be the smaller addition; a real print stack is heavier. Size and allowlist cost is for the OS team to measure. Whether a printer fits the stick's design and ADRs was not checked here.
- Rendering in the appliance (WebKit or Pango to bitmap) means exactly the screen's typography goes to paper, including correct vocalised Arabic, with no dependency on printer fonts.

### Gaps
- No independent, measured fade data for thermal paper with fine Arabic marks. No real thermal print of QR or Arabic was tested; a cheap printer and a phone would answer it in an hour.
- USB-only small inkjet and laser printer support on Linux without CUPS was not researched in depth. No specific printer can be recommended from this work.
- Hand-held "mini" thermal printers with USB were not checked; many appear to be Bluetooth-only, which the appliance doesn't have, but I found no source to confirm that.
