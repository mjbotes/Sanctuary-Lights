# ProPresenter

Sanctuary Lights follows **ProPresenter 7** (version 7.9 or later) over the network. Nothing needs to be installed in ProPresenter.

## Connect

1. In ProPresenter: **Settings → Network**, tick **Enable Network**, and note the **port**.
2. In Sanctuary Lights: **Setup → ProPresenter**:
   - tick **Follow ProPresenter**
   - enter the computer running ProPresenter: `localhost` if it's the same computer, otherwise its IP address (e.g. `192.168.1.30`)
   - enter the port
   - **Save output settings**
3. The status line should say **● Connected (live updates)**. *Live updates* means slide changes arrive the moment they happen. With older ProPresenter versions it says *Connected*, and checks several times a second instead.

Both computers must be on the same network. Use the production network, not guest Wi-Fi.

## What it does

### Slides change the lights

When the operator clicks a slide, its **group** (Verse 1, Chorus, Bridge…) moves the lights to that section of the current song. "Verse 1" matches a section called *Verse 1* or *Verse*.

- A presentation with the **same name as a song** picks that song first.
- No matching song? A **look** with the group's name is used (e.g. a look called *Chorus*).
- Follow mode, **Hold** and [service parts](service-parts.md) are respected: during the sermon, slide groups are ignored.
- **Make song from this presentation** (in Setup, while a presentation is live) creates a song with one section per group, linked to looks with matching names.

### Videos dim the lights

While a video plays on the main screen, the lights fade to the **Video** service part (10% by default), and come back when it ends. See [Service parts](service-parts.md).

### Presentations pick the service part

A song's presentation means **Worship**; "Sermon notes" means **Sermon**; "Welcome" means **Hosting**. The words are yours to change. See [Service parts](service-parts.md).

### Screen colours on the lights (optional)

*Light colour follows the screen*:

- **ProPresenter group colour:** the colour each group has in ProPresenter (e.g. orange for every Chorus).
- **Colour of the slide on screen:** the strongest colour in the current slide image. Text and greys are ignored; a black-and-white slide gives white.

*…and it changes*:

- **the Primary colour:** everything using P (primary) follows. Recommended.
- **the live colour of these light groups:** only the groups you tick.

Colour sync only happens in parts with **Follow screen colours** on (Worship, by default). Switching to the sermon drops the screen colour, so the sermon look shows its own colours.

### The live slide on the 3D screens

Screens and LED walls in the 3D view can show the live slide. See [3D stage](stage-3d.md).

## Keeping light off the screens

**Setup → Lights pointing at screens**:

| Setting | What happens |
|---|---|
| **Warn** | Lights that would hit a projector screen or LED wall turn red in the 3D view |
| **Block** | Those lights are switched off while they point at a screen |
| **Ignore** | No check |

This needs the screens and lights placed in the 3D view. See [3D stage](stage-3d.md).

## Naming tips for the ProPresenter team

- Name song presentations **exactly** like the songs in Sanctuary Lights (capitals and punctuation don't matter).
- Use the standard group names: Intro, Verse 1, Pre-Chorus, Chorus, Bridge, Tag, Outro.
- Put words like **Sermon**, **Message**, **Welcome**, **Announcements**, **Baptism** or **Communion** in other presentations' names.

## Troubleshooting

| Problem | Check |
|---|---|
| *Not connected* | Network enabled in ProPresenter? Right IP and port? Same network? Firewall? |
| Slides don't change the lights | Is the song picked? Do the group names match the section names? Is the follow mode Manual, or Hold on? Is the current part one where songs don't change the lights? |
| Lights don't dim for a video | Is *Videos switch to the Video part* ticked (Setup → Service parts)? Is the video on the main presentation layer (not an announcement layer)? |
| Colours don't follow | Colour sync is off by default (Setup → ProPresenter), and only works in parts with *Follow screen colours* on. |
