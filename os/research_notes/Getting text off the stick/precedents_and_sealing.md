# Precedents and sealing: how comparable devices move data out, and what makes an output channel safe

Researched 2026-10-31. Evidence labels: **[measured]** means someone reports a test with numbers, **[project claim]** means the maker's own statement, **[excerpt only]** means I saw the text only in a search excerpt because the page itself would not load. Everything under "Inferences" is my reasoning and has not been tested. No design here involves generative AI: sealing, encoding and check words are deterministic and never alter the text.

## Writing devices: export routes, praise and complaints

### Takeaway
No writing device I found encrypts its export. They use a cable, removable media, Wi-Fi or a vendor cloud, and the only QR route is Pomera's, with no encryption mentioned. Sealed optical export would be new for this category, and the category's documented trouble is with sync and companion apps.

### Cited Findings
- **Freewrite (Smart Typewriter, Traveler, Alpha):** work syncs to the cloud over Wi-Fi, managed through a required free Postbox account and linked Dropbox, Google Drive, Evernote or OneDrive, with TXT, MD, DOCX or FDX output — [Freewrite support](https://support.getfreewrite.com/article/200-cloud-syncing-on-freewrite). The article has no statement on how drafts are stored or protected on the servers.
- Freewrite's offline route is USB, which exposes drafts as read-only TXT files to copy off — [Traveler offline docs](https://support.getfreewrite.com/article/81-offline-document-saving-and-access).
- Freewrite's troubleshooting for a stuck draft is to check for "Draft Synced to Postbox", toggle Wi-Fi, then restart; toggling Wi-Fi also logs the user out of Postbox — [Draft Not Syncing](https://support.getfreewrite.com/article/65-draft-not-syncing). An older firmware post describes drafts disappearing when Postbox told a device to destroy them, new content included — [Freewrite firmware 2.0.3](https://getfreewrite.com/fr/blogs/writing-success/freewrite-firmware-2-0-3-update-improving-syncing-squashing-bugs). I found no current status for that bug.
- **Pomera:** the companion app reads up to 999 consecutive QR codes from a Pomera, and the DM250 can split text across 999 codes. It also transfers over Wi-Fi on the DM250 and via FlashAir on the DM100 and DM30. The listing does not mention encryption or characters per code — [pomera Link, App Store](https://apps.apple.com/us/app/id371963393).
- The same listing shows 3.7/5 from just 3 ratings. One reviewer says "The app completely doesn't work" and that there is no support. That is too small a sample to generalise — [pomera Link, App Store](https://apps.apple.com/us/app/id371963393).
- **AlphaSmart Neo:** it presents as a USB keyboard and replays stored text as keystrokes into any open document — [Wikipedia](https://en.wikipedia.org/wiki/AlphaSmart). The manual requires the computer to use a QWERTY layout — [Neo manual](https://manualzilla.com/doc/7362775/alphasmart-neo-1-user-manual?page=96).
- One owner reported about 1000 words per minute at the fastest Send setting, up from "painfully slow". This is an anecdote, and I saw it only in a search summary of forum results, so the exact page is unconfirmed — [Literature & Latte forum](https://forum.literatureandlatte.com/t/scrivener-and-alphasmart/7931?page=2). A forum report also says Send kept working after a macOS update broke a setup prompt — same thread family, [excerpt only].
- **Zerowriter Ink:** microSD and USB, plain text, no shipped wireless transfer or email. The hardware has Wi-Fi and the makers leave online features to code or community extensions — [The Gadgeteer](https://the-gadgeteer.com/2026/02/04/this-word-processor-cant-access-the-internet-and-thats-the-entire-point/); [CNX Software](https://www.cnx-software.com/2024/09/18/zerowriter-ink-open-source-esp32-s3-epaper-word-processor/).
- **reMarkable Paper Pro Move:** listed exports are PDF, PNG and SVG, and pairing and transfer run through a cloud account at my.remarkable.com. It takes no Type Folio — [reMarkable features](https://remarkable.com/de-DE/products/remarkable-paper/pro-move/details/features).
- **Supernote:** USB (macOS needs a third-party MTP app), cloud, email, or Browse & Access, a URL opened on a device on the same Wi-Fi network — [Supernote transfer docs](https://support.supernote.com/transfer-files); [Browse & Access](https://ratta.helpjuice.com/wi-fi-transfer).
- **BOOX:** USB, cloud apps or Wi-Fi. Exports do not refresh, so the writer must re-export after each edit — [the-ebook-reader](https://blog.the-ebook-reader.com/2018/05/21/onyx-boox-note-10-3-pdf-review-video/). A community plugin author calls the flow tedious and automates it — [Onyx Boox Sync](https://community.obsidian.md/plugins/onyx-boox-sync).

### Inferences
- Keyboard emulation has the fondest reputation because it needs no software on the receiving side, but it cannot serve this project. It depends on keyboard layout, so it cannot promise exact Arabic bytes, and a laptop's USB ports normally act as host, so a booted stick could not pose as a keyboard.
- Freewrite shows the failure bismillah should avoid: a single state ("synced") that hides whether the writer's text is really safe elsewhere. The project's honest-state rule should extend to export ("shown", "confirmed by check words").
- Pomera proves that long multi-QR text export is a shipped idea, and also that the companion app is the weak part.

### Gaps
- I could not retrieve forum complaints about Postbox specifically, and searches returned unrelated postal results. Praise and complaint evidence above is thin, and Reddit/writerDeck threads were not read.
- No Pomera characters-per-code or scan-time figure was found. The King Jim manual was not retrieved.
- BOOX current firmware behaviour rests on older third-party posts.

## Air-gapped crypto wallets: throughput, QR versus microSD, verification

### Takeaway
Wallets show that a fountain-coded animated QR tolerates dropped frames and that the problem is usability more than security. The best measured results come from hobby projects, not vendors: about 25 KB/s for fountain QR and about 106 KB/s for cimbar. Coldcard's Key Teleport is the closest precedent for encrypted QR, and it needs an inbound channel (QR or NFC) on both ends, which the stick lacks.

### Cited Findings
**Throughput**

| System | Figure | Status |
|---|---|---|
| TXQR, no fountain codes | ~9 KB/s best (11 FPS, 850-byte chunks); author expects 1–2 KB/s in most cases; 1000-byte chunks lost frames and timed out | [measured] by the author, phone on tripod — [divan.dev](https://divan.dev/posts/animatedqr/) |
| TXQR, LT fountain | ~13 KB in ~501 ms (~25 KB/s), 1850 bytes/QR, 12 FPS, low ECC; the article writes "25kbps", which looks like a units error; most runs under 4 s | [measured] by the author, best record, tripod, external monitor — [divan.dev](https://divan.dev/posts/fountaincodes/) |
| libcimbar mode B | 4,689,084 bytes in 44 s (~106 KB/s), about 7,500 usable bytes per frame, zstd-compressed, Snapdragon 625 phone | [measured] by the project, no independent benchmark — [PERFORMANCE.md](https://raw.githubusercontent.com/sz3/libcimbar/master/PERFORMANCE.md) |
| Static QR version 40 | 2,953 bytes, or 4,296 alphanumeric characters; practical limits are lower and dense codes can be unreadable on consumer devices | Specification limit — [Blockchain Commons](https://developer.blockchaincommons.com/animated-qrs/) |

- Cimbar's limits: straight-on capture, good ambient light, glare and shaky hands cause failures, and the camera is usually the bottleneck — [PERFORMANCE.md](https://raw.githubusercontent.com/sz3/libcimbar/master/PERFORMANCE.md). The project calls the format experimental, mobile decoding is Android-only, files can be up to 33 MB compressed, and it describes no encryption or cryptographic hash — [libcimbar README](https://raw.githubusercontent.com/sz3/libcimbar/master/README.md).

**Encoding standards**
- BC-UR Animated QR uses Luby transform fountain codes: the receiver can begin at any frame and recover from missing frames. The page gives no throughput, frame rate or fragment size — [Blockchain Commons](https://developer.blockchaincommons.com/animated-qrs/).
- Coinkite's BBQr has no fountain coding: parts decode in any order, but every part must be scanned. It uses hex, Base32 or zlib+Base32 in alphanumeric QR mode, has a "U" type for UTF-8 text, and allows up to 1295 parts. It relies on QR's own error correction and carries no checksum at its layer — [BBQr spec](https://raw.githubusercontent.com/coinkite/BBQr/master/BBQr.md).

**QR versus microSD, and what the vendors concluded**
- Foundation still calls QR air-gapping "excellent" for security, but says it carries "unavoidable cognitive overhead" ("How do I know when it's complete?") and that "the rigidity itself became the barrier". It moved its newer product to a wireless link, QuantumLink — [Foundation](https://foundation.xyz/blog/from-qr-air-gapping-to-quantumlink-what-comes-next). This is a vendor promoting its next product.
- Passport uses QR and microSD, with no USB data, Bluetooth or Wi-Fi — [Foundation](https://foundation.xyz/blog/from-qr-air-gapping-to-quantumlink-what-comes-next). Keycard's vendor blog argues microSD is a data channel that is harder to check visually, so QR-only is cleaner — [Keycard](https://docs.keycard.tech/de/blog/best-air-gapped-hardware-wallets-compared-qr-signing-open-source-and-secure-elem). A comparison site rates microSD a genuine air gap but calls its filesystem an attack surface — [Spark](https://www.spark.money/tools/bitcoin-airgap-signing-comparison). All are vendor or affiliate opinions, not tests.
- SeedSigner can receive only by camera and send only by displaying QR codes, and its goal is a verifiably air-gapped, stateless signer — [SeedSigner](https://github.com/SeedSigner/seedsigner/).
- Coldcard's own material advertises NFC as tap-to-transmit — [coldcard.com](https://www.coldcard.com). Spark rates QR strongest, microSD strong, NFC moderate and USB none — [Spark](https://www.spark.money/tools/bitcoin-airgap-signing-comparison).

**Coldcard Key Teleport, the closest cryptographic precedent** — [firmware docs](https://raw.githubusercontent.com/Coldcard/firmware/master/docs/key-teleport.md)
- The receiver shows an EC public key by QR, encrypted under an 8-digit code (about 26 bits, one SHA-256 round, no checksum) sent by a different channel. The code exists to make a substituted key detectable.
- The sender replies with a QR encrypted to the session key, plus an inner layer under an 8-character Base32 password (40 random bits, PBKDF2-SHA512, 5000 iterations).
- The document claims forward privacy and says the QR image is safe to keep in a cloud or camera roll because the password is not in it.
- It admits no protection against truncation beyond 2-byte checksums, and it requires a Q on the receiving side because QR scanning is needed.

**The 2026 Coldcard entropy incident**
- A March 2021 firmware build error made some devices use a weak software RNG. Coinkite's estimate is about 40 bits of entropy on Mk2/Mk3 seeds and about 72 bits on Mk4, Mk5 and Q — [TRM Labs](https://www.trmlabs.com/resources/blog/the-largest-hardware-wallet-exploit-of-2026-inside-the-usd-116-million-coldcard-hack) [excerpt only].
- Losses differ by tally: about 1,816 BTC from 5,200+ addresses per TRM/Galaxy; about 1,367 BTC from 4,585 addresses per [The Hacker News](https://www.thehackernews.com/2026/08/coldcard-hardware-wallet-flaw-linked-to.html) [excerpt only], where Galaxy cautions that not every address is computationally confirmed; about 2,055 BTC per [Ryder](https://ryder.id/blogs/post/coldcard-entropy-incident-explained) [excerpt only].

### Inferences
- **Use a fountain code, not BBQr's "every part" scheme,** for documents. A missed frame in a long book should not cost a restart, and "how do I know when it's complete?" can become a progress bar on the phone.
- Illustration for a 600 KB document (roughly 100,000 words): about 6 s at cimbar's rate, about 24 s at TXQR's record, about 67 s at 9 KB/s, and about 7 minutes at 1.5 KB/s. Plan for the low end, since the high numbers come from tripods. Handheld use on the stick is untested, and the project's own stick QA found frames shown late on software rendering (AGENTS.md), which could cap the frame rate.
- **Ciphertext does not compress,** so any compression has to happen before sealing. Random bytes rule out the wallet habit of plain text in byte mode.
- By arithmetic, Base32 in alphanumeric mode gives about 2,685 bytes per version-40 code (4296 × 5/8), slightly less than byte mode's 2,953. BBQr prefers alphanumeric for reliability in text-oriented scanners, and a custom receiver could read raw bytes. This needs testing.
- **The incident matters directly here.** Every sealed frame is public to anyone filming, so a weak ephemeral key would turn old recordings into plaintext. The air gap did not protect Coldcard users from a bad RNG. Bismillah should get ephemeral secrets from the kernel CSPRNG and test that path in the stick's early-boot conditions.
- Key Teleport's inner layer (40 bits, 5000 PBKDF2 rounds) would be weak by itself against offline search. Its strength comes from ECDH, which needs an inbound channel the stick does not have.

### Gaps
- I found no measured throughput from Keystone, Foundation, Coldcard or Blockchain Commons, and no vendor comparison test of QR versus microSD. The "what they concluded" evidence is opinion.
- I found nothing primary on Keystone 3 Pro's design, or on how each wallet verifies what left the device. Foundation's "physical confirmation" statement is not explained in detail.
- The Multipart UR implementation guide was not read, so UR overhead is unmeasured here.
- Wallet payloads are small, so their usability conclusions may understate the pain of book-length transfers.

## High-security journalism and government: the weakest step

### Takeaway
None of the sources I read names a single "weakest step" outright, but they cluster on the moment plaintext crosses the boundary and on the media that cross it. They respond with a separate export device, encryption, write-protect or write-once media, analog output, and a one-way trust direction.

### Cited Findings
- SecureDrop separates an inbound Transfer Device from an outbound Export Device; the Export Device carries decrypted documents from the air-gapped Secure Viewing Station to an everyday workstation — [SecureDrop glossary](https://docs.securedrop.org/en/stable/glossary.html).
- Guidance urges a secure printer or similar analog conversion to export documents whenever possible, and an encrypted Export Device otherwise — [SecureDrop journalist guide](https://docs.securedrop.org/en/stable/journalist.html) [excerpt only; the page timed out when fetched]. A docs discussion calls encrypting the Export Device the more critical recommendation — [SecureDrop PR #4657](https://github.com/freedomofpress/securedrop/pull/4657).
- A write-protect switch or USB write blocker is suggested against malware arriving on a repeatedly used Export Device — [SecureDrop hardware docs mirror](https://dokk.org/documentation/securedrop/2.5.2-7/admin/installation/hardware/). Write-once media removes the risk of exfiltration by malware persisting on the Transfer Device (e.g. BadUSB), though it is inconvenient and slow — [SecureDrop hardware docs mirror](https://dokk.org/documentation/securedrop/2.5.2-7/admin/installation/hardware/).
- An old guide copy advises stripping metadata inside Tails before returning documents, decrypting into the Persistent folder so plaintext is not left recoverable on the USB stick, and says "Never scan QR codes from the Secure Viewing Station using a network connected device" — [older SecureDrop guide mirror](https://trankmichael-github.readthedocs.io/en/stable/journalist.html). The mirror is outdated, and the QR sentence's context may be QR codes inside submissions rather than exports. It should be checked against current docs before being quoted.
- **Qubes:** copy only from more trusted to less trusted qubes; the reverse is "always potentially insecure if the data will be parsed in the target qube". The user picks the target in a dom0 dialog, and the transfer uses Xen shared memory, so the target need not parse a foreign filesystem — [Qubes docs](https://doc.qubes-os.org/en/latest/user/how-to-guides/how-to-copy-and-move-files.html).
- **Data diodes and cross-domain solutions:** vendors describe hardware that enforces one-way transfer — [BAE Systems](https://www.baesystems.com/en/product/data-diode-solution). OPSWAT frames a transfer CDS as diode, then filter and policy stage, then diode, and says "The risk is not in moving data. The risk is in moving it without deterministic enforcement and deep validation" — [OPSWAT](https://www.opswat.com/blog/data-diodes-in-transfer-cds-securing-high-assurance-cross-domain-solutions). This is vendor framing that sells filtering. Oakdoor places syntactic checks inside the diode — [Oakdoor](https://infosecurity-magazine.com/directory/oakdoor-hardware-security-solutions).
- **Tails** removed its file-wiping tools in 6.0 because they are not reliable on USB sticks and SSDs, and recommends encrypted volumes and not saving sensitive files in the first place — [Tails docs](https://tails.net/doc/encryption_and_privacy/secure_deletion/) [excerpt only].

### Inferences
- A QR stream is an optical data diode: the stick's screen cannot receive. It removes the inward risk that SecureDrop handles with write blockers, and matches Qubes' safe direction. It leaves the exposure SecureDrop handles with encryption, so a sealed QR stream answers both.
- An outbox has a risk QR lacks: the stick is plugged into a foreign computer as a block device, and that computer can alter it, including what boots next. Qubes avoids parsing foreign filesystems, and an appliance whose boot partition can be touched by the reading computer needs a strict answer (read-only mode is not guaranteed by USB sticks without a hardware switch). This should be assessed in os/ threat work.
- Printing is high-security practice's preferred export, and it is worth noting as the analog comparison, but it loses "exact bytes".
- My judgement of the weakest step for bismillah: the receiving device. Once text is on a networked phone, every promise ends. The writer should be told so plainly, and the receiver should keep the file sealed until asked.

### Gaps
- No source I read ranks a weakest step, so this is inferred. Current SecureDrop Workstation export documentation and government CDS guidance (NSA, NCSC) were not retrieved.
- No independent evaluation of a diode or CDS was read; everything cited here is vendor text.

## Sealing for output: pairing, PAKE, short authenticated strings, and code length

### Takeaway
A short code can only be short when a live two-way exchange limits an attacker to one guess. The stick has no inbound channel, so anything typed must either be a whole public key (62 characters, once, harmless if filmed) or a random secret long enough for offline attack (about 16 characters for 80 bits). The strongest design is to type the phone's public key once at home and seal every export to it, leaving nothing worth filming.

### Cited Findings
**age**
- X25519 recipients: each file gets a fresh ephemeral secret, the wrap key comes from HKDF-SHA-256, and the file key is wrapped with ChaCha20-Poly1305. Recipients are Bech32 — [age spec](https://github.com/C2SP/C2SP/blob/main/age.md).
- The payload uses 64 KiB ChaCha20-Poly1305 chunks with a final-chunk flag, and streaming decryption must report an error if no valid final chunk arrives, so truncation is detected. The page describes no sender authentication; the header MAC is keyed from the file key — [age spec](https://github.com/C2SP/C2SP/blob/main/age.md).
- A scrypt stanza must be the only stanza, so a file cannot be sealed both to a passphrase and to a recipient — [age spec](https://github.com/C2SP/C2SP/blob/main/age.md).
- Post-quantum: age v1.3.0 added hybrid ML-KEM-768 + X25519 recipients with the `age1pq1` prefix, and PQ recipients should not be mixed with classical ones in a file — [age releases](https://github.com/FiloSottile/age/releases) [excerpt only]; [age spec](https://github.com/C2SP/C2SP/blob/main/age.md). X-Wing's public key is 1216 bytes and its ciphertext 1120 bytes; the draft is still an Internet-Draft, -11 dated September 2026 — [X-Wing draft](https://www.ietf.org/ietf-ftp/internet-drafts/draft-connolly-cfrg-xwing-kem-11.html).
- A third-party Android age implementation exists — [AgePony](https://github.com/norsehorse-dev/AgePonyAndroid/releases/tag/v3.0.2) [excerpt only].

**Typing aids**
- Bech32 omits 1, b, i and o from its data alphabet, guarantees detection of any error affecting at most 4 characters, and is designed for reading and typing. A later disclosure found it not always robust against some insertions and deletions — [BIP-173](https://raw.githubusercontent.com/bitcoin/bips/master/bip-0173.mediawiki).
- EFF long list: 7,776 words at 12.9 bits each, 6 words ≈ 77 bits, about 7 characters a word. EFF short list 1: 1,296 words at 10.3 bits, 8 words ≈ 82 bits, about 4.5 characters a word — [EFF](https://www.eff.org/deeplinks/2016/07/new-wordlists-random-passphrases).

**PAKE and short authenticated strings**
- Magic Wormhole's default code is 16 bits. An attacker gets one guess per connection attempt, a wrong guess makes the connection fail, and PAKE "effectively trades off interaction against offline attacks". Both clients must be running and exchanging messages — [Magic Wormhole](https://magic-wormhole.readthedocs.io/en/latest/welcome.html).
- Vaudenay's SAS work uses a very short authenticated string, e.g. 15 bits, alongside an insecure channel; the authenticated channel must resist forgery but may be stalled or replayed — [Vaudenay, EPFL record](https://infoscience.epfl.ch/handle/20.500.14299/239717) [excerpt only]. The slides give a bound of about Q_A·Q_B·2^−(k+ℓ) with k+ℓ = 20 as usable — [CRYPTO 2005 slides](https://www.iacr.org/conferences/crypto2005/p/1.pdf) [excerpt only; conditions not confirmed against the paper].
- Later work describes about 20 bits as typical for SAS message authentication — [Jarecki & Saxena](https://nsaxena.engr.tamu.edu/wp-content/uploads/sites/238/2019/12/js-scn10.pdf) [excerpt only].

**Passphrase economics**
- At 64 MB per hash, a 24 GB GPU fits about 375 Argon2id instances — [UnveilPass blog](https://unveilpass.unveiltech.com/blog/argon2id-vs-pbkdf2.html). This is a vendor blog. Published cost estimates disagree and their parameters are unclear — [Bitwarden community thread](https://community.bitwarden.com/t/evaluating-master-password-security-how-many-bits-are-enough-for-economic-safety/74957/10).

### Inferences
**Why short codes do not transfer.** SAS and PAKE both need messages flowing both ways. PAKE could run here only if the phone's reply were typed, and that reply is a curve point of about 256 bits, so nothing is saved. SAS also needs a high-bandwidth way in, which the stick lacks. So 16–20 bits is an online figure and does not apply here: a filmed stream can be attacked offline, without limit and forever.

**Characters needed** (my arithmetic: Base32 = 5 bits per character; attacker rate assumes 1 GiB Argon2id at about 1 s, so about 24 guesses/s on a 24 GB GPU by the memory argument above, unbenchmarked):

| Typed | Bits | Time on one GPU | Use |
|---|---|---|---|
| 8 digits (as Key Teleport) | 26.6 | ~48 days; 100 GPUs ~12 hours | Not safe offline |
| 8 Base32 | 40 | ~1,450 years; a 10,000-GPU operator ~53 days | Too low for writing that must stay safe for decades |
| 13 Base32 | 65 | ~5×10^10 years | Practical floor for a one-off print |
| 16 Base32, or 8 EFF short words | 80–82 | ~10^15 years | Suggested per-print code |
| 26 Base32 | 130 | beyond search | A symmetric key with no KDF dependence |
| 62-character `age1…` | 256-bit public key | not applicable, public | Once-only pairing |

Eight EFF short words come to about 43 keystrokes, against 16 for Base32, so the words trade length for ease and fewer transcription slips. The code must be generated by the phone, never chosen by the writer, since human-chosen phrases do not have this entropy. KDF cost also falls on the phone, whose browser or app memory is untested.

**Candidate designs, most promising first:**

1. **Pair once at home; seal to the phone forever.** The phone makes an age X25519 key and shows the 62-character recipient. The writer types it once, and Bech32 catches typos. The stick and phone then show check words for the key. After that every export is sealed to it with a fresh ephemeral key, and the writer types nothing in the reading room.
   - Filming the screen, the keyboard and the pairing gives an attacker nothing, because the key is public. Only substitution at pairing time would matter, and the check words cover it.
   - The stick cannot read its own exports once the ephemeral secret is gone.
   - Weaknesses: a lost phone key opens every recording ever made; a future quantum computer breaks X25519 recordings; the phone needs an app.
2. **Per-print random code, for a borrowed phone or computer.** The receiver shows 16 Base32 characters, the writer types them, and the stick uses Argon2id and an AEAD. No pairing or stored key is needed, and a fresh code for each print limits damage. It requires the code stay off camera, including on the phone screen and the keyboard, so it is the weaker fallback. An age-format version would use scrypt as the sole recipient.
3. **Pairing at install time.** `bismillah-install` already runs on a computer the writer trusts, so it might write the recipient into the image and avoid typing altogether. This depends on whether the installer can take such input and on the host's trustworthiness, and it would have to be reconciled with the host-untouched promise. Treat this as a question for the installer's design.
4. **Post-quantum option.** A 1216-byte key is about 1,950 Base32 characters, so it cannot be typed. Options are install-time pairing or an extra typed symmetric secret of 26 characters mixed into a custom envelope. age offers no pre-shared-key stanza and forbids mixing, so this means leaving plain age. It is worth doing only if the writer's threat model includes decades-later decryption of recordings.

**Things that look clever but do not pay:**
- **Grinding for a short public key:** t leading zero bits cost the phone 2^t key generations. Even 2^32 saves about 6 of 52 characters.
- **Merkle puzzles** (recalled from background knowledge, not retrieved): the stick streams puzzles, the phone solves one, and the writer types a short non-secret ID. The ID could be filmed safely, which is appealing, but the attacker's work is only quadratic in the phone's, and bandwidth makes it far weaker than a once-only 62-character typing session.
- **A stick-generated code** is useless, as it would have to be displayed and so be filmed.

### Gaps
- I did not read the full Vaudenay paper; fetches failed, so the bound's exact conditions come from excerpts.
- No typing-time or error-rate study for 16, 26 or 62 random characters was found. A real test on the actual writer is needed.
- No Argon2id benchmark at 1 GiB on current GPUs was found (a Specops study on RTX 5090 systems exists, [CyberInsider](https://cyberinsider.com/?p=330808), but its figures were not retrieved). The table is order-of-magnitude.
- Receiver availability on iOS is unverified. Stock camera apps were not tested with encrypted streams, so an app or a self-contained page is probably needed, and no animated-QR age receiver was found.

## Filming and shoulder-surfing: protecting a QR stream in a public reading room

### Takeaway
Encryption is the only control here that survives a camera. Hiding techniques work against eyes, not lenses, and filters help only against off-axis viewers. Reveal-on-hold is a cheap courtesy that shortens exposure without changing the security.

### Cited Findings
- **Hidden screen-camera channels hide from people, not cameras.** HiLight encodes in pixel translucency and reports about 1.1 Kbps with 84–91%+ accuracy [measured by authors]; a preliminary workshop version claimed 11 Kbps at 30 cm — [HiLight, MobiSys 2015](https://www.cs.dartmouth.edu/~xia/papers/mobisys15-hilight.pdf) [excerpt only]; [workshop version](https://www.cs.dartmouth.edu/~xia/papers/vlcs14-hilight.pdf) [excerpt only].
- InFrame++ uses complementary frames and flicker fusion, and a later critique says it requires a high-end transmitter at about 120 FPS — [InFrame](https://www.cs.purdue.edu/homes/chunyi/projects/inframe.html) [excerpt only]. Later work states throughput remained low for prior schemes — [MobiCom 2018](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf) [excerpt only].
- **Anti-camera displays are the mirror image.** Kaleido re-encodes video into frames that preserve the eye's view while degrading a camera's, by adding flicker and chromatic distortion only cameras capture — [Kaleido, MobiCom 2015](https://old.sigmobile.org/mobicom/2015/papers/p372-zhangA.pdf) [excerpt only].
- **Privacy filters:** some limit viewing to about 30 degrees and black out at 30–45 degrees off-axis, are designed to stay clear for the person directly in front, and leave a person directly behind with a line of sight; sunlight weakens them — [Lenovo](https://www.lenovo.com/us/en/glossary/why-do-i-need-computer-privacy-screen/index.html) (vendor text). A 2026 two-week study calls filters partial shoulder-surfing prevention and studies perception, not measured angles — [arXiv 2602.08465](https://arxiv.org/pdf/2602.08465) [excerpt only]. Note that these are stated ranges, not tests against a camera.

### Inferences
- Any hidden channel that a phone can read can be read by a second phone. A synchronised, keyed display would need the secret that encryption already needs, so it adds cost and takes bandwidth (about 1 Kbps would mean over an hour for 600 KB), and it needs high-refresh panels the stick cannot assume. Do not build it.
- Kaleido-style tricks work against all cameras, including the writer's own phone.
- **Reveal-on-hold** (stream shows only while a key is held): I found no product precedent. It stops a code from being left on screen, makes starting deliberate, and limits the recording window. It does not stop a filmer present during the transfer. With sealing, it is a tidy UX with no meaningful security role and should not be advertised as protection.
- A privacy filter blocks the phone less than it blocks a neighbour, because the phone is head-on, so it could be a real, cheap suggestion. It may raise read errors, which needs testing. Nobody has shown it stops a camera placed behind the writer.
- What a filmer still learns from a sealed stream: that an export took place, when, and roughly how large it was. Padding to fixed size buckets hides length at the cost of a longer stream.
- A camera on the keyboard reveals a per-print code, and only design 1 is immune. Cameras aimed at keyboards are a threat because they can capture the stick's unlock passphrase too. That concern applies to the whole appliance, not this channel.

### Gaps
- No measured study was found of QR read range, covert filming distance, or filters versus cameras. Could a phone across a reading room really read a dense code? This could be tested simply, and matters less once sealing is in place.
- HiLight, InFrame and Kaleido figures are from abstracts and excerpts, not the evaluation sections.

## Deniability and per-file safety when carrying an outbox; secure deletion on flash

### Takeaway
Plan on deletion from flash never being reliable. Safety has to come from never writing plaintext there and destroying keys; a sealed outbox achieves that, because the stick cannot read back what it has sealed. Deniability on a flash stick is mostly not credible.

### Cited Findings
- Wei et al. found single-file sanitisation "consistently fail[s]" on SSDs. Built-in commands work but are sometimes implemented wrongly, and overwriting the whole visible address space twice is usually, not always, enough — [Wei et al., FAST 2011](https://static.usenix.org/event/fast11/tech/full_papers/Wei.pdf) [excerpt only].
- A conference report says the best overwrite protocol left up to 4.1% of data on an SSD and 8.9% on a USB flash drive — [The Nightmare of Undead Data](https://www.ehrscience.com/2011/09/14/the-nightmare-of-undead-data-2/) (secondary; a 2011 result on older devices).
- A commentary on the same paper argues encrypted filesystems are essential on flash — [DSHR's blog](https://blog.dshr.org/2011/02/fast11.html). Tails removed its wiping tools on the same reasoning — [Tails docs](https://tails.net/doc/encryption_and_privacy/secure_deletion/) [excerpt only].
- The cryptsetup FAQ says it is "unclear" how to run LUKS or plain dm-crypt on SSD and flash "with the full set of security assurances intact" — [cryptsetup FAQ](https://codegraph.jelmer.uk/cryptsetup/2:2.8.7-1/FAQ.md) [excerpt only]. The volume key is random and wrapped by each keyslot, so passphrases do not derive it — same source.
- age generates a fresh ephemeral secret for each stanza and file — [age spec](https://github.com/C2SP/C2SP/blob/main/age.md).
- SecureDrop's old guide advises decrypting to the persistent volume rather than to the USB stick, since decrypted copies left on it could be recovered — [older SecureDrop guide mirror](https://trankmichael-github.readthedocs.io/en/stable/journalist.html).

### Inferences
- **Per-file safety:** an outbox of age files sealed to the phone needs no deletion to be safe. Holding the stick, even with the unlock passphrase, opens nothing in the outbox, because neither the ephemeral secret nor the phone's private key is on the stick. The ephemeral secret must stay in RAM and never reach flash.
- This protects the outbox but not the library: a coerced unlock still reveals the writer's texts on the stick. The outbox's real gain is that it can sit outside the encrypted volume, so a borrowed computer can copy it without any unlock.
- **Metadata leaks in an unencrypted outbox:** file count, sizes and dates, and any file name. Put the name and original details inside the seal, use random or sequential outside names, pad sizes, and write a neutral timestamp.
- **Deniability:** an outbox full of encrypted files on a stick with a bismillah label denies nothing about existence. Hidden volumes on wear-levelled flash could leave comparison traces, and that claim should be checked before anyone relies on it. I would not promise deniability, and I would state that in the writer's terms rather than leaving it vague.
- A passphrase-bearing outbox (design 2) would weaken this, since a stored passphrase-derived key lets someone with the unlock read it. Derive per print from a code that is never stored.
- Do not offer a "delete export" button that implies more than it does. Honest copy: removing it from the list; the file was already safe because it is sealed.

### Gaps
- Wei et al. tested 2011 devices, and I found no recent measurement of consumer USB sticks. No measurement of LUKS keyslot remnants on flash was retrieved.
- VeraCrypt's own hidden-volume warnings were not retrieved.
- Coercion and legal aspects of deniability were not researched.

## Reproducible integrity: proving the receiver holds the exact text

### Takeaway
An AEAD proves the file was not corrupted, without any human step, and a few check words shown on both screens add human assurance. The check should be computed under the file key, because a plain plaintext hash shown on a filmable screen would let an attacker confirm a guessed text.

### Cited Findings
- age's chunks are authenticated and a stream without a valid final chunk must error, so corruption and truncation are detected — [age spec](https://github.com/C2SP/C2SP/blob/main/age.md).
- age has no sender authentication; the header MAC is keyed from the file key and does not identify a sender — [age spec](https://github.com/C2SP/C2SP/blob/main/age.md).
- The ASCII-armored form of age is malleable unless strict PEM and canonical base64 are enforced — [age spec](https://github.com/C2SP/C2SP/blob/main/age.md).
- By contrast, Key Teleport has only 2-byte checksums and sends no length, leaving truncation open — [firmware docs](https://raw.githubusercontent.com/Coldcard/firmware/master/docs/key-teleport.md). BBQr has no checksum at its layer and relies on QR error correction — [BBQr spec](https://raw.githubusercontent.com/coinkite/BBQr/master/BBQr.md). Cimbar corrects transmission errors with Reed-Solomon and fountain codes but describes no cryptographic hash — [libcimbar README](https://raw.githubusercontent.com/sz3/libcimbar/master/README.md).
- A third-party tool adds SHA-256 on top of cimbar — [libcimbar README](https://raw.githubusercontent.com/sz3/libcimbar/master/README.md).
- Foundation lists "How do I know when it's complete?" among the questions QR users face — [Foundation](https://foundation.xyz/blog/from-qr-air-gapping-to-quantumlink-what-comes-next).

### Inferences
**Recommended layered proof:**
1. **Frame layer:** fountain code and QR error correction, which only make the transfer succeed.
2. **File layer:** AEAD, whose success means every byte matches what was sealed, including BOM, CRLF and vocalisation marks, since the plaintext is treated as opaque bytes and never as text. Any normalisation in the receiver's save path breaks this, so the receiver must save bytes and not pass them through a text widget.
3. **Human layer:** 4–6 check words on both screens.
   - **Do not show a bare hash of the plaintext.** A filmer who suspects the text (a known scripture passage, a leaked draft) could confirm it. Compute `HMAC(file-key-derived key, plaintext)` or hash the ciphertext. The hash of ciphertext is simple but only proves ciphertext identity; the keyed form ties to plaintext, and the phone can compute it after decrypting.
   - **Length:** corruption is covered by the AEAD, so the words mainly catch wrong-file and wrong-version mistakes and give the writer visible proof. About 33 bits (three 11-bit BIP-39-style words) suffices against accidents; about 55 bits (five words) if an attacker is considered. Arabic-script or English wordlists would need a decision, and the wordlist is a design choice.
4. **Inside the seal:** original name, byte length, a hash of the plaintext, the stick's save revision and a format version. This lets the receiver report "exact file, N bytes" and lets the writer see whether the export reflects the latest save, without exposing the name to a filmer.

**Forgery:** because the phone's key is public, anyone who has it can seal a file to it. A malicious display cannot forge the stick's own exports unless it swaps the stream, a low threat for a phone pointed at the writer's own screen. If that matters, the stick can sign with a device key shown at pairing (one more check-word comparison). Inner-layer signing adds complexity, so I would defer it.

**Honest status:** the stick cannot learn that the phone received anything, since the channel is one-way. It can only say "shown". "Confirmed" must be something the writer does after comparing words, in keeping with the app's honest-save rule. For the same reason the stick must never delete the source or mark it exported on its own evidence.

### Gaps
- I found no usability study comparing check-word lengths for humans comparing two screens. Whether a writer really compares them is unknown.
- No source covers how Coldcard or Passport display verification hashes in detail; wallet "verify what left" practice remains unresearched beyond what is cited here.
