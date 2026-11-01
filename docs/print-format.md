# The print format, version 2

How a document crosses from a screen to a phone's camera (ADR-0021). This describes what `crates/bismillah-print` does, and `tests/fixtures/print/` holds vectors a reader can be built against. The channel is one-way: the sender never learns what arrived.

**Nothing has been released in this format.** Print to Phone is offered only by debug builds, so version 2 can still be replaced outright. Once a released phone app reads it, any change needs a new version number.

## The layers

Text goes through four layers, and a reader undoes them in reverse:

```
the document's bytes
  → envelope: CBOR, holding the name, the SHA-256 and the bytes as raw DEFLATE
    → fountain parts: BC-UR, each one a text string
      → QR codes, shown one after another
```

## 1. The bytes

Whole document: the bytes a save would write, so the line endings and any BOM arrive as they are on disk. Selection: the selected text with the document's line ending, and no BOM, because a BOM only starts a file. Nothing is normalised. An empty text is refused, so a print always holds at least one byte.

## 2. The envelope

A definite CBOR array of exactly six items, with nothing after it:

| # | Item | CBOR type | Meaning |
|---|---|---|---|
| 0 | version | unsigned integer | `2`. A reader refuses any other |
| 1 | name | text | The document's file name, or in a run its path in the library. For showing and for linking versions, never as a path on a disk |
| 2 | selection | bool | `true` if this is part of a document |
| 3 | digest | bytes, 32 long | SHA-256 of the bytes in layer 1, before compression |
| 4 | deflated | bytes | Layer 1 as raw DEFLATE (RFC 1951), with no zlib or gzip wrapper |
| 5 | place | null, or an array of 3 | In a *Print whole library* run: the run's ID (bytes, 16 long), this text's index from 0, and how many texts the run holds. The index is below the count, and a selection has no place |

**A run** is every text as its own print, one after another, round and round. The ID is the first 16 bytes of a SHA-256 over each name's length, name and digest, so the same library makes the same run and a changed one another. Each text gets at least two frames a fragment and at least two seconds, and one frame a fragment more each round, so a camera that missed one catches it later. A reader counts places, and tells the writer which it lacks by index plus one, the number the sender shows. Nothing comes back, so the writer goes to that number by hand.

**Versions** of a document are linked by name: the same name with a different digest is a new version, and never replaces the old one. A file carries no ID of its own, and nothing may be added to it, so a renamed file starts a new document on the phone. The same bytes under two names are two documents.

The digest is over the uncompressed bytes, so a reader needn't produce the same DEFLATE output as the sender, and no reader should compare it. The digest doesn't cover the name, the selection flag or the place: *Exact* is a claim about the text alone.

### Sealed

A paired sender wraps that envelope before layer 3 (ADR-0023). The message is then a definite CBOR array of exactly three items, with nothing after it:

| # | Item | CBOR type | Meaning |
|---|---|---|---|
| 0 | version | unsigned integer | `3` |
| 1 | encapsulated key | bytes, 32 long | HPKE's `enc` |
| 2 | sealed | bytes | The whole version 2 envelope, sealed with its tag |

It's RFC 9180 in base mode: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and ChaCha20-Poly1305, with the info string `bismillah-print sealed 3` and empty associated data. A random key is made for every seal, so two showings of one text never match, and frames from them don't combine.

**The key as typed** is Bech32m with the prefix `bk` over the 32 bytes of the X25519 public key: 61 characters, read in any case, ignoring spaces and dashes. **The check words** are the first four bytewords of the first four bytes of SHA-256 over `bismillah phone key` and the key's bytes.

A seal hides a text, and doesn't say who made it: anyone with the public key can seal to it.

## 3. The fountain

The envelope is the message of a [BC-UR](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md) multi-part encoding, of type `bismillah-print`, made by the `ur` crate 0.5.2. The UR type and the framing around it follow that specification, with these specifics:

- **Fragments.** The message is cut into K fragments of equal length, no longer than the density's `fragment_bytes`, with the last padded with zeros. Padding is checked on reassembly.
- **Parts.** Parts are numbered from 1, without end. Parts 1 to K carry one fragment each. Later parts XOR a pseudorandom set of fragments, chosen from the sequence number and the message's CRC-32 (Xoshiro256\*\*, as BC-UR specifies). So any large enough set of parts rebuilds the message, and the order doesn't matter.
- **A part's body** is a CBOR array of sequence, K, message length, the message's CRC-32 and the fragment data, as minimal bytewords: two letters a byte, ending in that body's own CRC-32.
- **A part's text** is `UR:BISMILLAH-PRINT/<sequence>-<K>/<bytewords>`, in capitals. Every character is then in QR's alphanumeric set, which holds more than bytes do. Readers lower-case it before decoding.

A message of one fragment is still written as multi-part, `1-1`. The same message and fragment size always give the same parts, so a reader can combine frames from two showings of one print. A different size gives a different K and can't be combined: resizing the window starts a new stream.

## 4. The codes

| Density | QR version | Modules a side | `fragment_bytes` |
|---|---|---|---|
| 0 | 20 | 97 | 570 |
| 1 | 15 | 77 | 325 |
| 2 | 10 | 57 | 140 |
| 3 | 6 | 41 | 45 |

- Error correction is level L in every code. The fountain replaces a lost frame, so the code's own correction needn't carry that load.
- The quiet zone is 4 modules on each side. Modules are black on white in every theme.
- The dialog uses the densest size whose module is at least 4 device pixels (`MIN_MODULE_PIXELS`), and whole device pixels only.
- A message of one fragment is one still frame. Longer ones play at 6 frames a second (`FRAMES_PER_SECOND`), and rest after five minutes, or wait for the writer under reduced motion.

The frame rate, the 4 pixel floor and the densities are **provisional** until a real phone has read them (mobile/PLAN.md, M2). They're the sender's choice, and a reader mustn't depend on them: it reads any QR version and any K within the limits below.

## What a reader must do

Every frame comes from a camera, which sees whatever is in front of it, so each is untrusted.

1. **Ignore what isn't ours.** Other codes, other UR types, damaged parts and any part whose checksum fails change nothing.
2. **Check K before decoding.** Refuse a part that claims more than `MAX_FRAGMENTS` (65,536). The `ur` decoder allocates by the K a part claims, before anything has checked it.
3. **Treat a stray as a stray.** A frame from another print doesn't discard progress. Three in a row mean the writer has started something else, or resized the window, so the reader starts over on that print.
4. **Check in this order:** if the version is `3`, open the seal, and refuse alike a print sealed to another key and one that was altered. The contents must be a version 2 envelope, never another seal. Then the array's shape, the version, then inflate no further than `MAX_TEXT_BYTES` (64 MiB), so a small message can't claim gigabytes. Then compare SHA-256. Trailing bytes, a digest of the wrong length and an empty text are all refusals.
5. **Store only what passed the digest,** as bytes, without decoding and re-encoding them.
6. **Never use the name as a path,** and show it as plain, isolated text. It came through the air. It can hold `..`, `/`, control characters or direction marks. A folder is part of the name, and exists only in what the reader shows.
7. **Start afresh after a whole or refused message,** so that one bad print can't block the next.

A sender refuses what a reader would refuse: longer texts and larger K are errors in `envelope` and `Printer::new`, because the writer shouldn't spend hours showing a print no phone will take.

`bismillah_print::Receiver` and `open_with` do all of this except storing.

## Test vectors

Each file in `tests/fixtures/print/` holds `name`, `selection`, `density`, `bytes` and `message` (both in hex), then the first `part` lines, in order. `the_shared_vectors_still_hold` checks them against the encoder. `cargo run -p bismillah-print --example vectors` rewrites them, only for a new format version.

| Vector | Holds |
|---|---|
| `short` | One short Latin line, as one still frame |
| `vocalised-selection` | Vocalised Arabic with an Arabic file name, marked as a selection |
| `bom-crlf-many` | A BOM, CRLF and mixed script, over many frames |
