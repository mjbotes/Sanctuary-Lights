# Looks, cues and scenes

## The idea in one minute

| Word | What it is | Where |
|---|---|---|
| **Light** (fixture) | One lamp, patched at a DMX address | Patch tab |
| **Group** | A named set of lights: *Front wash*, *Back wash*, *Movers* | Program tab |
| **Look** | A whole-stage state you can reuse: *Verse*, *Chorus*, *Sermon* | Songs tab (Looks) |
| **Song** | A list of sections, each showing a look | Songs tab |
| **Cue** | A step in the GO list, for services without songs (or plays, events) | Cues & Scenes tab |
| **Scene** | A button that adds lights on top of anything: *Pulpit*, *Baptism pool* | Live tab |
| **Service part** | Worship, Sermon, Video…: what drives the lights now | Service bar |

Most churches use **looks + songs + service parts**, and a few **scenes**. The cue list is there if you prefer a theatre-style GO button.

## 1. Patch: tell it about your lights

On the **Patch** tab, under **Add lights**:

1. Choose the **type** (e.g. *LED par Dim+RGB (4ch)*), how many, a name, the **universe** and the **DMX start address**. Leave the address empty to use the next free one.
2. **Add.** Each light shows its address (e.g. `1.5` = universe 1, address 5). Set the light itself (its menu or DIP switches) to the same address and the same channel mode.
3. **Arrange stage:** drag each light to where it hangs, as seen from the audience. This is the 2D map used everywhere.

### Fixture types

The built-in types cover common LED pars, dimmers, moving heads and hazers. For anything else:

- **Search the library:** type your light's name in the box under *Fixture types* (e.g. *Chauvet SlimPAR*, *Rogue R2 Wash*, *ADJ Mega Par*). It searches the free **Open Fixture Library** (about 650 lights). Tap your light and tick the mode it is set to. Adding a light needs the internet once; after that it's kept on the computer. Pixel bars and LED panels with many cells are included: all their cells show the light's colour.
- **Import GDTF / OFL…** (Patch → Fixture types) takes:
  - a `.gdtf` file from the manufacturer or gdtf-share.com
  - an Open Fixture Library `.json` file: on open-fixture-library.org, find your light and choose *Download → OFL JSON*

  Pick the mode your light is set to. Colour wheels, CMY, gobos, prisms, shutters and 16-bit channels are understood.
- **Type your own:** in *Fixture types*, list the channels in the order the manual gives them, e.g. `dim red green blue white strobe=0 -`.
  - `strobe=0` sets a starting value.
  - A number such as `255` always sends that value.
  - `-` is an unused channel.

## 2. Program: set the lights

On the **Program** tab:

1. **Select lights:** tap them on the stage map (the order you tap is remembered, which matters for effects), tap a **group**, or use **All**. Save the current selection as a group with **+ Save group**.
2. Set **intensity**, **colour** (swatches, the colour picker, or **P / S / T** for the palette colours) and, for moving heads, **pan / tilt** (or **Centre**), **zoom** and so on.
3. What you set here is the **programmer**. It sits on top of everything until you **Clear selected** or **Clear all**.

> **Use P, S and T** (primary, secondary, tertiary) instead of fixed colours where you can. Each song has its own three colours, so one *Chorus* look then shows every song in its own colours. See *Palette colours* below.

## 3. Save it

Under **Save what's on stage**:

| Button | Saves | Used for |
|---|---|---|
| **+ Record from stage** (Songs tab → Looks) | The whole stage, as a **look** | Song sections, service parts |
| **Record new cue** | The whole stage, as a **cue** after the current one | The GO list |
| **Update current cue** | Overwrites the current cue with the stage | Fixing a cue |
| **Save as scene** | Only the lights you changed, as a **scene** | Extra buttons on the Live tab |

Effects that are running and live colours are saved too, so a *Chorus* look can pulse on the beat.

**Improving a look** updates every song that uses it. Recording it again with the same name (or using **Update**) is enough.

## 4. The cue list (GO)

The **Live** tab's **GO** button (or the space bar) steps through the cue list. **◀ Back** goes back. On the **Cues & Scenes** tab you can rename, reorder and delete cues, and set their timing:

| Column | What it does |
|---|---|
| **Fade** | Seconds for lights to change and get brighter |
| **Down** | Separate fade for lights getting dimmer (empty = same as Fade) |
| **Delay** | Wait before the cue starts |
| **Follow** | Go to the next cue by itself after this many seconds |
| **Notes** | A reminder for the operator: "Go when the pastor stands up" |
| **Timecode** | Go automatically at this timecode (see [Songs → Timecode](songs.md)) |

**Tracking** (the switch above the list): each cue stores only what changed, and the rest carries on from earlier cues, like a theatre console. Change a light once and it carries forward. Tick **Block** on a cue to make it a complete look again.

**Fade out cue list** fades the cue list to dark.

## 5. Scenes

Scenes are buttons on the **Live** tab that switch on **on top of** whatever is running: the cue list, songs, service parts.

- Each light takes the **highest** intensity of the scene and what's underneath; colours blend with the scene's level.
- Scenes have a fader, so you can bring them in partway.
- **Release all** turns every scene off.

Good scenes: *Pulpit special*, *Baptism pool*, *Choir*, *Band only*, *House lights*.

## Palette colours (P, S, T)

The three colours at the bottom of every screen are the **primary**, **secondary** and **tertiary** colours.

- **Each song has its own palette.** Tap a swatch to change it for the current song. With no song picked, you're changing the default that new songs start with. **↺** puts a song back to the default colours.
- Lights set to P, S or T in a look **stay linked**: change a song's primary and everything using it changes, even live.
- ProPresenter colour sync can set the primary colour from the screen (see [ProPresenter](propresenter.md)).

## How everything stacks

From bottom to top:

1. **The base:** the cue list, a song section's look, or a service part's look.
2. **Scenes**, on top.
3. **Presets from pads**, and **live group colours**.
4. **The programmer** (Program tab).
5. **Effects and group faders** (live control).
6. **Flash**, then **screen protection** (lights aimed at a screen are switched off).
7. **The service part's brightness** (e.g. Video at 10%), then the **Master** fader and **Blackout**.

Next: [Songs](songs.md).
