# Songs

Plan the lights for every part of every song once, and they run by themselves every time the song is played.

## Make a song

On the **Songs** tab:

1. **+ Song**, then type its name. Use the same name as the ProPresenter presentation if you use ProPresenter.
2. Add its **sections** in order: Intro, Verse, Pre-Chorus, Chorus, Verse 2, Chorus 2, Bridge, Outro…
3. Each section picks a **look** by name: "Chorus 2" uses the "Chorus" look, "Verse 2" uses "Verse". Change it from the drop-down if you like, and set the **fade** time.
4. Optional:
   - the song's **BPM** (for effects that follow the beat)
   - its **palette colours** (the P / S / T swatches at the bottom)
   - **notes** for the operator

> **Tip:** make looks called Intro, Verse, Pre-Chorus, Chorus, Bridge, Tag and Outro once, and every new song is lit as soon as you add its sections.

## Let it light the song for you

Pick the song and tap **✨ Light this song for me** (under NEXT). Every section gets a look made from your lights and the song's colours:

| Section | What it gets |
|---|---|
| **Intro** | Low and atmospheric in the tertiary colour, slowly breathing |
| **Verse** | Faces lit warm, the band in the primary colour, calm |
| **Pre-Chorus** | Brighter, the secondary colour, a soft chase |
| **Chorus** | Everything up, primary and secondary, moving heads moving |
| **Bridge** | Tertiary, front lower, moving heads circling |
| **Tag / Vamp** | Primary and secondary alternating |
| **Instrumental** | A palette chase |
| **Outro** | Soft, house lights up a little |

How it works:

- **The lights are sorted by role.**
  - Lights downstage (or named *Front*) light faces in warm white, never coloured, so people stay visible.
  - Colour lights upstage take the song's palette.
  - Moving heads move in the big moments.
  - House lights stay low; pulpit specials stay off.
- **Sections of the same kind share a look**, e.g. *Way Maker · Chorus*. The looks are grouped under the song in the Looks list.
- **Colours stay linked to the palette:** change the song's P / S / T swatches and the whole design re-colours.
- **Tweak anything:** show a look, adjust it on the Program tab, then **Update**. Tapping ✨ again remakes the song's looks from scratch.

## Preview a song

**▶ Preview** steps through every section, four bars each at the song's BPM (4–12 seconds), so you can watch the whole design before Sunday. Switch the stage view to **3D** to see the beams. Tap **■ Stop preview** to stop.

## The demo song: Graves Into Gardens

**+ Demo song** (above the set list) adds *Graves Into Gardens* with a complete design that tells the story of the song, from the grave to the garden:

- **Palette:** gold (resurrection), garden green, and a deep violet for the grave.
- **Intro and verses:** almost dark and cold violet, with a first hint of gold in Verse 2.
- **Choruses:** warm and open, gold everywhere.
- **Interlude:** back to violet, with a slow heartbeat pulse.
- **Bridges 1 → 2 → 3:** green grows out of the dark three times. Bridge 3 is the garden: everything up, gold and green, moving and sparkling.
- **Outro:** soft gold and green, house lights coming up.

It contains the song's structure only, no lyrics or audio. Set the key and BPM from your chart, and change the sections to match your arrangement. The demo show (Setup → **Load demo**) includes it.

## Share a song with another church or campus

**Export song…** (in the song editor) saves the song, its sections, colours and looks as a `.slsong.json` file. **Import song…** (under the set list) opens one:

- **Same lights (same names):** the looks come in exactly as they were.
- **Different lights:** the design is rebuilt on your lights, with the same levels per role (front, back, moving heads, house), the same palette colours and the same effects.

Importing a song with a name you already have updates that song. **Undo** works if that wasn't what you wanted.

## Run a song

Pick the song in the set list (or let the tracks or ProPresenter pick it). Then:

- **Tap a section** to go there, or **NEXT** / the space bar for the next one.
- Or let the **tracks** or **ProPresenter** move through the sections by themselves.

### Follow mode: who's in charge

| Mode | What happens |
|---|---|
| **Manual** | Only taps change sections. MIDI from the tracks is ignored. |
| **Hybrid** | The tracks change sections; you can tap any section to override, and the next cue from the tracks takes over again. Recommended. |
| **Auto** | The tracks are in control and the section buttons are locked, so nobody can bump them. Master, Blackout, Flash and scenes still work. |

**Hold** ignores the tracks until you press it again. Use it for an unplanned extra chorus or a spontaneous moment.

> During **Sermon**, **Hosting** and other non-song [service parts](service-parts.md), the tracks and ProPresenter groups don't change the lights at all. Tapping a section yourself brings the worship lights back.

## Driving it from the backing tracks (MIDI)

Playback (MultiTracks), Ableton Live and most track apps can send a MIDI message at each section.

### What it understands

- **Notes by position (no setup):** **C1 (note 36)** triggers the song's first section, **C#1 (37)** the second, **D1 (38)** the third, and so on. You can change the first note in Setup.
- **Learn:** tap **Learn** next to a section, then play the part of the track that sends the message. Any note, CC or program change is remembered for that section.
- **Program change n** picks song number *n* in the set list (0 = the first). You can turn this off in Setup.
- **Channel:** listen to every channel, or just one (Setup → MIDI).

The **MIDI** light at the top flashes when something arrives, and the Songs tab shows what it did ("Great Song · Chorus" or "ignored: Hold is on").

### Ableton Live on the same Mac

1. Open **Audio MIDI Setup** → Window → **Show MIDI Studio**, double-click **IAC Driver** and tick **Device is online**.
2. In Ableton, make a MIDI track with **MIDI To** set to *IAC Driver (Bus 1)*.
3. At the start of each section, put a short note: C1 for the first section, C#1 for the second… (or any notes, and use **Learn**).

### Playback (MultiTracks)

- **Playback on the same Mac:** send its MIDI to the *IAC Driver* (as above).
- **Playback on an iPad:** on the lighting Mac, open Audio MIDI Setup → MIDI Studio → **Network**. Create a session, tick it, and allow the iPad. Then choose that session as Playback's MIDI output. A USB MIDI interface works too.
- Add a MIDI event at each section in Playback. Using the same note for every Chorus (and so on) and **Learn**ing it once is the quickest way.

## Timecode (MTC)

If your tracks or video server send **MIDI timecode**, tick **Follow MIDI timecode** in Setup.

- **Cues** with a timecode go at that time.
- **Songs** with a **Starts at TC** time (Tracks tab) follow their section markers against the timecode, so jumping around the timeline puts the right section up.

## Songs and ProPresenter

With ProPresenter connected:

- A presentation with the **same name** as a song picks that song.
- Its **slide groups** (Verse 1, Chorus, Bridge) move through the sections. "Verse 1" matches "Verse" or "Verse 1".
- **Make song from this presentation** (Setup → ProPresenter, while it's live) creates the song with one section per group.

See [ProPresenter](propresenter.md).

## Other apps (SuperRack, MainStage, Ableton)

Give each song a **MIDI out PC** (program change) on the Tracks tab, and choose the MIDI output in Setup. Picking the song then switches the other app's snapshot or set as well.

Next: [Service parts](service-parts.md).
