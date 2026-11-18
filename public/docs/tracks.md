# Tracks

The **Tracks** tab plays your backing tracks itself, with no Ableton or Playback needed, and drives the lights from the timeline. It can also change a song's key and tempo, play a click and guide cues to the band's in-ears, send MIDI clock, and run a live vocal with auto-tune.

## Which computer plays the audio

Tick **This computer plays the audio** on the computer connected to the sound desk, and choose its **output device** (your audio interface). Every other screen (iPads, the lighting laptop) becomes a **remote** for play, stop, key, tempo and the mix.

## Set up a song

1. Make the song on the **Songs** tab, with its sections.
2. On **Tracks**, pick it and tap **+ Add tracks…**. Choose all its stems at once (WAV, AIFF, MP3, M4A, FLAC). They must all start at the same moment, as exported from your DAW or MultiTracks.
3. Set **Recorded in** (key, major/minor) and the original **BPM**.
4. Play, and at the start of each part tap the section's **⌖** to set its marker. Fine-tune by **dragging the marker** on the timeline: it snaps to the beat (hold Shift to place it freely).

As the tracks pass a marker, the lights go to that section.

## The mixer

Each stem has:

- a fader, a meter, mute and solo, and pan
- an **output**: send the click and guide to the in-ear outputs (e.g. 3-4), and the band to Main 1-2
- **Follows key:** untick it for click tracks (they then follow the tempo but keep their pitch)
- **Natural voice:** for vocal stems. When the key changes, voices keep their natural tone instead of sounding like chipmunks or giants. It's ticked automatically for stems named vocal, vox, guide, BGV, choir or lead.

## Change the key or tempo

- **Plays in − / +** moves the whole song by semitones.
- **Tempo − / +** changes the speed without changing the key. The markers move with the music.
- **Original** goes back.

The stems are re-rendered in the background. Rendered versions are kept, so they're instant next time, even after a restart. **Prepare set** renders every song before the service.

## Transport

| Button | What it does |
|---|---|
| **▶ Play / ■ Stop** | Play and stop. With a **count-in**, the click counts first. |
| **⏮** | Back to the start |
| Tap the timeline | Jump there |
| Tap a section name | Jump to it on the **next bar line**, so the band stays in time. A dashed line shows where; **Cancel** drops it. |
| **⟳ Vamp** | Repeat the current section until you press it again |
| **↻ Repeat** | Play this section once more when it ends |
| **⤼ Skip next** | When this section ends, skip the next one |

Want jumps to happen straight away? Set **Section jumps** to *Straight away* in the *Click, count-in & guide cues* panel.

## Click, count-in and guide cues

Open **Click, count-in & guide cues** under the timeline:

- **Time signature** and **first downbeat** (where bar 1 starts in the recording, in seconds).
- **Click:**
  - a click made from the song's tempo, with an accent on beat 1
  - its level and output (usually the in-ear mix)
  - follows tempo changes
- **Count-in:** one or two bars of click before the music starts.
- **Guide cues:**
  - Upload a spoken *Verse*, *Chorus*, *Bridge*… once; they're shared by every song.
  - Tick **Speak the section name a bar early**, and the band hears it before each section.
  - "Verse 2" uses the *Verse* cue.

## MIDI clock out

Under **MIDI clock** (left, on the audio computer), choose a MIDI output. Keyboards, effects pedals or Ableton then follow the song's tempo, with start, stop and song position, even after jumps. This needs Chrome, Edge or the desktop app.

## Live vocal with auto-tune

1. **Vocal on**, then choose the **input** (audio interface and channel) on the audio computer.
2. **Auto-tune:**
   - **Follow the song key** (recommended), or major / minor / chromatic
   - **Amount**
   - **Speed:** 0 = hard, robotic; 30–80 ms natural; 150 ms+ gentle

   The display shows the sung note and how much it's being corrected.
3. **Tone** (low, presence, air, compression) and **effects** (reverb, a delay in time with the song).
4. **Save for this song** remembers these settings with the song.

Changing the song's key moves the tracks, the auto-tune and the delay together.

Latency through the auto-tune is about 25 ms. That's fine in wedges, but singers may notice it in in-ears: feed their in-ears from the desk instead.

## Plugins (SuperRack, Ableton, MainStage)

The app can't host VST/AU/Waves plugins. Keep those apps running, give each song a **MIDI out PC** (program change), and choose the MIDI output in Setup: picking a song then switches their snapshots too.
