# bismillah — design inspiration for the website

The film sets the scene. The website should feel like the same night: a city lit by a thousand screens,
and one page of light where a person still writes. This folder holds what to borrow from the film: the
intention, the colours, the type, the pictures and the rules we kept while making it.

Look at `moodboard.jpg` (the film in order) and `palette.jpg` first.

## The film

**Watch it first:** [the film (cut v22, 2:15)](/home/yunus/Work/director/productions/bismillah/renders/cut-v35.mp4)

- [Smaller copy for a quick look or for sharing](/home/yunus/Work/director/productions/bismillah/renders/cut-v35-540p.mp4)
- [The review room](https://claude.ai/artifact/QNweaFtV1LEx4Me71Gyozw): the film with every scene and decision.
  It is private; share it from its Share menu.

The film is made in the director project (`/home/yunus/Work/director`), so these links point there, to the
current cut. If the film is updated, they will be updated here too.

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
- **Her shawl** `#56625D`: the quiet grey for secondary text in the dark.
- **Her light** `#A6733A`: the one warm window. Use it once or twice on the whole site, never as decoration.
- **Dawn paper** `#AAB4A7`: the morning, the passing on.
- **The page** `#F7F6F2`, **ink** `#1E1E1E` and **the caret** `#1E6B4A`: her world, the product's own colours.
  The green caret is the only colour on the page, as in the app.
- **End card** `#151515`: where the film closes.

No gradients, glows or neon. Light in the film always comes from a real source: a lamp, a screen, a window.

## Type

- **Bismillah Duo** (in [`../fonts/build/`](../fonts/build/)) for everything that is writing: the questions, the answers, the lines
  from the film. It is the editor's own typeface, so the site and the app speak in one voice.
- **Amiri** (in [`../fonts/source/amiri/`](../fonts/source/amiri/)) for the basmala and any Arabic.
- The name is always lowercase: **bismillah**, as on the end card.
- Few sizes, generous space, one thought per line. Let lines arrive as if written, one at a time; never
  animate letters for show.

## Words

- Every word on the site is written by a person. The film's lines are already approved; reuse them as they are:
  - How will we think?
  - Who remembers, when the page remembers for us?
  - Who attends, when the screen holds our eyes?
  - Who thinks, when the machine writes our words?
  - Prompting is not thinking, writing is.
  - I remember. I attend. I think.
  - These words are mine.
  - A thought I do not write is a thought I never had.
- The [manifesto](../MANIFESTO.md) is where these words came from. Its closing
  lines belong on the site: _The book won for memory but we still remember. The word processor won for
  attention but we still attend. How will we think?_
- Short sentences. No marketing voice, no superlatives, no "revolutionary", no "AI-powered".

## Pictures

- Use frames from the film (`media/stills/`), not new imagery. They already share one light and one world.
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

## What the site must never do

The site should keep the promises the editor keeps:

- No trackers, no ads, no pop-ups, no newsletter nagging, no cookie walls.
- No chat assistant or anything that writes for the visitor.
- Nothing that asks for attention: no countdowns, no "only today", no badges.
- It should be calm, quick and readable on a phone, and fine to read without the film.

## Still to decide

- The web address, and the one line under "bismillah" that says what it is and where to get it.
- A short, honest note that the film's pictures, voices and sound were made with AI tools, while every word
  was written by a person.

## In this folder

- `moodboard.jpg`: the film in order, one frame per beat.
- `palette.jpg`: the colours, named by where they appear in the story.
- `media/stills/`: full-size frames from the film, numbered in story order.
- `media/poster.jpg`: the poster frame for the film.
- `media/loop-tower-night.mp4`, `media/loop-tower-dawn.mp4`: short silent loops of the tower.
- The fonts are the editor's own, in [`../fonts/`](../fonts/).
