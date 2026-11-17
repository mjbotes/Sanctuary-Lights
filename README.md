# Sanctuary Lights

A simple, free lighting controller for churches. It runs on a Mac, and volunteers run it from a web browser on that Mac **or from an iPad or phone** on the same Wi-Fi.

- **Songs that follow your backing tracks:** plan the lights for every Intro, Verse, Chorus and Bridge. **Playback** (MultiTracks) or **Ableton Live** triggers them over MIDI, or an operator taps them live, or a mix of both.
- **Live screen for volunteers:** a big **GO** button steps through the service cue list. Scene buttons ("Pulpit", "Baptism", "Worship wash") switch on over anything. There is a master fader and a blackout button.
- **Program screen:** tap lights on a stage map, then set intensity, colour (swatches or a colour picker), pan/tilt, zoom and haze. Save the result as a cue or a scene.
- **Output:** Art-Net, sACN (E1.31), and USB DMX widgets of the Enttec DMX USB Pro type.
- **Fixture types:** generic LED pars (RGB, RGBW, RGBWA+UV, with or without a dimmer channel), dimmers, moving-head wash and hazer, plus your own types typed in from the light's manual.
- **Saving:** the show saves automatically, with a backup each time the app starts. If the Mac restarts mid-service, the app reopens on the cue it was on.
- **No installs beyond Node.js:** apart from an optional MIDI module, the app has no other dependencies.

## Install on a Mac

1. Install **Node.js LTS** from <https://nodejs.org> (download the macOS installer and click through).
2. Copy the `church-lights` folder somewhere permanent, such as `Documents`.
3. Double-click **`start.command`**. The first time, macOS may block it: right-click it, choose **Open**, then **Open**.
   The app opens at <http://localhost:8080>. Keep the Terminal window open while you use it.
4. If macOS asks whether "node" may accept incoming network connections, click **Allow**. The iPad and the lights need this.

To run it from Terminal instead, use `node server.js`. To use a different port, use `PORT=9000 node server.js`.

## Connecting to the lights

You need something that turns the computer's output into DMX for the lights:

| Hardware | Settings in the Setup tab |
|---|---|
| **Art-Net node** (most common) | Tick Art-Net. "Send to" can stay as `255.255.255.255` (broadcast), or put in the node's IP. Most nodes call the first universe **0**, which is the default. |
| **sACN node**, or a console that receives sACN | Tick sACN and choose the network port the node is plugged into. |
| **Enttec DMX USB Pro** (or a compatible "Pro" widget) | Tick USB DMX and enter the device, e.g. `/dev/cu.usbserial-EN123456`. In Terminal, `ls /dev/cu.usbserial*` lists it. |

Tips:

- The Mac's network port must be on the same network as the node. Many Art-Net nodes ship with a `2.x.x.x` address; either set the node to your church network's addresses, or give the Mac a matching address.
- Cheap "Open DMX" USB cables (FTDI without the "Pro" processor) are **not** supported. Use a "Pro"-type widget or a network node.
- Setup → **DMX monitor** shows exactly what is being sent on each channel.

## Daily use

1. **Patch** tab: add your lights, set the type, universe and DMX start address to match each light's address, then click **Arrange stage** and drag them to where they hang.
2. **Program** tab: select lights or a group, then set intensity and colour.
   - **Record new cue** saves the whole stage look into the GO list, after the current cue.
   - **Save as scene** saves only the lights you changed, as a button on the Live screen.
3. **Cues & Scenes** tab: rename cues, set fade times, add operator notes ("Go when the pastor stands up"), and reorder or delete them.
4. **Live** tab: press **GO** (or the space bar).

How looks combine:

- The cue list sets the base look.
- Scenes add on top. Each light uses the highest intensity of the cue and any active scenes, and colours blend with each scene's fader level.
- Anything you are editing on the Program tab overrides both, until you press **Clear**.
- The master fader and Blackout scale intensity only.

## Songs and backing tracks (Playback, Ableton Live)

The **Songs** tab plans lights per song section:

- **Looks** are whole-stage states such as "Verse", "Chorus" or "Bridge". To make one, set the lights on the Program tab, then tap **+ Record from stage**. If you improve a look, every song that uses it gets the change.
- **Songs** are a set list. Each song has **sections** (Intro, Verse, Chorus, Verse 2…). Each section uses a look with its own fade time. Sections pick a look automatically by name ("Chorus 2" uses "Chorus"), and you can change it from a drop-down.

Choose how the lights follow the music with the **mode switch**:

| Mode | What happens |
|---|---|
| **Manual** | The operator taps sections (or presses NEXT / the space bar). MIDI from the tracks is ignored. |
| **Hybrid** | The tracks change sections automatically. The operator can tap any section to override; the next MIDI trigger takes over again. **Hold** ignores the tracks until you press it again, for example during a spontaneous extra chorus. |
| **Auto** | The tracks are in control and the section buttons are locked, so nobody can bump them. Master, Blackout and scenes still work. |

Scenes and the Program tab still work on top of any mode.

### What MIDI it understands

- **Notes, by position:** with no setup, note **C1 (36)** triggers a song's 1st section, C#1 (37) the 2nd, D1 (38) the 3rd, and so on. The first note can be changed in Setup.
- **Learn:** in the song editor, tap **Learn** next to a section and send any note, CC or program change from your track app. That message now triggers that section. A learned trigger only used in one song also jumps to that song.
- **Program change n:** selects song *n* in the set list (0 = first). You can turn this off, or Learn a trigger per song instead.
- **Channel:** you can listen on one MIDI channel only (Setup → MIDI). Note-offs, clock and timecode are ignored.

### Ableton Live on the same Mac

1. Open **Audio MIDI Setup**, then Window → **Show MIDI Studio**. Double-click **IAC Driver** and tick **Device is online**.
2. In Ableton, add a MIDI track and set **MIDI To** to *IAC Driver (Bus 1)*.
3. At the start of each section, put a short MIDI note (C1 for the 1st section, C#1 for the 2nd…), or use any notes and map them with **Learn**.
4. Sanctuary Lights listens on all MIDI inputs by default, so the **MIDI** light in the top bar flashes as the notes arrive.

### Playback (MultiTracks)

Playback can send MIDI to other gear. Check MultiTracks' help pages for where your version adds MIDI events or cues to a song. Point that output at the lighting Mac:

- **Playback on the same Mac:** send to the *IAC Driver* (see the Ableton steps above).
- **Playback on an iPad:** on the lighting Mac, open Audio MIDI Setup → MIDI Studio → **Network**, create a session, tick it, and allow the iPad under "Who may connect to me". Then choose that network session as Playback's MIDI output. A USB MIDI interface between the iPad and the Mac works too.
- Place a MIDI event at each section. The easiest way is to put the same note on each song's Chorus, Verse and so on, then use **Learn** once per section type.

### Setting up MIDI on the lighting Mac

`start.command` installs a small MIDI module the first time it runs, which needs internet once. If that isn't possible, open the controller in **Chrome or Edge** on the lighting Mac and tick **Use this browser's MIDI** in Setup. MIDI is then forwarded while that browser tab stays open.

## On an iPad

Join the iPad to the same Wi-Fi network. Open the address shown in Setup (for example `http://192.168.1.20:8080`) in Safari, then use Share → **Add to Home Screen**.

> Anyone on that Wi-Fi network can open the controller. Use a staff or production network rather than guest Wi-Fi.

## Files and backups

- The show is stored in `~/SanctuaryLights/show.json`. To keep it somewhere else, set `LIGHTS_DATA=/path`.
- Every start copies the show into `~/SanctuaryLights/backups/`, and the last 30 are kept.
- Setup → **Download backup** and **Load show file** move a show between computers.

## Custom fixture types

In the Patch tab, enter the channels in the order the light's manual lists them, for example a 7-channel par:

```
dim red green blue white strobe=0 -
```

| Token | Meaning |
|---|---|
| `dim red green blue white amber uv pan tilt zoom focus strobe haze fan` | controllable attributes (any other word also works and gets a slider) |
| `pan.fine` | fine (16-bit) channel for pan |
| `strobe=0` | starting value 0–255 |
| `255` | always send this fixed value (e.g. a "mode" or "shutter open" channel) |
| `-` | unused channel |

## Development

```
npm install         # optional: MIDI input module
npm test            # unit tests (mixing, fades, patch, songs/MIDI, packet formats)
node server.js
```

Code layout:

- `lib/engine.js`: show data, cue and scene playback, mixing and DMX rendering
- `lib/output.js`: Art-Net, sACN and Enttec packets
- `lib/profiles.js`: fixture types
- `lib/midi.js`: MIDI input (CoreMIDI, through the optional `@julusian/midi` module)
- `public/`: the browser app (plain HTML, CSS and JS, with no build step)
