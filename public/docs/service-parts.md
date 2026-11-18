# Service parts

A service isn't only songs. During the welcome, the sermon, a video or a baptism, the lights need to do something different, and they shouldn't be jumping around with the slides or changing colour with the screen.

**Service parts** handle that. The **Service** bar at the top of the Live, Songs and Volunteer screens switches between them with one tap.

## The parts you start with

| Part | Lights | Songs change the lights? | Follow screen colours? |
|---|---|---|---|
| **Worship** | The song's looks | Yes | Yes |
| **Hosting** | Its own look (e.g. warm front light) | No | No |
| **Sermon** | Its own look | No | No |
| **Video** | Whatever is on, at **10%**: almost a blackout | No | No |

"Songs change the lights" covers MIDI from the tracks, track markers, ProPresenter slide groups and timecode. When it's off, all of those are ignored, so a stray slide or MIDI note can't change the lighting during the sermon.

## Add your own: baptism, communion, prayer…

Tap **+** at the end of the Service bar (or **+ Part** in Setup → Service parts) and pick a ready-made part:

| Template | Meant for |
|---|---|
| **Baptism** | Bright, clean light on the baptism area |
| **Communion** | Calm and warm; quiet music underneath doesn't change the lights |
| **Prayer** | Softer, at 60% |
| **Offering** | Steady light while the offering is taken |
| **Response** | Altar call or ministry time: songs still change the lights, screen colours don't |
| **Testimony** | Light on the person sharing or being interviewed |
| **Dedication** | Child dedication or a special moment at the front |
| **Kids** | Kids' talk, or kids leaving |
| **Pre-service** | Walk-in and countdown |
| **Post-service** | Walk-out |
| **Your own…** | Anything else: type a name |

If your show already has a look with the same name (e.g. a look called *Baptism*), the new part uses it straight away.

## Give a part its look

The quickest way:

1. On the **Program** tab, set the stage the way it should look (or show an existing look and adjust it).
2. In **Setup → Service parts**, tap **● Record look from stage** on that part.

That saves the stage as a look with the part's name, and switches to the part. **● Re-record look** updates it later. You can also choose any existing look from the part's drop-down.

## Settings for each part

In **Setup → Service parts**:

| Setting | What it does |
|---|---|
| **Name** | Shown on the Service bar. Tap it to rename. |
| **Look** | What the stage shows. *Keep the song / cue lights* leaves the lights as they are (used by Worship and Video). |
| **Brightness** | Overall level on top of the look. Video is 10%; Prayer might be 60%. |
| **Fade** | Seconds to change into this part. |
| **Songs change the lights** | Whether tracks, slide groups and timecode can change the lights. |
| **Follow screen colours** | Whether ProPresenter colour sync changes the lights. Switching to a part without it also drops the colour that came from the screen, so the part's look shows its own colours. |
| **Presentations named** | Words that pick this part from the ProPresenter presentation's name (see below). |
| **↑ ↓** | Order on the Service bar. |
| **×** | Delete the part. Its look stays. |

## Automatic with ProPresenter

Two switches at the top of Setup → Service parts (both on by default):

**Videos switch to the Video part while they play.**

- When a video plays on ProPresenter's main screen, the lights fade to the Video part.
- When it ends (or is paused for about a second), they go back to the part that was on before. A video during the sermon returns to the sermon lights.
- Audio-only items (songs, sound effects) are ignored.
- The Service bar shows **▶ Video playing: name**.

**Presentations pick the part.** When the operator moves to a new presentation:

- A presentation named like one of your **songs** → **Worship**.
- A name containing one of a part's **words** → that part. The defaults are:
  - **Sermon:** sermon, message, preach, scripture, reading, notes
  - **Hosting:** welcome, announcement, notices, offering, giving, host
  - The templates bring their own words (e.g. Baptism: baptism, baptise).
- A word only belongs to one part: adding an **Offering** part takes "offering" and "giving" away from Hosting.
- Other presentations leave the part as it is.

When ProPresenter switched the part, the Service bar shows **Auto: …** with the reason. You can always tap a part yourself; your tap wins until the next presentation or video.

## Other ways to switch

- **Tapping a song section** during a non-song part (e.g. the band starts the response song) brings the worship lights back by itself.
- **Stream Deck / Companion / TouchOSC:** send OSC `/sl/part "Sermon"` (name or number). See [Connections → OSC](connections.md).
- **Panic** always goes back to **Worship** at full brightness.

## Examples

**"When videos play we almost black out"**

This works out of the box: the **Video** part is 10% of whatever is on. For a specific video look instead (e.g. only blue backlight), record it on the Video part. For a full blackout, set its brightness to 0%.

**"During the sermon the lights shouldn't follow the screen colours"**

Also out of the box: **Sermon** has *Follow screen colours* off. Record a sermon look (warm white on the pulpit, a soft wash behind) with **● Record look from stage**.

**A baptism in the middle of worship**

Add **Baptism** from the templates, set up the pool lighting, and tap **● Record look from stage**. On the day, tap **Baptism** when it starts and **Worship** when the band plays again (or just tap the song section).
