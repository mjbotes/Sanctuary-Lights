# Sanctuary Lights

A simple, free lighting controller for churches. It runs on a Mac, and volunteers run it from a web browser on that Mac **or from an iPad or phone** on the same Wi-Fi.

- **Live screen for volunteers:** a big **GO** button steps through the service cue list. Scene buttons ("Pulpit", "Baptism", "Worship wash") switch on over anything. There is a master fader and a blackout button.
- **Program screen:** tap lights on a stage map, then set intensity, colour (swatches or a colour picker), pan/tilt, zoom and haze. Save the result as a cue or a scene.
- **Output:** Art-Net, sACN (E1.31), and USB DMX widgets of the Enttec DMX USB Pro type.
- **Fixture types:** generic LED pars (RGB, RGBW, RGBWA+UV, with or without a dimmer channel), dimmers, moving-head wash and hazer, plus your own types typed in from the light's manual.
- **Saving:** the show saves automatically, with a backup each time the app starts. If the Mac restarts mid-service, the app reopens on the cue it was on.
- **No installs beyond Node.js:** the app has no other dependencies.

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
npm test            # unit tests (engine mixing, fades, patch, packet formats)
node server.js
```

Code layout:

- `lib/engine.js`: show data, cue and scene playback, mixing and DMX rendering
- `lib/output.js`: Art-Net, sACN and Enttec packets
- `lib/profiles.js`: fixture types
- `public/`: the browser app (plain HTML, CSS and JS, with no build step)
