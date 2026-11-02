# Physical channels from a computer to a nearby receiver, without radio, network or sound drivers

Scope: published mechanisms and measurements only, considered as a deliberate feature for a writer moving their own text. Researched 2026-10-31. Rates come from the primary papers wherever the PDF text could be read. Each figure is labelled **measured**, **project-stated** (a README claim with no test), **theory** or **inference**.

Almost all of these papers are attack research. Their test machines are mostly desktops, their test payloads are short, and they report bit error rate (BER) rather than byte-exact file transfer. No paper I read moved a 50 KB file. Every 50 KB figure below is my arithmetic.

## Memory and CPU emissions received by radio: System Bus Radio, AirHopper, GSMem, USBee, RAMBO. Does an unmodified phone receive any of them? What would an RTL-SDR do?

### Takeaway
No current unmodified phone receives any of these with its built-in radios: GSMem needs replaced baseband firmware on a nine-year-old phone, AirHopper needs an FM chip that recent phones mostly lack or disable, USBee and RAMBO need an SDR, and System Bus Radio an AM receiver. An RTL-SDR is directly demonstrated only for USBee (80 B/s measured); every faster memory-bus result used a better SDR.

### Cited Findings
- **System Bus Radio (mechanism):** memory-write instructions radiate, and the program modulates them as a square wave. Received on a Sony STR-K670P AM receiver at 1580 kHz. Measured "clear transmission over two meters of open air or one meter through drywall" on a 2015 MacBook Air. No data rate is stated; it plays tones. — [fulldecent/system-bus-radio](https://github.com/fulldecent/system-bus-radio)
- **System Bus Radio (crowd results):** the project's test table has 42 entries, mostly 5–30 cm in the 1530–1610 kHz band. Linux laptops include an Acer Aspire 5750 at 30 cm and an HP ProBook 4340s at 6–7 inches ("very orientation-dependent"). Four reports found no signal, including a Raspberry Pi and two runs with SDRs. — [TEST-DATA.tsv](https://raw.githubusercontent.com/fulldecent/system-bus-radio/main/TEST-DATA.tsv)
- **AirHopper (measured):** 13–60 bytes/s at 1–7 m, from pixel patterns radiated by an *external video cable* (VGA, HDMI or DVI), received in the 87.5–108 MHz band. — [AirHopper](https://arxiv.org/pdf/1411.0237)
- **AirHopper (receiver):** Samsung Galaxy S3 with a Silicon Labs Si4705 FM chip and stock Android 4.1.2, with headphones as the antenna. The authors reached an internal Samsung FM service and patched the framework (smali) to record FM audio and tune nonstandard frequencies, so this was not a stock app. — [AirHopper](https://arxiv.org/pdf/1411.0237)
- **AirHopper's units reconcile:** 13–60 B/s equals the 104–480 bit/s quoted in GSMem's comparison table. — [GSMem](https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-guri.pdf)
- **GSMem, phone (measured):** 1–2 bit/s at 1–5.5 m. The phone was a Motorola C123 running a modified OsmocomBB baseband, described as "a nine year old low-end phone, the only available alternative with open source firmware". Transmitter: multi-channel RAM bus on Intel i7 desktops, with no elevated privileges. — [GSMem](https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-guri.pdf)
- **GSMem, dedicated receiver (measured):** 1000 bit/s at 2.6 m with BER about 0.087% on a USRP, and over 30 m range at lower rates. — [GSMem](https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-guri.pdf)
- **USBee (measured):** the sender only writes crafted data to a USB device, with no firmware change and no privileges beyond creating a file on removable storage. The receiver was a "$30 RTL-SDR" on a laptop, running GNU Radio. The paper's text states "an effective rate of 80 bytes / sec" and its abstract says 20–80 bytes/s. — [USBee](https://arxiv.org/pdf/1608.08397)
- **USBee conflict:** LED-it-GO's comparison table lists USBee at 4800 bit/s, while BitJabber lists 640 bit/s. Only the 640 bit/s figure matches USBee's own 80 B/s. — [LED-it-GO](https://arxiv.org/pdf/1702.06715); [BitJabber](https://cs.vuse.vanderbilt.edu/koutsoxd/www/Publications/bitjabber.pdf)
- **RAMBO (measured, three PCs on Ubuntu 18.04):** receiver was an Ettus B210 USRP with a small antenna, and SNR ran from 38 dB at 50 cm to 8 dB at 700 cm. — [RAMBO](https://arxiv.org/abs/2409.02292)
  - t = 10 ms (100 bit/s): 0% BER out to 700 cm.
  - t = 5 ms (200 bit/s): 0% to 200 cm, 3–4% at 450 cm.
  - t = 1 ms (1000 bit/s): 0% to 200 cm, 2–4% at 300 cm.
  - 5000 bit/s and above: "mostly above 5% BER".
- **RAMBO's own file figure:** a 40,000-bit (5 KB) document takes 400 s, 200 s or 40 s at those three speeds. Its conclusion says "hundreds bits per second" while its abstract says 1000. — [RAMBO](https://arxiv.org/abs/2409.02292)
- **BitJabber (measured, two Dell desktops with DDR3):** 100,000 bit/s B-FSK at about 0.3% error and 300,000 bit/s M-FSK at under 1%, using a LimeSDR-USB with a 400–1000 MHz log-periodic antenna. Exploitable range was "around 3 meters" through a metal case and over 8 m through tempered glass, and it worked through a 15 cm concrete wall. The word "laptop" does not appear in the paper. — [BitJabber](https://cs.vuse.vanderbilt.edu/koutsoxd/www/Publications/bitjabber.pdf)
- **COVID-bit (measured):** CPU load shapes switching-regulator emissions in the 0–60 kHz band, from "an ordinary user-level process". The receiver was a Samsung Galaxy A01 or a laptop with a roughly $1 small loop antenna in the 3.5 mm jack. — [COVID-bit](https://arxiv.org/pdf/2212.03520)
  - Desktops: 500 bit/s at 0.01–0.8% BER and 1000 bit/s at 0.8–1.78% BER.
  - Laptop (Dell Latitude with a 65 W adapter): 100 bit/s at 0% BER, with SNR falling from 40 dB adjacent to 5 dB at about 1 m.
  - The paper's prose claims 500 bit/s at 0% BER, which its own Table VII contradicts.
- **Noise-SDR (measured):** unprivileged DRAM access shaped into standard protocols, received on a USRP B210. The laptop (HP ENVY) was weak: most protocols have no entry for it, and THOR4 at 14 wpm reached 8 cm. On a desktop, real LoRa moved 16 bytes in 1.928 s at 120 cm. — [Noise-SDR](https://www.s3.eurecom.fr/docs/oakland22_camurati.pdf)
- **RTL-SDR hardware:** R820T-family tuners cover 24–1766 MHz, V3/V4 dongles add reception below 24 MHz, stable bandwidth is 2.56 MS/s, price is about $30, and Android apps exist. — [rtl-sdr.com](https://www.rtl-sdr.com/about-rtl-sdr/)
- **FM on phones today:** many phones have FM hardware that is disabled, budget models are likelier to keep it, and iPhones have never had usable FM. These are consumer sources, not measurements. — [PhoneCompass](https://phonecompass.com/phones/p/do-phones-have-fm-radio/); [Mobility Arena](https://mobilityarena.com/android-device-doesnt-radio-fix-app/)

### Inferences
- **USBee is the most interesting fit for this stick.** It needs only the USB storage driver already in the image, and the boot stick itself would be the antenna. It costs repeated flash writes, and the receiver is an SDR rather than a phone.
- **RTL-SDR against RAM (theory, not measured).** A DRAM clock is half the transfer rate, so DDR3-1600 sits at 800 MHz and DDR4-3200 at 1600 MHz, both in range. DDR5-4800 (2400 MHz) and LPDDR5-6400 (3200 MHz) are above 1766 MHz at the fundamental. A dongle's weaker front end should give shorter range than the B210 figures, and Noise-SDR's device table shows spread-spectrum clocking on its laptop and desktop, which works against a narrow receiver.
- **AirHopper and TEMPEST-style cable channels need an external monitor,** because they rely on a VGA or HDMI cable that a laptop's internal panel does not expose.
- **COVID-bit is the closest thing to "phone plus a coin's worth of wire".** Most new phones lack a 3.5 mm jack, and a USB-C audio adapter may or may not pass that band; neither case is tested.

### Gaps
- I found no paper that measures RAMBO, GSMem or BitJabber signals on an RTL-SDR, or any of them on a modern LPDDR5 laptop.
- USBee's paper has no BER or distance table. A search summary gave "up to nine feet", which I could not trace to the paper.
- The COVID-bit BER tables I read do not state the distance per row.

## Display emissions: TEMPEST, TempestSDR, Soft Tempest, Deep-TEMPEST. Rates and receiver.

### Takeaway
TEMPEST, TempestSDR and Deep-TEMPEST reconstruct images and have no data rate, and their text error rates rule out byte-exact use. The only rates are Soft Tempest's roughly 50 bit/s on a CRT and TEMPEST-LoRa's up to 21.6 kbit/s from an external video cable to LoRa gear, which is genuinely fast but is a radio transmission to non-phone hardware.

### Cited Findings
- **Soft Tempest (1998):** dithered pixel patterns broadcast tones from a CRT to an AM receiver. "Typical bit rates that can be obtained are of the order of 50 bit/s." The paper presents this as an order of magnitude, not a modern measurement. — [Kuhn & Anderson](https://www.cl.cam.ac.uk/~mgk25/ih98-tempest.pdf)
- **Tempest for Eliza:** a CRT monitor transmitting AM audible on a simple radio; no data rate reported. — [ODINI, related work](https://arxiv.org/pdf/1802.02700)
- **Deep-TEMPEST:** recovers HDMI screen content from emissions. Uses a USRP 200-mini at 50 MS/s, with GNU Radio's gr-tempest and a trained network, and reports a character error rate of about 35% for one evaluated model. Full-bit HDMI capture would need gigahertz bandwidth; a USRP X440 with 3200 MHz costs over $25,000. — [Deep-TEMPEST](https://arxiv.org/pdf/2407.09717)
- **Deep-TEMPEST improvement:** the average character error rate dropped by over 60 percentage points against earlier tools. — [Kaspersky](https://www.kaspersky.com/blog/deep-tempest-side-channel-hdmi/52058/)
- **TempestSDR:** an older RTL-SDR-compatible program that displays images from monitor emissions; no data rate. — [rtl-sdr.com](https://www.rtl-sdr.com/deep-tempest-eavesdropping-on-hdmi-via-sdr-and-deep-learning/)
- **TEMPEST-LoRa (CCS 2025):** pixel patterns turn a VGA or HDMI cable's harmonics into LoRa-compatible packets, with only the GPU path on the sender. Receivers were a COTS SX1262 node, an SX1302 gateway, or a HackRF. — [TEMPEST-LoRa](https://arxiv.org/pdf/2506.21069)
- **TEMPEST-LoRa rates (measured goodput over 1000 packets in office settings):** — [TEMPEST-LoRa](https://arxiv.org/pdf/2506.21069)
  - SF6/500 kHz: about 21.6 kbit/s at 10 m and 20.5–21.5 kbit/s at 20 m.
  - SF9/125 kHz: about 1150–1160 bit/s out to 40 m.
  - SDR-based custom packets: about 180 bit/s.
  - Maximum distance: 87.5 m with a COTS gateway, and up to 132 m in the comparison table.
  - The authors note the listed throughputs equal standard LoRa's theoretical ones.
  - Packet reception at SF6 stayed at 100% only for payloads up to 360 bits.
- **TEMPEST-LoRa typo:** the abstract says 21.6 kbps, while one sentence in the body says "21.6 bps". The tables settle it as kbps. — [TEMPEST-LoRa](https://arxiv.org/pdf/2506.21069)

### Inferences
- **Passive TEMPEST cannot carry a document intact.** A 35% character error rate on rendered text is useless for byte-exact transfer; any deliberate data channel would be a designed modulation like TEMPEST-LoRa.
- **TEMPEST-LoRa is the "wow" result but fails the promise twice:** it emits a LoRa-format radio signal from a stick that promises no radio, and it needs both an external monitor and a LoRa receiver. A LoRa node can cost little, but it is a second gadget.

### Gaps
- The word "laptop" does not occur in the TEMPEST-LoRa text. Whether an internal eDP panel radiates usably is not reported in anything I found.
- Regulatory status of deliberately radiating LoRa-format signals from a video cable was not researched.

## Magnetic: MAGNETO and ODINI, with a phone magnetometer as receiver. Measured bit rates.

### Takeaway
The phone magnetometer works, needs no special permission and no sender driver, but gives 5 bit/s only with the phone within 3 cm of a desktop, or about 1 bit/s reliably to 5 cm. That is days for a chapter, and ODINI's higher rates required a lab sensor.

### Cited Findings
- **MAGNETO setup:** Samsung Galaxy S4 with a Yamaha YAS532B magnetometer (sensitivity 0.15–0.25 µT), sampled at 100 Hz, in an Android app. Transmitter: desktop Intel i7-4770, four cores with eight threads, on Ubuntu 16.04, using CPU-load OOK. — [MAGNETO](https://arxiv.org/pdf/1802.02317)
- **MAGNETO BER (measured):** — [MAGNETO](https://arxiv.org/pdf/1802.02317)

| Rate | 1 cm | 5 cm | 10 cm | 12.5 cm | 15 cm |
|---|---|---|---|---|---|
| 0.2 bit/s | 0% | 0% | 0% | 10% | 30% |
| 1 bit/s | 0% | 0% | 20% | 20% | >30% |
| 5 bit/s | 0% | 20% | 30% | >30% | >30% |

- **MAGNETO close range:** 5 bit/s at 0% BER was achieved only at 0–3 cm. Heavy CPU background work cut SNR to about 3.4 dB. — [MAGNETO](https://arxiv.org/pdf/1802.02317)
- **MAGNETO permissions:** magnetometers "can be accessed with basic permissions", and it worked with the phone in a Faraday bag or airplane mode. — [MAGNETO](https://arxiv.org/pdf/1802.02317)
- **ODINI receiver:** a Honeywell HMR2300 lab sensor (about 70 nT resolution), not a phone. — [ODINI](https://arxiv.org/pdf/1802.02700)
- **ODINI BER (measured, PC-1):** 1 bit/s at 0% to 60 cm and 10% at 100 cm; 10 bit/s at 0% to 20 cm; 40 bit/s at 0% at 5 cm and 20% at 20 cm. — [ODINI](https://arxiv.org/pdf/1802.02700)
- **ODINI theory versus measurement:** a Shannon estimate gives 30–300 bit/s for desktops, with lower capacity for the laptop because it generates weaker fields. — [ODINI](https://arxiv.org/pdf/1802.02700)
- **ODINI headline conflict:** its summary table reads "40 bit/sec, 100 to 150 cm", while its own text says rates of 10 and 40 bit/s "are feasible only" at 5–20 cm. Treat 40 bit/s at 1 m as wrong. — [ODINI](https://arxiv.org/pdf/1802.02700)
- **Android sensor cap:** apps targeting API 31+ get at most 200 Hz from the magnetometer, gyroscope and accelerometer unless they declare `HIGH_SAMPLING_RATE_SENSORS`. The cap applies regardless if the user turns off microphone access. — [Android docs](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview)

### Inferences
- A laptop's weaker fields would make MAGNETO's desktop table optimistic, and I found no equivalent laptop table.
- The appeal is real: phone lying on the palm rest, no radio, no camera, no sound. But the sensor's bandwidth and 1/d³ field fall-off cap it at single-digit bit/s.

### Gaps
- No magnetometer measurements on current phones or ultrabook-class laptops were found.
- I could not confirm browser-based magnetometer access rates, so a "no app, just a web page" receiver is unverified.

## Acoustic without a sound driver: Fansmitter, DiskFiltration, coil whine, PC speaker, GAIROSCOPE. And ggwave and Quiet if sound were allowed.

### Takeaway
Driverless acoustic channels reach a stock phone microphone at 60 bit/s at best (POWER-SUPPLaY at 60 cm) and usually far less. Sound drivers would help only modestly, since ggwave's stated 8–16 B/s is about 1–2 times that; only high-order modems such as Quiet's profiles would be much faster, and I found no over-the-air measurement of those.

### Cited Findings
- **Fansmitter (measured):** Dell OptiPlex 9020 desktop, Galaxy S4 microphone at 44.1 kHz, in a lab with air conditioning and seven workstations. 15 bit/min at 1 m; 10 bit/min at 4 m and at 8 m. A low-RPM setting gave 3 bit/min. Abstract: "up to 900 bits/hour". Test payloads were 8 bits. — [Fansmitter](https://arxiv.org/pdf/1606.05915)
- **DiskFiltration (measured):** 180 bit/min (10,800 bit/h) up to 2 m to a Galaxy S4, near 0% BER at a 0.3 s bit time, using hard-disk actuator seek noise. SSDs "emit virtually no noise", so it needs a spinning disk. — [DiskFiltration](https://arxiv.org/pdf/1608.03431)
- **POWER-SUPPLaY, coil whine (measured):** CPU workload modulates the power supply's switching, from an unprivileged process, received on a Galaxy S7 microphone at 44.1 kHz. — [POWER-SUPPLaY](https://arxiv.org/pdf/2005.00395)
  - PC-1: 60 bit/s at 0% BER to 60 cm; 30 bit/s at 5–10% BER at 80–100 cm; 1–10 bit/s at 0% to 220 cm and 5% at 240 cm.
  - NUC: 50 bit/s at 10% BER at 100 cm.
  - PC-4: 5 bit/s at about 1.2% BER to 6 m.
  - Its abstract says "five meters" at up to 50 bit/s and its conclusion says 2.5 m at 50 bit/s; the tables do not support 50 bit/s at those distances on the PCs shown.
- **PIXHELL, screen coil whine (measured SNR, 2024–25):** crafted pixel patterns make an LCD emit 0–22 kHz, needing only the GPU path. Tested on three desktop monitors and a 40-inch TV at 0–2.5 m, at 5, 10 and 20 bit/s. SNR ranged from 5 dB (Samsung, 2.5 m, 20 bit/s) to 43 dB (TV, 0.5 m, 5 bit/s). — [PIXHELL](https://arxiv.org/pdf/2409.04930)
- **GAIROSCOPE (measured, requires a loudspeaker):** ultrasound above 18 kHz resonates phone gyroscopes, read at 500 Hz on OnePlus 7, Galaxy S9 and S10 (Android 9–10). — [GAIROSCOPE](https://arxiv.org/pdf/2208.09764)
  - Open room: 8 bit/s only up to 100 cm; at 1.4 bit/s the S9 had 0% BER to 200 cm, the S10 0% to 100 cm and 12.5% at 150 cm.
  - Narrow room (2×9 m): 1.4 bit/s out to 800 cm, with S10 reception described as "fragmented".
  - Summary claim: 1–8 bit/s at 0–600 cm.
- **PC speaker in this image (repo fact):** the stick's image removes the driver deliberately, with the comment that it "bypasses the absent ALSA sound drivers". — [os/mkosi/mkosi.conf line 155](../../mkosi/mkosi.conf); [os/TRIMMING.md](../../TRIMMING.md)
- **PC speaker in Debian's kernel:** `CONFIG_INPUT_PCSPKR=m` in the Debian 6.12.113 config. — [local config](../../spikes/boot/work/kdeb/boot/config-6.12.113+deb13-amd64)
- **PC speaker mechanism:** the driver programs PIT channel 2 and port 0x61 and accepts `SND_TONE` requests through the input layer. — [pcspkr.c](https://github.com/torvalds/linux/blob/master/drivers/input/misc/pcspkr.c)
- **PC speaker under lockdown:** `ioperm` and `iopl` check `security_locked_down(LOCKDOWN_IOPORT)`, so user code cannot reach port 0x61 directly under lockdown. — [ioport.c](https://github.com/torvalds/linux/blob/master/arch/x86/kernel/ioport.c)
- **ggwave (project-stated):** "between 8-16 bytes/sec depending on the protocol parameters", multi-frequency FSK with Reed-Solomon. Audible profiles start at 1875 Hz and ultrasonic at 15 kHz. — [ggwave](https://github.com/ggerganov/ggwave)
- **Quiet (no measurement found):** its README says ultrasonic profiles "encode data through a very low bitrate" above 16 kHz, and cable profiles use nearly the full soundcard spectrum. A profile is named `audible-7k-channel-0`, which suggests about 7 kbit/s but is not a measured result. — [quiet](https://github.com/quiet/quiet); [quiet-profiles.json](https://raw.githubusercontent.com/quiet/quiet/master/quiet-profiles.json)
- **Other acoustic results, secondhand:** GAIROSCOPE's comparison table lists MOSQUITO and ultrasonic speaker channels at under 1 kbit/s to 8–11 m, and AiR-ViBeR (fan vibration to a phone accelerometer) at 1 bit/s to 2 m. — [GAIROSCOPE](https://arxiv.org/pdf/2208.09764)

### Inferences
- **DiskFiltration does not apply:** the stick runs from USB flash and modern laptops use SSDs.
- **Fansmitter fits laptops poorly:** laptop fans are usually under firmware control, and the only tested machine was a desktop.
- **GAIROSCOPE and ggwave are excluded by the image,** since both need a working speaker path.
- **The PC speaker route needs the signed in-tree module back in the image.** That reverses a recorded trimming decision, and many laptops have no discrete beeper at all.
- **Android's 200 Hz cap** sits below GAIROSCOPE's 500 Hz sampling, so a store-distributed receiver would need the high-rate permission, and a browser version is unverified.

### Gaps
- I found **no published rate for a PC-speaker modem**. Any figure would be theory. Laptop routing of the legacy beep to a codec is also unmeasured.
- PIXHELL's BER per screen was not in the text I extracted; only SNR and the three rates were. Its "2 m" claim is the paper's. All its screens were monitors or TVs, with no laptop panel. Whether a modern laptop's coil whine carries POWER-SUPPLaY-level rates is untested.
- No independent over-the-air benchmark for ggwave or Quiet was found. A 2024 academic system (UltraComm) appeared in a search result at about 16.24 kbit/s on mobile devices, which I could not read in full.

## LED and light: keyboard LEDs (CTRL-ALT-LED), LED-it-GO, BRIGHTNESS and aIR-Jumper. Measured rates and receivers.

### Takeaway
Keyboard LEDs are the strongest fit here: 45–130 bit/s to a stock phone camera with three LEDs, 1.7–2.2 kbit/s with a photodiode, no radio, and only the input/LED path on the sender. Two items in the brief need correcting: BRIGHTNESS modulates pixels, not the backlight, and aIR-Jumper used security-camera IR, not laptop face-recognition emitters.

### Cited Findings
- **CTRL-ALT-LED, camera receivers (measured, four USB keyboards):** — [CTRL-ALT-LED](https://arxiv.org/pdf/1907.05851)
  - Galaxy S7 at 30–120 fps: 15–45 bit/s with OOK/FSK on one LED, 45–130 bit/s with three.
  - DSLR, security camera and HD webcam: 15 bit/s with one LED, 45 bit/s with three.
  - At 30 bit/s with BER ≤1%, the range was 0–9.5 m for Dell, Lenovo and Silverline keyboards and 0–6.5 m for Logitech.
- **CTRL-ALT-LED, light sensor (measured with Thorlabs PDA100A, zoom lens and a 1 MS/s NI capture system):** — [CTRL-ALT-LED](https://arxiv.org/pdf/1907.05851)
  - Dell: OOK 1666 bit/s at 3% BER; three LEDs 3411 bit/s at 2.4%.
  - Lenovo: OOK 2230 bit/s at 2.95%; three LEDs 4640 bit/s at 6.7%.
  - Logitech: OOK 2170 bit/s at 3.5%.
- **CTRL-ALT-LED, control path:** LEDs can be set through the keyboard driver's `KDSETLED` ioctl or standard USB HID requests, with no keyboard hardware or firmware change. All tests were on USB keyboards. — [CTRL-ALT-LED](https://arxiv.org/pdf/1907.05851)
- **Sender on this kernel:** `CONFIG_INPUT_LEDS=y` and `CONFIG_LEDS_CLASS=y` in Debian's 6.12 config, so input LEDs exist without new modules. — [local config](../../spikes/boot/work/kdeb/boot/config-6.12.113+deb13-amd64)
- **LED-it-GO (measured):** drives the hard-drive activity LED through disk reads with no kernel component. — [LED-it-GO](https://arxiv.org/pdf/1702.06715)
  - Galaxy S6: 15–60 bit/s.
  - GoPro Hero5: 100–120 bit/s.
  - Security camera, DSLR, webcam and Google Glass: 15 bit/s.
  - Photodiode (cheap Siemens SFH-2030 or Thorlabs PDA100A): under 4000 bit/s.
  - The rule of thumb used was two frames per bit.
- **BRIGHTNESS (measured):** alters each pixel's red channel by up to 3%, which is **pixel** modulation through the normal display path, not backlight control. — [BRIGHTNESS](https://arxiv.org/pdf/2002.01078)
  - Security camera and webcam: 5–10 bit/s at 1–9 m, 0% BER.
  - Galaxy S7: 1 bit/s at 0.3–1.5 m.
  - Tested on a 19-inch and a 24-inch monitor and a 40-inch TV.
- **Actual backlight modulation:** BRIGHTNESS cites Bak et al. (2019) on demodulating "backlight modulation of screen", but I found no rate from it. — [BRIGHTNESS references](https://arxiv.org/pdf/2002.01078)
- **aIR-Jumper (measured):** uses surveillance cameras' IR LEDs via the camera SDK; the evaluation rig was a Raspberry Pi driving a 140-LED IR projector. Galaxy J7: 15–20 bit/s OOK and 30–40 bit/s ASK. Other cameras: 15–20 bit/s OOK and 30–40 bit/s ASK. The abstract gives 20 bit/s per camera for exfiltration. — [aIR-Jumper](https://arxiv.org/pdf/1709.05742)
- **Rolling-shutter reception (not air-gap research):** Schmid, Arquint and Gross built a software-only phone receiver using rolling shutter and slow-motion video, reporting over 1200 b/s at up to 3 m. — [abstract](https://archive.cps-vo.org/node/38847)
- **Rolling shutter with a small LED:** Koizuka et al. describe LED-to-camera communication with a smartphone and a 5 mm LED, claiming over 10× earlier throughput. — [EWSN 2017](https://www.ewsn.org/file-repository/ewsn2017/248_249_koizuka.pdf)
- **Rolling shutter with a grouped array:** a Raspberry Pi camera with an 8×8 LED array reached 960–120 b/s at 20–100 cm. — [Teli et al.](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7348962/)

### Inferences
- **Laptop reality check:** many laptops expose only a Caps Lock LED, and some none. The one-LED phone figure (15–45 bit/s) is then the honest starting point, not 130 bit/s. An attached USB keyboard restores three LEDs. An internal PS/2-style keyboard's LED command speed is not measured in the paper.
- **The surprise worth a spike:** a Caps Lock LED read by rolling shutter on a stock phone could approach the 1 kbit/s region, since the LED can switch at about 1.7–2.2 kbit/s and slow-motion rolling shutter has reached 1.2 kbit/s. Nobody has published this exact pairing, and a tiny LED at phone distance may cover too few sensor rows.
- **The boot stick's own activity LED** could in principle act as an LED-it-GO transmitter if it has one. This is untested, and USB controllers may stretch or smooth the blink.
- **aIR-Jumper does not transfer to laptop face-recognition emitters:** driving them would need the camera stack the image excludes.
- **BRIGHTNESS is inferior to any visible on-screen code.** If the screen may be used at all, a camera reading deliberate screen patterns should beat 1 bit/s by orders of magnitude; that comparison belongs to the display-channel research.

### Gaps
- No published rate for laptop internal keyboards or laptop backlight PWM. The BRIGHTNESS search for backlight-to-ambient-light-sensor figures found none.
- Whether the stick's Wayland session can drive input LEDs without a privileged helper was not checked.

## Thermal: BitWhisper. Rates.

### Takeaway
1–8 bits per hour between two adjacent desktops, read by the receiver's own thermal sensors, with no phone involved. It is purely a curiosity.

### Cited Findings
- **BitWhisper (measured):** "at distance of 0-40cm at an effective rate of 1-8 bits per hour", between two computers using heat and built-in thermal sensors, and bidirectional. — [BitWhisper](https://arxiv.org/pdf/1503.07919)

### Inferences
- A phone has no equivalent exposed sensor path in this work, so the receiver would have to be a second PC sitting beside the laptop. At that point USB cables and many other paths win outright.

### Gaps
- I found no thermal channel to a phone, and did not look further given the rate.

## How long would a 50 KB chapter take at each measured rate?

### Takeaway
Time in seconds = 400,000 bits ÷ rate, from 50,000 bytes × 8 = 400,000 bits, before overhead. With an unmodified phone and no extra hardware, the best measured rates give about 51 minutes (three keyboard LEDs at the top of the range) to about 2 hours (POWER-SUPPLaY at 60 cm), while anything under 10 minutes needs extra hardware or an external cable.

### Cited Findings
Rates are from the sections above and their sources; the arithmetic is mine. "Stock phone" means no extra hardware, though a custom app is still needed.

| Channel and condition | Rate (bit/s) | 400,000 ÷ rate | Time | Receiver |
|---|---|---|---|---|
| BitJabber M-FSK, desktop | 300,000 | 1.33 s | 1.3 s | LimeSDR + antenna |
| BitJabber B-FSK, desktop | 100,000 | 4 s | 4 s | LimeSDR + antenna |
| TEMPEST-LoRa SF6, 10 m | 21,600 | 18.5 s | 18.5 s | LoRa gear + external cable |
| LED-it-GO photodiode | 4000 | 100 s | 1.7 min | Photodiode |
| Keyboard LEDs, 3 LEDs, Dell | 3411 | 117 s | 2.0 min | Lab light sensor |
| Keyboard LED OOK, Lenovo | 2230 | 179 s | 3.0 min | Lab light sensor |
| Keyboard LED OOK, Dell | 1666 | 240 s | 4.0 min | Lab light sensor |
| TEMPEST-LoRa SF9, 40 m | 1160 | 345 s | 5.7 min | LoRa gear + external cable |
| RAMBO t = 1 ms, ≤2 m | 1000 | 400 s | 6.7 min | USRP B210 |
| GSMem, 2.6 m | 1000 | 400 s | 6.7 min | USRP |
| COVID-bit, desktop | 1000 | 400 s | 6.7 min | Phone or laptop + loop antenna |
| USBee top | 640 | 625 s | 10.4 min | RTL-SDR |
| AirHopper top | 480 | 833 s | 13.9 min | Patched FM phone (Galaxy S3) |
| RAMBO t = 5 ms | 200 | 2000 s | 33.3 min | USRP B210 |
| USBee low | 160 | 2500 s | 41.7 min | RTL-SDR |
| Keyboard LEDs, 3 LEDs top, S7 | 130 | 3077 s | 51.3 min | **Stock phone camera** |
| ggwave top (needs sound) | 128 | 3125 s | 52.1 min | Stock phone mic |
| COVID-bit, **laptop** | 100 | 4000 s | 66.7 min | Phone or laptop + loop antenna |
| RAMBO t = 10 ms, 7 m | 100 | 4000 s | 66.7 min | USRP B210 |
| Noise-SDR LoRa, desktop | 66.4 (16 B ÷ 1.928 s) | 6024 s | 100 min | USRP B210 |
| ggwave low (needs sound) | 64 | 6250 s | 104 min | Stock phone mic |
| POWER-SUPPLaY, 60 cm | 60 | 6667 s | 1.85 h | **Stock phone mic** |
| LED-it-GO top, S6 | 60 | 6667 s | 1.85 h | **Stock phone camera** |
| Soft Tempest | 50 | 8000 s | 2.2 h | AM receiver and recorder |
| Keyboard LED, one LED top, S7 | 45 | 8889 s | 2.5 h | **Stock phone camera** |
| ODINI, 5 cm | 40 | 10,000 s | 2.8 h | Lab magnetometer |
| aIR-Jumper ASK top | 40 | 10,000 s | 2.8 h | Stock phone camera, but IR rig |
| Keyboard LED, ≤1% BER, 9.5 m | 30 | 13,333 s | 3.7 h | Cameras |
| PIXHELL top | 20 | 20,000 s | 5.6 h | Stock phone mic, desktop monitor |
| Keyboard LED, one LED low | 15 | 26,667 s | 7.4 h | **Stock phone camera** |
| BRIGHTNESS webcam, 9 m | 10 | 40,000 s | 11.1 h | Webcam |
| GAIROSCOPE ≤1 m (needs speaker) | 8 | 50,000 s | 13.9 h | Stock phone gyroscope |
| MAGNETO, ≤3 cm | 5 | 80,000 s | 22.2 h | **Stock phone magnetometer** |
| DiskFiltration | 3 (180/min) | 133,333 s | 37 h | Stock phone mic, needs HDD |
| GSMem on phone | 2 | 200,000 s | 55.6 h | Modified baseband |
| GAIROSCOPE long range | 1.4 | 285,714 s | 79.4 h | Stock phone gyroscope |
| BRIGHTNESS, S7 | 1 | 400,000 s | 4.6 days | Stock phone camera |
| MAGNETO, ≤5 cm | 1 | 400,000 s | 4.6 days | **Stock phone magnetometer** |
| Fansmitter, 1 m | 0.25 (15/min) | 1,600,000 s | 18.5 days | Stock phone mic |
| MAGNETO, ≤10 cm | 0.2 | 2,000,000 s | 23.1 days | **Stock phone magnetometer** |
| Fansmitter, 4–8 m | 0.167 (10/min) | 2,400,000 s | 27.8 days | Stock phone mic |
| BitWhisper top | 0.00222 (8/h) | 180,000,000 s | 5.7 years | Second PC |
| BitWhisper low | 0.000278 (1/h) | 1,440,000,000 s | 45.7 years | Second PC |

System Bus Radio has no measured data rate, so it has no row.

### Inferences
- **Compression helps.** I measured two project files with `zstd -19`: `docs/specimen.md` went from 4184 to 2326 bytes (1.8×) and `DESIGN.md` from 72,722 to 26,714 bytes (2.7×). This is a local spot check, not a study; a mixed-script chapter should sit somewhere in that range, so divide the table's times by about 2.
- **Error correction costs more than the raw table implies.** The binary symmetric channel limit is 1 − H(p), which gives a minimum overhead factor of 1.09× at 1% BER, 1.24× at 3%, 1.40× at 5%, 1.88× at 10% and 3.6× at 20%. Real codes need more than this minimum.
- **Byte-exactness needs framing.** These channels are one-way, so a whole-file checksum plus repetition or a fountain-style code is required. A dropped sync would otherwise restart the file.
- **Worked example:** three keyboard LEDs at 130 bit/s, compression 2×, 3% BER: 400,000 ÷ 2 × 1.24 ÷ 130 ≈ 1908 s ≈ 32 minutes, assuming the phone stays perfectly still. With one LED at 45 bit/s: about 92 minutes.

### Gaps
- No paper reports a sustained multi-hour run. Clock drift, thermal throttling, sensor auto-exposure and a person's patience are all unmeasured at these durations.

## Which channels would be genuinely usable as a product feature, and which are only fun to mention?

### Takeaway
None of them is a practical way to move a chapter to an unmodified phone. Keyboard LED to a camera is the only one I would prototype as a real, charming feature, and only for short texts (roughly a page to a few KB) unless a rolling-shutter spike beats the published rate. Everything electromagnetic works against the stick's central promise, even when it needs no radio driver.

### Cited Findings
- The measured evidence for each verdict is in the sections above, chiefly [CTRL-ALT-LED](https://arxiv.org/pdf/1907.05851), [LED-it-GO](https://arxiv.org/pdf/1702.06715), [COVID-bit](https://arxiv.org/pdf/2212.03520), [USBee](https://arxiv.org/pdf/1608.08397) and [POWER-SUPPLaY](https://arxiv.org/pdf/2005.00395).
- The paper authors themselves scope most of these to small secrets. MAGNETO is "only relevant for the exfiltration of a small amount" of data, and aIR-Jumper suits "passwords, PINs, encryption keys". — [MAGNETO](https://arxiv.org/pdf/1802.02317); [aIR-Jumper](https://arxiv.org/pdf/1709.05742)
- The stick's image deliberately removes the PC-speaker driver, along with network, Bluetooth and NFC drivers. — [os/mkosi/mkosi.conf](../../mkosi/mkosi.conf)

### Inferences

**Plausible feature, needs a spike**
- **Caps Lock to phone camera, for short pieces.** No radio, visibly honest (the writer can literally see it blink), no new kernel modules. Measured 15–130 bit/s. A 2 KB poem (16,000 bits) takes about 2–18 minutes before compression, and a 50 KB chapter takes hours on a one-LED laptop. It needs a phone receiver, which is a project in itself since the promise is "unmodified phone" and not "unmodified phone plus our app". Whether a web page reading the camera at high frame rate is enough is unverified.
- **Keyboard LED to a small photodiode dongle.** The only option here that is simultaneously radio-free, driver-free and under 10 minutes for a chapter: about 3–4 minutes raw and about 2–3 minutes after compression plus overhead, using the lab figures. The catch is a purpose-made receiver and aligned optics, since the paper's rig was a lab sensor with a zoom lens. A cheap sensor is unproven at these rates for keyboard LEDs, although LED-it-GO's cheap SFH-2030 worked on a disk LED.

**Works, but wrong for this product**
- **USBee, RAMBO and COVID-bit.** Nice numbers (10–67 minutes), and the sender needs no driver at all. But the stick would be *deliberately radiating the writer's text* in a way anyone nearby could receive, and it would need an SDR or loop antenna on the receiving end. The honest statement would change from "no radio" to "no radio driver", which is a lawyer's distinction the promise should not rely on. Plaintext would also be broadcast, so encryption and key exchange become part of the feature.
- **TEMPEST-LoRa.** Fastest thing with cheap receivers, but it is an actual radio protocol from a video cable, on an external monitor, to a gadget.
- **POWER-SUPPLaY.** The best stock-microphone number (60 bit/s at 60 cm, about 1.85 h), but it means a loud-ish CPU load for hours, against the stick's quiet-laptop work, and laptop results are thin. Its 0–24 kHz band also includes the audible range.

**Only fun to mention**
- **System Bus Radio:** playing a tune on a nearby AM radio from a stick with no sound driver is a wonderful anecdote, and the honest limit is that no data rate exists. As an easter egg it still contradicts "no radio".
- **MAGNETO:** phone on the palm rest, no permissions, days per chapter.
- **PIXHELL:** a screen that sings. No laptop panels tested.
- **Fansmitter:** 18–28 days.
- **BitWhisper:** 5.7–45.7 years, and it needs a second PC.
- **Soft Tempest:** a CRT-era result.

**Not applicable to this hardware or image**
- **DiskFiltration:** needs a spinning disk.
- **GSMem:** needs a baseband rootkit on a 2006-era phone, so no real receiver exists.
- **AirHopper:** needs a patched FM phone and an external cable.
- **GAIROSCOPE and ggwave:** need a loudspeaker path the image excludes.
- **aIR-Jumper:** needs security-camera IR control.
- **BRIGHTNESS:** screen-based and far slower than a visible on-screen code.
- **PC speaker:** no published rate, and it reverses a recorded trimming decision.

**Design consequences if any channel ships (inference)**
- It should be an explicit act by the writer, visible on screen and off by default, because a transmitter is exactly what this appliance otherwise excludes.
- It should report success only after a whole-file check confirmed on the receiving side, in line with the project's "report save state honestly" rule. A one-way channel cannot itself confirm delivery, so the receiver must display a checksum for the writer to compare.
- A time estimate should be shown up front, since any stock-phone channel takes tens of minutes at best.

### Gaps
- No channel here has been tested on the stick or the author's Dell laptop, so all fit judgements are inference from other machines.
- My searches surfaced nothing newer than TEMPEST-LoRa (2025) and the PIXHELL journal version (2025) on rates, but I did not survey all 2026 literature, so a newer result could exist.
- Comparison with non-physical-side-channel routes (screen codes, USB storage) is outside this note's scope and belongs to the sibling research.
