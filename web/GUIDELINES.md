# bismillah — design inspiration for the website

The film sets the scene. The website should feel like the same night: a city lit by a thousand screens,
and one page of light where a person still writes. This folder holds what to borrow from the film: the
intention, the colours, the type, the pictures and the rules we kept while making it.

Look at `moodboard.jpg` (the film in order) and `palette.jpg` first.

## The film

**Watch it first:** [the film (cut v35, 2:15)](public/media/film/cut-v35/film-av1.mp4), the copy the site
plays.

The film is made in the author's separate film project. When it is updated, the site's copy is encoded
again from its master (`scripts/media.sh`).

## The intention

The film is not an advertisement. It is a cause: **writing is thinking, and stopping to write is
stopping to think.** The editor is not sold. It is shown in use, by a mother, at night, for her son.

A visitor should leave feeling what the film leaves you with: a little stillness, a little resolve, and
a wish to write something themselves. The site should never shout, hurry or persuade with tricks.

## Two worlds

Everything in the film belongs to one of two worlds. Keep them apart on the site too.

|             | **The night**                        | **The page**                               |
| ----------- | ------------------------------------ | ------------------------------------------ |
| What it is  | The city, the screens, the machine   | Her writing, the editor, the notebook      |
| Light       | Dark, cool, many small lights        | Light, warm paper, one source              |
| Feeling     | Noise, pull, sameness                | Quiet, attention, one line at a time       |
| In the film | The tower, the tablet, the dark chat | The editor, the ink, "Bismillah" in pencil |

**The page is the light.** The editor is always shown in light mode, against every dark world. The
machine is always dark. A visitor should read light as "hers" and dark as "the screens".

The site can move like the film does: it opens in the night and ends on the page.

## The arc (a shape the site can follow)

1. **The night.** The lit tower. One question: _How will we think?_
2. **The questions.** _Who remembers… Who attends… Who thinks…_
3. **The turn.** _Prompting is not thinking, writing is._
4. **The answers.** _I remember. I attend. I think._
5. **The film.** The whole story, in one place.
6. **The close.** _bismillah_ / _These words are mine._ And where to get it.

The questions say _we_; the answers say _I_. Keep that.

## Colour

See `palette.jpg`. Each colour has a place in the story:

- **The night** `#0A0D0C` and **the kitchen at night** `#0C1714`: the grounds of every dark section.
- **Cold screen** `#BCD5CA`: only for the machine's light. Use sparingly, never for her words.
  On the site, once: the machine's offer on her page, on the night.
- **Her shawl** `#56625D`: the quiet grey for secondary text in the dark.
  It is 3.07:1 on the night, so it is for text of 24px and up; small quiet text in the dark
  uses the same grey lit, `#72827C` (4.5:1 or more on every dark ground; the author's choice, 2026-10-28).
- **Her light** `#A6733A`: the one warm window. Use it once or twice on the whole site, never as decoration.
- **Dawn paper** `#AAB4A7`: the morning, the passing on. On the site, the film's small label over
  the lit tower, where the shawl's grey can't be read against a window.
- **The page** `#F7F6F2`, **ink** `#1E1E1E` and **the caret** `#1E6B4A`: her world, the product's own colours.
  The green caret is the only colour on the page, as in the app. After the name on the night,
  the logo's caret is the app's dark-theme green `#6FBF95` (the author's choice, 2026-10-29).
- **End card** `#151515`: where the film closes.

No gradients, glows or neon. Light in the film always comes from a real source: a lamp, a screen, a window.

## Type

- **Bismillah Duo** (in [`../fonts/build/`](../fonts/build/)) for everything that is writing: the questions, the answers, the lines
  from the film. It is the editor's own typeface, so the site and the app speak in one voice.
- **Amiri** (in [`../fonts/source/amiri/`](../fonts/source/amiri/)) for the basmala, which the site draws
  as an outline, so it loads no Arabic font.
- The name is always lowercase: **bismillah**, as on the film's end card. In running text it is set
  plain, like any other word: no bold, italics or capitals (only where it is the phrase is it
  _Bismillah_: the boy's notebook and the link preview).
- The scale grows from the writing size (20px, 17px on a phone). Titles are one step, 1.4 times it: the
  film's title, her last line and the stick's heading. The steps' titles are the editor's
  third heading size, and only the steps' numbers are larger than the titles. The name in the
  masthead is at the writing size, and quiet lines are 15px.
- Space shows what belongs together: half a line inside a group, two and a half or three lines between
  groups, so a picture is plainly part of its step and the stick's promises sit with what it is.
- Few sizes, generous space, one thought per line. Let lines arrive as if written, one at a time; never
  animate letters for show. On her page a line can arrive in two parts where the words turn:
  the three sentences that answer the three questions, and the line the machine offers to finish.

## Words

- The film's lines are fixed; reuse them exactly as they are:
  - How will we think?
  - Who remembers, when the page remembers for us?
  - Who attends, when the screen holds our eyes?
  - Who thinks, when the machine writes our words?
  - Prompting is not thinking, writing is.
  - I remember. I attend. I think.
  - These words are mine.
  - A thought I do not write is a thought I never had.
- **One intrusion, from the film** (the author kept it, 2026-10-30): at _Prompting is not
  thinking,_ the machine offers to finish her line with its first words back in the film (still
  `10-the-offer`): _but it can be a powerful starting point for deeper reflection._ In the
  machine's dark and cold light, on her page, for one stretch of scrolling. Then it is gone
  and she writes _writing is._ It is the only place the site shows what it refuses, and it says it
  in the film's words, so it needs no argument of its own. Only with the script; a screen reader
  and a visitor without the script read her line whole.
- The [manifesto](../MANIFESTO.md) is where these words came from. The site says it as the film
  does, in the film's lines, as she writes them (2026-10-29): they are the manifesto, so the site
  carries no longer text and no link to one. The one exception is the editor's screens, as her
  library: its sections, exactly as written, are her files there. The Zuhd screen shows the
  first, _Attention_, because Zuhd keeps a whole paragraph in ink and her page's lines are each
  one line, and the Files screen finds _Memory_ by four letters (the author, 2026-10-29). Its closing lines (_The book won for memory but we
  still remember. The word processor won for attention but we still attend. How will we think?_)
  stay in MANIFESTO.md.
- Short sentences. No marketing voice, no superlatives, no "revolutionary", no "AI-powered".
- Words must not read as machine-made (the author, 2026-10-31); [ia.net](https://ia.net/writer) is the
  model. The answer, often in a word or two, and only what the reader wants to know: technical detail
  stays in the README and PRIVACY.md (the author, 2026-10-31: "user doesn't bother"). Never the author's
  own equipment or anything else personal. Say no flatly, and let a dry line stand. Leave out lists of
  three, "it isn't X, it's Y", sentences built alike one after another, and reassurance nobody asked for.
- In what a visitor reads, bismillah is an **app**, never "the editor" (2026-10-29): a writer
  reads an editor as a person who changes their text, and the README calls it a writing app.
  "The editor" stays in the code and these notes.

## Pictures

- Use frames from the film (`media/stills/`), not new imagery. They already share one light and one world.
- **Except for instructions** (the author, 2026-10-28): where the site must show how to do something,
  like the stick's three steps, new pictures are generated in the film's world (her hands, the kitchen
  table, the lamp) but lit and framed for clarity: the object large, sharp and centred, one idea per
  picture. The film's rules still hold: no generated lettering (a screen shows the real app, laid on
  afterwards), no logos, modest dress. How they were made is in `src/assets/steps/PROMPTS.md`.
- **And for the laptop scene** (the author, 2026-10-29: "think Apple", authentic enough for
  Nolan, "viewed by humans"): what the app is for is shown one idea to a moment, as an Apple
  commercial would, never as a row of screenshots: her, the film's protagonist, in a real
  place, with one plain act of hers or the app's real screen at its own size, close enough
  to read. Physically right (the screen faces her), readable at a glance on a phone, no
  metaphor to decode, the film's grade lightened for the page. How they were made, and what
  the rounds taught, is in `src/assets/scenes/PROMPTS.md`.
- **The opening shot** (2026-10-30, for the author's review) is the film's own first shots at the
  visitor's pace: the tower's lights going out over the real still (only dimmed, no new picture),
  her in the one left lit, her room, her hands. The picture on the first screen holds still under the
  scroll; nothing is drawn on it but the dark.
- People are always dressed modestly; the women wear niqab or hijab. Faces are rarely seen; hands, eyes and
  silhouettes carry the story.
- Never use the usual "AI" imagery: brains, circuits, robots, sparkles, glowing particles.
- Pages full of writing are shown soft and out of focus. The only handwritten word that is ever legible is
  "Bismillah".
- Good images for the first screen: the tower at night (`01`), her window (`02`), the boy's notebook (`22`).
  The notebook (`media/poster.jpg`) is the poster for the film.

## Motion and sound

- Motion is slow, like the film's camera: a gentle push in, never a swipe or a bounce. One thing moves at a time.
- `media/loop-tower-night.mp4` and `media/loop-tower-dawn.mp4` are short silent loops: the lit tower, and
  the same tower at dawn with one window lit. Together they are the whole story in two images.
- The film carries a hymn of male voices. Never play sound on its own; let the visitor choose it.
- Silence is better than a bad sound.

## The questions

After the stick, the page answers what it leaves open, each answer folded under its question, so
someone with no questions passes a quiet list (the author, 2026-10-31, in place of a line the
visitor could write on, which made no sense there). The answers are short, and still true: where a
full answer would take a paragraph, the question asks only what can be answered honestly in a line.

The site expects its readers to know what bismillah means and its Islamic foundations (the author,
2026-10-31). It never explains them, here or anywhere else.

## What the site must never do

The site should keep the promises the editor keeps:

- No trackers, no ads, no pop-ups, no newsletter nagging, no cookie walls.
- No chat assistant or anything that writes for the visitor.
- Nothing that asks for attention: no countdowns, no "only today", no badges.
- It should be calm, quick and readable on a phone, and fine to read without the film.

## Still to decide

- The web address. Where to get it is decided in shape (the author, 2026-10-28): three numbered steps,
  each with a picture, a USB stick, one command from this site that puts bismillah on it, and the
  laptop started from it, with "Get the bismillah app" always in reach. The section's heading and
  the first and third steps' details come from the stick's README (2026-10-29: _The bismillah
  stick_, the stick's size and the erasing, the boot menu); the steps' titles are still to write,
  and so are the command, the second step's words and the download's size and checksum, which
  wait for a published image (os/PLAN.md, "Open questions"). Beside the name on the first screen is what it is, in plain words: _A writing app that
  never writes for you._ (2026-10-29, from the README; until then _These words are mine._, which
  now ends the page). The film's title
  is _Prompting is not thinking, writing is._ (the author, 2026-10-28), so a visitor knows what
  the site and the film are before anything plays. Before the film plays,
  a small label (what it is and how long; never "promo"), the title and the play button sit together
  on the picture, on the play button's translucent night, and leave together when it plays: the one
  place words sit on a picture.
- What it is, in plain words (the author's request for a storytelling pass, 2026-10-29): a
  writing app, beside the name; the README's _A typewriter, with only the best of the
  computer_ over the laptop, answering her page's _How will we think?_, and opening the
  link preview, before _Nothing writes for you._; and the stick said as what it does: the
  laptop started from it becomes that typewriter. The page ends on the page, after the stick and
  its questions: _These words are mine._ in the editor's type with its caret after it, and no
  picture and no footer below (the author, 2026-10-29). The dawn loop and then the
  boy's notebook were tried there first; both needed the film to mean anything, and the site never
  introduces the boy.
- ~~A short, honest note that the film's pictures, voices and sound were made with AI tools.~~ Decided
  2026-10-28: the site carries no such note.

## In this folder

- `moodboard.jpg`: the film in order, one frame per beat.
- `palette.jpg`: the colours, named by where they appear in the story.
- `media/stills/`: full-size frames from the film, numbered in story order.
- `media/poster.jpg`: the poster frame for the film.
- `media/loop-tower-night.mp4`, `media/loop-tower-dawn.mp4`: short silent loops of the tower.
- The fonts are the editor's own, in [`../fonts/`](../fonts/).
