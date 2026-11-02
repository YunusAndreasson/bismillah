# Optical screen-to-camera channels beyond ordinary animated QR

Current as of 2026-10-31. Labels used throughout: **[M]** measured by the authors of the system, **[C]** claimed or reported without a usable method or run record, **[E]** my estimate or arithmetic. I found no independent replication of any figure, so even [M] means self-reported. The baseline is the brief's own plan: BC-UR fountain QR, about 570 bytes per frame, an estimated 1 to 3 KB/s.

Sources I could not open in full, so their figures come from search-result extracts only: the HiLight paper (403), the COBRA paper (403), Tom's Hardware, Better Stack, noqta.tn, the ALS paper at EUDL (403), and cimbar.org itself (403). These are marked "(extract)".

## What beats 1 to 3 KB/s, and on what evidence?

### Takeaway
Two visible codes beat the plan by 10x or more: cimbar (about 106 KB/s, measured on a low-end phone) and fast fountain QR such as Decimen (418.5 KB/s sustained in one record run on extreme hardware). The biggest surprise is that plain QR is not the limit. The 1 to 3 KB/s estimate is low mainly because of its frame rate and payload, not because QR cannot go faster.

### Cited Findings

| System | Goodput | Conditions | Status | Usable today? |
|---|---|---|---|---|
| Decimen v0.4.0, desktop to phone | 418.5 KB/s sustained, 601.5 KB/s peak; 1.0 MB in 2.5 s | 4 codes, Odyssey G9 49-inch to iPhone 17 Pro Max, 60 fps camera at 960×1280, block 2933 — [wiki](https://github.com/bashalarmistalt/decimen-optical-transfer/wiki), [run record](https://github.com/bashalarmistalt/decimen-optical-transfer/blob/main/benchmarks/runs/2026-08-09T04-12-41-run.json) | [M] one record run | Yes, browser receiver |
| Decimen v0.4.0, phone to phone | 199.2 KB/s sustained, 340.8 KB/s peak | 2 codes, iPhone 17 Pro Max to same — [wiki](https://github.com/bashalarmistalt/decimen-optical-transfer/wiki) | [M] one record run | Yes |
| RaptorQR | 180 to 254 KB/s | 4 QR codes, 30 fps, iPhone 16, controlled lighting — [noqta.tn](https://noqta.tn/en/blog/animated-qr-code-file-transfer-fountain-codes-airgap-2026) (extract) | [C] secondary | Not checked |
| libcimbar mode B | 106 KB/s (852 kbit/s), after zstd | 4,689,084 bytes in 44 s, cimbar.org sender, cfc on Snapdragon 625 with 4 threads — [PERFORMANCE.md](https://raw.githubusercontent.com/sz3/libcimbar/master/PERFORMANCE.md) | [M] monitor not named | Yes on Android |
| cimbar WeChat receiver on iPhone | 86.4 KiB/s effective; about 50 KB/s on Android | Mode B from cimbar.org, on-device WASM — [issue #189](https://github.com/sz3/libcimbar/issues/189) | [C] third party | WeChat only |
| RDCode | 17.0 KB/s file goodput (21.8 KB/s max) from 324 kbps raw | 10 fps, Nexus 4 / Galaxy S3 at 720p30, about 21 cm, still devices, 1 to 100 lx — [paper](http://anranw.me/papers/rdcode.pdf) | [M] | No app found |
| ChromaCode (hidden) | 15 KB/s (120 kbps goodput), BER 0.05, from 777 kbps raw | 120 Hz 27-inch at 1080p, GTX 745, Nexus 6P, 50 cm — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf) | [M] | Code on request only |
| InFrame++ (hidden) | About 9 to 11 KB/s (70 to 85 kbps after error handling) from about 200 kbps raw | 120 Hz Eizo FG2421 24-inch at 1080p, S5/Note 3/Lumia 1020 at 1080p30, 60 cm, brightness 100% — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobisys15-inframe++.pdf) | [M] | No |
| TXQR | About 9 KB/s peak | [noqta.tn](https://noqta.tn/en/blog/animated-qr-code-file-transfer-fountain-codes-airgap-2026) (extract), could not verify against the original project | [C] secondary | Library exists |
| COBRA | 2.1 to 3.0 KB/s file goodput from 84 to 120 kbps raw | Measured by the RDCode authors using COBRA's own code, phone to phone — [RDCode Table 2](http://anranw.me/papers/rdcode.pdf) | [M] by a competitor | No |

- Decimen's run used 1,048,647 bytes with K=358, 1.2 total overhead, catch rate 0.742 and a verified SHA-256 — [run record](https://github.com/bashalarmistalt/decimen-optical-transfer/blob/main/benchmarks/runs/2026-08-09T04-12-41-run.json).
- Decimen's table is titled by "record" runs, with one run per device pair — [wiki](https://github.com/bashalarmistalt/decimen-optical-transfer/wiki).

### Inferences
- [E] 1 to 3 KB/s at 570 bytes per frame implies only about 2 to 5 useful frames per second. A conservative Decimen setting on a 60 Hz laptop (1,465 bytes × 24 fps, one code) has a ceiling of 35 KB/s, or about 26 KB/s at Decimen's 0.742 catch rate. That is unmeasured on a laptop, but it suggests about 10x is available without changing barcode family.
- [E] Decimen's 418.5 KB/s is 59% of its arithmetic ceiling (2933 × 4 × 60 = 704 KB/s). It should not be read as a laptop number: the 32:9 panel suits four side-by-side codes in a way a 16:9 13-inch panel does not.
- Raw and goodput differ by a large factor. RDCode loses about 2.4x, ChromaCode about 6.5x, and COBRA about 3.5x to 7x. Any paper quoting only raw kbps should be discounted accordingly.
- For scale [E]: a 200 KB document takes 67 to 200 s on the plan, about 2 s at cimbar's published rate before any compression gain, and about 8 s at the 26 KB/s QR estimate.

### Gaps
- I found no measurement of any of these on an ordinary 13 to 15-inch 60 Hz laptop panel. This is the largest gap, and it needs a bench test on the stick.
- No controlled side-by-side of cimbar and fast QR on the same screen and phone exists that I could find.

## libcimbar / cimbar and cfc: throughput, mechanism, licence, receivers, current state

### Takeaway
cimbar is the most mature candidate: actively maintained in October 2026, MPL-2.0, and about 106 KB/s on a Snapdragon 625. Android is well served (cfc on F-Droid and Play). iPhone is the weak side: a beta web decoder and third-party receivers, with no App Store app that I could confirm.

### Cited Findings
**How it works**
- Data sits in a grid of coloured tiles, with bits carried by tile shape and colour. Reed-Solomon corrects the sub-1% expected error rate, and wirehair fountain codes plus zstd carry files up to 33 MB after compression — [README](https://github.com/sz3/libcimbar).
- Frame is 1024×1024 pixels with 8×8 tiles on a 9×9 grid. Each tile has 4 symbol bits plus 2 colour bits, giving 9,300 bytes per frame, or 7,500 bytes of data with ECC 30/155 — [PERFORMANCE.md](https://raw.githubusercontent.com/sz3/libcimbar/master/PERFORMANCE.md), [DETAILS.md](https://raw.githubusercontent.com/sz3/libcimbar/master/DETAILS.md).
- Fountain coding adds 6 bytes per 744 bytes of data, and the cap of 33.55 MB must also fit in RAM — [DETAILS.md](https://raw.githubusercontent.com/sz3/libcimbar/master/DETAILS.md).
- The documentation says the camera is usually the bottleneck, not the decoder, and resolution can go "as low as 700x700" though performance may suffer — [PERFORMANCE.md](https://raw.githubusercontent.com/sz3/libcimbar/master/PERFORMANCE.md).

**Throughput by mode**
- [M] Mode B 852 kbit/s; legacy 4C 838 kbit/s; 8C 943 kbit/s (removed in 0.6.0). All measured after compression, so a compressible text moves faster in source bytes — [PERFORMANCE.md](https://raw.githubusercontent.com/sz3/libcimbar/master/PERFORMANCE.md).
- [C] Beta mode S (5×5 tiles): "safely >1 Mbit/s", not finalised — [PERFORMANCE.md](https://raw.githubusercontent.com/sz3/libcimbar/master/PERFORMANCE.md).
- [C] Mode Bm is about 70% of B's capacity, for "a broader variety of cameras/devices". Mode Bu is about 43% of B's performance and prioritises compatibility — [releases](https://github.com/sz3/libcimbar/releases).
- [C] Web decoder on iPhone in 2024-era v0.6.2c: "about 80 kb/s" — [releases](https://github.com/sz3/libcimbar/releases). The unit is ambiguous, and the release page shows no year (the year is my inference from a search extract).
- [C] Third-party decoder guidance: tens of KB in a dozen-plus seconds at 1080p and 15 fps, far below the headline — [cimbar-decoder](https://github.com/doublej9999/cimbar-decoder).

**Licence**
- libcimbar is MPL-2.0 — [README](https://github.com/sz3/libcimbar). cfc is MIT, with dependencies under MIT, BSD, zlib, Boost and Apache — [cfc](https://github.com/sz3/cfc).
- For comparison, Decimen is AGPL-3.0-or-later from v0.4.0, and releases up to v0.3.0 stay MIT — [wiki](https://github.com/bashalarmistalt/decimen-optical-transfer/wiki).

**Receivers**
- Android: cfc is on F-Droid and Google Play, and only arm64-v8a is officially supported — [cfc](https://github.com/sz3/cfc). F-Droid's latest is 0.6.4f, added 2026-03-25, Android 5.0+, camera permission — [F-Droid](https://f-droid.org/packages/org.cimbar.camerafilecopy/). The author calls it a demo/test app — [cfc](https://github.com/sz3/cfc).
- Android, second app: CimBar Scanner (mezinster/cimbar) on F-Droid can scan live, photograph a single-frame code, or import a GIF, and requests only the camera — [F-Droid](https://f-droid.org/ko/packages/com.nfcarchiver.cimbar/) (extract).
- iOS native: Lumen is an iPhone/iPad receiver on libcimbar, but it builds with Xcode only, its own code is all rights reserved, and it had 0 stars — [Lumen](https://github.com/Brulek/libcimbar). Searches found no App Store listing.
- Cross-platform without a store: a WeChat mini program compiled to WASM, released officially — [issue #189](https://github.com/sz3/libcimbar/issues/189).
- Web: yes, a first-party decoder exists, still beta. PR #190, merged 2026-10-17, added an OffscreenCanvas fallback when VideoFrame is missing, warning that performance on those devices "may not be ideal", and fixed a WASM heap resize crash. Its author says it is "still beta software" but "getting closer" — [PR #190](https://github.com/sz3/libcimbar/pull/190).
- Web, third party: [cimbar-decoder](https://github.com/doublej9999/cimbar-decoder) on Vercel, built on libcimbar v0.6.8, states iOS 16.4+ for the WebCodecs path and a Canvas fallback. It verified a 120,000-byte file by SHA-256, but only in headless Chrome on a VPS.

**Project state**
- Latest release I could see is v0.6.8 (26 Aug), with a reproducible WASM build and an epilepsy warning on the encoder. v0.6.7c (14 Jul) made web encoder rendering faster, with a background-thread offscreen canvas — [releases](https://github.com/sz3/libcimbar/releases). The page gives no years, so 2026 is my inference from F-Droid and PR dates.
- The project still calls itself "an experimental barcode format" — [README](https://github.com/sz3/libcimbar).

### Inferences
- [E] 106 KB/s at 7,500 bytes per frame means about 14 useful frames per second. That fits the web encoder's 5/10/15/20 fps slider and needs far less than the panel's 60 Hz, so a 60 Hz laptop is not the bottleneck for cimbar.
- [E] Bm and Bu would be about 74 and 46 KB/s if they scale from B's measured rate. Even the most cautious mode is 15x or more above the plan.
- For the stick, cimbar's sender would have to run in WebKit on software rendering. The encoder's WebGL path and `cimbar_send`'s GLES and GLFW dependencies are the integration risk (see the failures section). MPL-2.0 is file-level, so linking it into the app looks workable, subject to a proper licence check.
- Byte-exact delivery needs its own check. Fountain and Reed-Solomon recover data, but the writer needs proof. Showing a SHA-256 on the laptop and on the phone would give that, as Decimen does before offering a file.

### Gaps
- The sender, monitor, distance and lighting behind 852 kbit/s are not stated, and no error rate or fps is reported.
- I could not open cimbar.org to confirm the hosted decoder's URL or browser list. PR #190 names only `web/recv.html` and related source files.
- No App Store cimbar receiver could be confirmed, and a search cannot prove absence. An App Store check by hand is worthwhile.

## Colour and high-density barcodes: JAB Code, HCCB, RainBar, COBRA, LightSync, PixNet and similar

### Takeaway
Almost none of the academic and standards work ships as something a writer can use. cimbar is effectively the practical descendant of this line. Measured file goodput in the phone-era papers tops out at about 17 KB/s, well below cimbar and fast QR. JAB Code and HCCB are static print codes with no video-rate evidence.

### Cited Findings
- **RDCode** (MobiCom 2014): [M] see the table above. Tested on 720p30 phones at 10 fps; about 30,000 bits per frame with under 10% bit errors, more than twice COBRA's — [paper](http://anranw.me/papers/rdcode.pdf).
- **COBRA** (MobiSys 2012): own evaluation reports 91 to 172 kbps at block sizes 5 to 10 with 64% to 98% correct frames — [ACM](https://dl.acm.org/doi/pdf/10.1145/2307636.2307645) (extract). A search extract put its range at about 22 cm, but I could not pin down which paper said so; RDCode's comparison rig sat at about 21 cm. File goodput measured by RDCode's authors was only 2.1 to 3.0 KB/s — [RDCode](http://anranw.me/papers/rdcode.pdf).
- **LightSync** (MobiCom 2013): uses in-frame colour tracking and a linear erasure code across frames, and works when receive rate is at least half of transmit rate. The author says it more than doubles average throughput — [ACM entry](https://unpaywall.org/10.1145%2F2500423.2500437), [talk abstract](https://talks.cam.ac.uk/talk/index/51694/). It uses two colours, so its frame capacity is half of COBRA's — [RDCode](http://anranw.me/papers/rdcode.pdf).
- **PixNet** (Katabi group, MIT): [M] up to 12 Mb/s at 10 m and view angles to 120 degrees with off-the-shelf LCDs and cameras — [MIT thesis record](https://dspace.mit.edu/handle/1721.1/61553?show=full). This is a lab prototype and not a phone result.
- **RainBar** (ICDCS 2015): flexible frame sync and locators; authors report higher average throughput than earlier systems on Android. An implementation is at [Gitee](https://gitee.com/cse-crypto/rain_-bar) (extract; I did not review the code). I did not get an absolute figure.
- **ShiftCode**: notes that colour-coded systems suffer frame mixing from CMOS rolling shutter at high capture rates, and reports at least 2x goodput over conventional systems — [ACM via Unpaywall](https://unpaywall.org/10.1145%2F3443467.3443779) (extract).
- **Capacity analysis**: existing prototypes leave room for at least 2.5x, under a perspective-distortion model — [Stony Brook](https://researchconnect.stonybrook.edu/en/publications/capacity-of-screen-camera-communications-under-perspective-distor/) (extract).
- **JAB Code**: standardised as ISO/IEC 23634:2022, with a Go port and reference code available — [pkg.go.dev](https://pkg.go.dev/github.com/srlehn/jabcode). A Fraunhofer-affiliated paper finds the standard decoding algorithm reads under 10% for very large and rectangular codes — [Athene](https://www.athene-center.de/forschung/publikationen/improving-version-detection-for-jab-codes-4691) (extract).
- **HCCB**: Microsoft lab tests reached about 2,000 binary bytes per square inch at eight colours, using a 600 dpi scanner. That is a print-and-scanner result, not a camera-video one — [Microsoft Research](https://www.microsoft.com/en-us/research/wp-json/wp/v2/msr-project/169590) (extract).

### Inferences
- RDCode's 17 KB/s came from 2014 phones at 10 fps, so modern hardware would likely do better. No maintained app exists, so it is of historical interest. Its layering (inter-block and inter-frame correction, tolerance of partial frames) is what cimbar and fountain QR already achieve.
- JAB Code at video rate is the wrong bet: a weak decoder and no streaming evidence. It adds risk with no measured benefit over cimbar.

### Gaps
- Absolute LightSync and RainBar throughput were not retrievable. The ACM full texts were blocked. A bigger gap is that I did not find a measured video-rate JAB or HCCB transfer at all.

## Invisible channels: InFrame, HiLight, TextureCode, ChromaCode, Uber-in-Light, watermarks. Could a page carry its own bytes?

### Takeaway
Not usefully on these machines. The high-rate invisible systems need 120 Hz panels and GPU rendering or pre-rendered video. On 60 Hz, unobtrusive methods fall to about 0.1 to 0.6 KB/s, slower than the QR plan. Still-image watermarks carry about 7 characters per image. A self-carrying page is a charming idea but not a transfer method.

### Cited Findings
**High-rate, needs 120 Hz**
- **InFrame++** (MobiSys 2015): [M] 150 to 240 kbps at 120 fps, up to 360 kbps at data:video 1:6, falling to about 70 to 85 kbps after all error handling. Fails beyond about 2 m on S5 and Note 3. Sender is "mainly implemented in GPU". Receiver processing was 202 to 981 ms per frame on PCs against a 100 ms requirement, so it did not run in real time — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobisys15-inframe++.pdf). Some residual flicker at 70 cm with 32×32 blocks — [TextureCode slides](https://winlab.rutgers.edu/~vietnh/docs/infocom16-texturecode-vietnguyen-final.pdf).
- **ChromaCode** (MobiCom 2018): [M] 777 kbps raw and 120 kbps goodput, BER 0.05, at 50 cm. Goodput fell to about 40 kbps with BER about 0.10 at 15 to 25 degrees off-axis. Needs a 120 Hz monitor, and the authors used a graphics card "for efficient 120fps video playing" with FFmpeg-prepared video. The authors note the receiver's real-time capability is future work, and that BER remains "somewhat still high" because of rolling shutter and moire — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf).

**Lower rates (HiLight, Uber-in-Light and DeepLight tested on 60 Hz; DeepLight says TextureCode's figures were at 120 fps)**
- **TextureCode** (INFOCOM 2016): [M] about 15 to 16 kbps average, up to 22 kbps flicker-free in a hybrid — [slides](https://winlab.rutgers.edu/~vietnh/docs/infocom16-texturecode-vietnguyen-final.pdf). It does not embed in plain regions and uses no error correction, and its goodput ranged from 1 to 95 kbps in ChromaCode's comparison — [ChromaCode](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf).
- **HiLight** (MobiSys 2015): [M] 1.1 kbps real-time with 84% to 91%+ accuracy, using BFSK at 20 and 30 Hz via the alpha channel — [paper](https://www.cs.dartmouth.edu/~xia/papers/mobisys15-hilight.pdf) (extract), [DeepLight](https://arxiv.org/pdf/2105.05092). Uber-in-Light's authors report only 0.6 kbps for HiLight on a Mac with an iPhone 6 camera — [Uber-in-Light](https://www.winlab.rutgers.edu/~yychen/papers/Uber-in-Light%20Unobtrusive%20Visible%20Light%20Communication%20Leveraging%20Complementary%20Color%20Channel.pdf).
- **Uber-in-Light** (INFOCOM 2016, not MobiSys): [M] at least 94% accuracy and 0.85 kbps across content types, on a 60 Hz 1600×900 LCD with a Samsung Note 10.1 at 30 Hz and 40 cm. It uses MFSK at 7 to 14 Hz with complementary red/blue changes, and aims at low-end GPUs and CPUs — [paper](https://www.winlab.rutgers.edu/~yychen/papers/Uber-in-Light%20Unobtrusive%20Visible%20Light%20Communication%20Leveraging%20Complementary%20Color%20Channel.pdf).
- **DeepLight** (IPSN 2021): [M] 60 Hz 25-inch monitor, blue-channel modulation, 120 fps iPhone camera. Goodput 0.95 to 1.2 kbps handheld at about 2 m, 1.72 kbps at up to 1.25 m, and 4.7 kbps (26.6 raw) on a 30×30 grid at 1 m. Decoding runs on a phone at about 60 fps — [paper](https://arxiv.org/pdf/2105.05092).
- DeepLight normalised prior work to 60 fps and 1 m: InFrame++ 9 kbps, TextureCode 11.25 kbps, HiLight 4.6 kbps, ChromaCode 0.5 to 1.5 kbps goodput from about 220 kbps raw — [paper](https://arxiv.org/pdf/2105.05092). These are estimates by a competitor, and they are far lower than the originals. It also points out that complementary modulation flickers at 60 fps, since visible flicker fuses above about 50 Hz — [paper](https://arxiv.org/pdf/2105.05092).
- **PassiveCam** (2024): passive transparent displays at about 90% packet success, with 530 ms and 1071 ms response times static and handheld. Not relevant hardware — [arXiv](https://arxiv.org/pdf/2403.16185).

**Still images**
- **StegaStamp** (CVPR 2020): 100 bits per image, 56 after ECC (about 7 UTF-8 characters), recovering about 95% of bits in real-world capture — [paper](https://openaccess.thecvf.com/content_CVPR_2020/papers/Tancik_StegaStamp_Invisible_Hyperlinks_in_Physical_Photographs_CVPR_2020_paper.pdf), [code](https://fr.github.com/tancik/StegaStamp), [supplement](https://openaccess.thecvf.com/content_CVPR_2020/supplemental/Tancik_StegaStamp_Invisible_Hyperlinks_CVPR_2020_supplemental.pdf).
- **Screen-shooting document watermarks**: a neural encoder/decoder for document images notes such pages carry less redundancy than natural images — [arXiv](https://arxiv.org/pdf/2203.05198). Later work says earlier screen-shooting schemes have small capacity — [RiSw](https://journal.hep.com.cn/ol/EN/10.1007/s11801-024-3255-6). Fang et al. repeat a small template to survive lens, lighting and moire distortion — [IEEE TIFS](https://signalprocessingsociety.org/publications-resources/ieee-transactions-information-forensics-and-security/2019/06/screen-shooting-resilient-watermarking). No bits-per-page figures were found for these.

### Inferences
- [E] At DeepLight's practical 1 kbps, a 30 KB chapter takes 4 minutes with the phone held still. At 4.7 kbps it takes 51 s. That is no better than the plan, and it needs a custom DNN receiver.
- A manuscript page is a hard carrier: mostly flat, near-saturated white or near-black, with sharp text. TextureCode avoids plain regions. Pixels at the top of the range can't brighten further, so a page would need a slightly off-white ground, or a dark theme and a very low-amplitude pattern. A page with a live hidden pattern also conflicts with a quiet, still appliance. Epilepsy-style concerns don't apply if it is invisible, but residual flicker at 60 Hz would.
- Any neural decoder would also carry risk for a byte-exact promise: it needs an end-to-end hash and a fallback anyway, so its output could never be trusted on its own.
- A useful residue: a watermark or tiny static code could carry a document fingerprint (a hash of the file) instead of the file, letting a phone verify that what it received matches the page. 56 bits is thin but workable as a check. This is an idea, not something tested.

### Gaps
- I found no study that embeds data in a static, text-only Markdown page and reports a rate. All the temporal systems test on video or images. Flicker results on a white text page at 60 Hz are unknown.

## High-frame-rate phone video (120/240 fps) and offline post-processing

### Takeaway
I found no paper or project that measures 240 fps capture with record-first decoding on a screen-camera link. The evidence available suggests that it would improve reliability more than throughput, because a 60 Hz panel caps the sender. Recording first has a separate, real value: it decouples the phone's capture from its decoder and removes the need for a live receiver app.

### Cited Findings
- Decimen's record run captured at 60 fps, with 0.742 catch rate and 457 decodes (the record does not state the sender's frame rate or panel refresh) — [run record](https://github.com/bashalarmistalt/decimen-optical-transfer/blob/main/benchmarks/runs/2026-08-09T04-12-41-run.json). So a live browser can already keep up at 60 fps on a current iPhone.
- Decimen tunes tx 60 for a 120 Hz sender. On a 60 Hz panel each frame gets one refresh, and it advises 24 to 30 fps if the receiver stalls — [sending.md](https://raw.githubusercontent.com/bashalarmistalt/decimen-optical-transfer/master/docs/user/sending.md). A search extract adds that each frame must own at least 2 refresh cycles, and that a 60 Hz laptop blends frames for a 30 fps camera — [Decimen press and docs extracts](https://betterstack.com/community/guides/linux/decimen-optical/).
- LightSync needs a receive rate of at least half the transmit rate — [talk abstract](https://talks.cam.ac.uk/talk/index/51694/). DeepLight deliberately captures 120 fps for a 60 Hz display, to catch a clean frame triple around each transition — [paper](https://arxiv.org/pdf/2105.05092).
- Offline decoding has been used in research: RDCode implemented an offline decoder reading saved capture data, while its live decoder reached 300 kbps on 2014 phones — [paper](http://anranw.me/papers/rdcode.pdf). InFrame++'s and ChromaCode's receivers were effectively offline — [InFrame++](https://www.cs.purdue.edu/homes/chunyi/pubs/mobisys15-inframe++.pdf), [ChromaCode](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf).
- A 2020 IEICE paper proposes a rolling-shutter receiving method for display-camera VLC that can transfer when display rate exceeds capture rate — [IEICE abstract](https://ken.ieice.org/ken/paper/20201125qCaU/eng/) (extract; no numbers retrieved).
- Compression can damage dense codes: Decimen advises at least 4x module scale when a stream will pass through video compression — [sending.md](https://raw.githubusercontent.com/bashalarmistalt/decimen-optical-transfer/master/docs/user/sending.md). cimbar decoders exist that import a GIF, not phone video, as far as I found — [CimBar Scanner](https://f-droid.org/ko/packages/com.nfcarchiver.cimbar/) (extract).

### Inferences
- With a 60 Hz panel the transmitter cannot exceed 60 new frames per second, and practically 24 to 30. A 120 fps camera captures each frame at least twice, and 240 fps four times or more. This gives clean frames between transitions, and it removes rolling-shutter blends, but adds no new data. So expect fewer lost frames and steadier fountain progress, not more peak rate.
- Short exposures at 240 fps collect less light, and a dim laptop panel makes that worse. Phone HFR modes tend to reduce resolution and compress hard, which works against small coloured tiles. Larger modules, like Bu or lower-density QR, would suit it better. This is reasoning from the sources above, not a measurement.
- The attraction of record-first is the receiver: the phone's stock camera app, then a page that opens a video file and decodes offline, needing no live camera permission or HTTPS origin issue. Decimen's `file://` receiver cannot get a camera on iOS or Android, but file input would not need one — [troubleshooting](https://raw.githubusercontent.com/bashalarmistalt/decimen-optical-transfer/master/docs/user/troubleshooting.md). It is worth a prototype, because the loop-until-done nature of fountain codes suits it: record 30 s, decode, record more if short.

### Gaps
- No measured numbers exist for 120 or 240 fps capture of cimbar or fountain QR, or for how HEVC video compression affects decoding. A one-evening bench test with stock camera video and `cimbar_recv` on the desktop would answer much of this.

## Other sensors: phone ambient-light sensor against a flickering screen

### Takeaway
I found no measured display-to-ALS link on a current phone. Everything points to tens to low hundreds of bits per second at best, Android only. That is at least 40x below even the low end of the QR plan, and it has no advantage except that it needs no camera.

### Cited Findings
- A 2017 study reports about 0.2 kbps over 2 m on a phone ALS against about 2 kbps over 0.3 m with the camera, for LED VLC and not a screen — [EUDL](https://eudl.eu/pdf/10.1007/978-3-319-66628-0_36) (extract).
- Smartphone ALS parts are tuned for dynamic range and generally lack the frequency response to decode high-speed data — [CMU IPSN 2014](https://users.ece.cmu.edu/~agr/resources/publications/ipsn2014-vlc.pdf) (extract).
- [M] Sampling on a Samsung Galaxy SIII through the Android API: about 750 Hz at FASTEST, 49 Hz GAME, 15 Hz UI, 5 Hz NORMAL — [PIN Skimming](https://arxiv.org/pdf/1405.3760). The same search extract reports 1 Hz on a Nexus One. These are 2014 figures.
- A plugin's documentation reports a 200 ms minimum Android light-sensor interval without `HIGH_SAMPLING_RATE_SENSORS` and says iOS exposes no ALS API to third-party apps. This is not platform documentation — [Capgo](https://capgo.app/docs/plugins/light-sensor/getting-started).
- Faster flicker-sensing parts exist, such as ams's TCS3410 to 7 kHz — [press release](https://chartexchange.com/article/?id=14446) — but I found no evidence that apps can read that signal.

### Inferences
- [E] A panel changes at most at 60 Hz, so on-off keying gives at most about 30 bit/s, or perhaps 100 to 200 bit/s with several brightness levels and perfect sampling. That means 15 to 25 B/s at best, so a 30 KB chapter takes at least 20 minutes. It also cannot be byte-exact without long fountain runs, and the sensor sits under glass or near the bezel, so placement against the panel would be awkward.
- It would need a native Android app with no iOS path, and it would strobe the screen. Rule it out.

### Gaps
- I found no paper with a figure for a modern LCD or OLED screen driving a phone ALS, so the estimate above is arithmetic only.

## Practical failures on real laptops and phones

### Takeaway
The failures are mostly about frame timing and pixel accuracy, and only partly about optics. For the stick the three that matter most are software rendering, integer-pixel mapping on low-resolution or scaled panels, and autofocus. Matte versus glossy panels and PWM have essentially no measured evidence in this literature.

### Cited Findings
- **Rolling shutter and frame mixing**: captures straddle two displayed frames. ShiftCode describes the frame mixing — [Unpaywall](https://unpaywall.org/10.1145%2F3443467.3443779) (extract). ChromaCode interpolates to find the shutter position and corrects lightness on either side — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf). LightSync uses in-frame colour tracking — [ACM entry](https://unpaywall.org/10.1145%2F2500423.2500437).
- **Moire**: comes from alignment between the LCD panel and the camera's colour filter array, and changing distance or angle reduces it — [general guide, search extract](https://www.lx.iriss.org.uk/read/moire-pattern-screen.html). ChromaCode names moire as a cause of its high BER — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf). No measured rate penalty on a laptop was found.
- **Focus and distance**: Decimen calls autofocus hunting from hand tremor the usual cause of a failed decode, and advises filling the view with the code and propping the phone — [troubleshooting](https://raw.githubusercontent.com/bashalarmistalt/decimen-optical-transfer/master/docs/user/troubleshooting.md). libcimbar's web encoder pauses briefly on menu toggle to help autofocus — [releases](https://github.com/sz3/libcimbar/releases). Going from 60 cm to 40 cm hurt InFrame++ on the Note 3 through added distortion — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobisys15-inframe++.pdf).
- **Density versus distance**: Decimen's 2953-byte frame is "tuned for close-range phone-to-phone" and can fail on an ordinary monitor at arm's length. The fix is 1465 bytes, then 24 fps — [troubleshooting](https://raw.githubusercontent.com/bashalarmistalt/decimen-optical-transfer/master/docs/user/troubleshooting.md). Tiling more codes needs more camera resolution per module — [sending.md](https://raw.githubusercontent.com/bashalarmistalt/decimen-optical-transfer/master/docs/user/sending.md).
- **Refresh rate**: see the HFR section. InFrame++ and ChromaCode assume 120 Hz, while DeepLight targets 30 to 60 Hz because common screens flicker under those schemes — [DeepLight](https://arxiv.org/pdf/2105.05092).
- **Brightness and PWM**: Decimen advises maximum sending brightness — [troubleshooting](https://raw.githubusercontent.com/bashalarmistalt/decimen-optical-transfer/master/docs/user/troubleshooting.md), and InFrame++ tested at 100% — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobisys15-inframe++.pdf). DXOMARK explains that low-frequency PWM can produce flicker even on fast-refresh phones — [DXOMARK](https://www.dxomark.com/flicker-the-display-affliction/). I found nothing measuring PWM's cost on a screen-camera link.
- **Ambient light**: ChromaCode's goodput falls slightly as ambient light rises from its 300 lux default — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf). RDCode tested at 1 to 100 lx — [paper](http://anranw.me/papers/rdcode.pdf).
- **Software rendering and encoder dependencies**: cimbar's native build needs GLES headers and GLFW — [README](https://raw.githubusercontent.com/sz3/libcimbar/master/README.md). Its web encoder reports WebGL initialisation failures with an error message, and its rendering was optimised recently, with v0.6.8 adding a shader change for older GLSL — [releases](https://github.com/sz3/libcimbar/releases). This repository's own stick QA recorded frames shown late on software rendering — [AGENTS.md](/home/yunus/Work/bismillah/AGENTS.md). InFrame++ renders in GPU and reports 131 to 250 fps on its PCs — [paper](https://www.cs.purdue.edu/homes/chunyi/pubs/mobisys15-inframe++.pdf).
- **Low-resolution panels**: cimbar's frame is 1024×1024 and can shrink to 700×700 with possible loss — [PERFORMANCE.md](https://raw.githubusercontent.com/sz3/libcimbar/master/PERFORMANCE.md). Decimen's display size defaults to 900 px, capped by the screen — [sending.md](https://raw.githubusercontent.com/bashalarmistalt/decimen-optical-transfer/master/docs/user/sending.md).
- **Safety**: libcimbar added an epilepsy warning to its encoder in v0.6.8 — [releases](https://github.com/sz3/libcimbar/releases). Decimen stresses there is no encryption, so any camera pointed at the screen can read the data — [wiki](https://github.com/bashalarmistalt/decimen-optical-transfer/wiki).

### Inferences
- **1366×768 panels**: a 1024×1024 frame cannot fit without scaling. cimbar's lower bound of 700×700 suggests a non-integer downscale, which would blur tiles, so a test with Bm or Bu is needed. A rectangular or lower-density mode would be the likely answer there.
- **Scaled desktops**: the author's test laptop runs a 4K panel at 2x. A canvas must map to device pixels, not CSS pixels, or each tile is resampled. That would be an easy bug to miss, because it would only show up as a low decode rate.
- **Software rendering**: a visible code changes the whole frame but is a simple blit. It should be pre-rendered once per frame and pushed with Canvas 2D or a texture, avoiding any shader that llvmpipe would struggle with. Timing matters more than speed: uneven frame pacing costs fountain frames, not correctness. cimbar's low rate of about 15 fps gives room here. Whether the stick's WebKit build and cage allow WebGL at all should be checked first.
- **Glossy panels**: laptop glare is likely to matter, but no measurements exist. Fountain coding tolerates a lost region only if it loses whole frames or codes, and a reflection on one tile region goes to Reed-Solomon. Tiling several small codes may be more robust to a hotspot than one large code. That is reasoning, not evidence.
- **Byte-exactness**: every channel here is lossy underneath. The guarantee must come from an end-to-end SHA-256 over exact file bytes, checked on the phone, with the laptop showing the same digest for the writer to compare. Decimen already checks SHA-256 before offering a file. zstd is lossless, so it does not threaten this. Plaintext on screen is an unavoidable part of the output path, since any camera in the room sees the frames, so the sender could encrypt to a passphrase if that matters.
- **Practical order of work suggested by this evidence**: (1) bench the existing QR path at higher fps, since it may reach about 10x with no new code family, (2) add a cimbar sender with Bm/Bu on low-resolution panels for larger files, (3) test stock-camera video plus offline decoding. Drop invisible channels and the ALS.

### Gaps
- No comparative measurement of matte versus glossy panels exists in anything I found.
- No measured cost of PWM on a screen-camera link was found.
- There is no measurement of cimbar or fast QR on low-resolution 1366×768 panels or under Mesa software rendering. These can only be answered on the stick.
- The 852 kbit/s, Decimen and WeChat figures all come from the projects' authors or users. None is independently replicated.
