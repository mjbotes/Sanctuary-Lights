# Sanctuary Lights

A simple, free lighting controller for churches. It runs on a Mac, and volunteers run it from a web browser on that Mac **or from an iPad or phone** on the same Wi-Fi.

- **Songs that follow your backing tracks:** plan the lights for every Intro, Verse, Chorus and Bridge. **Playback** (MultiTracks) or **Ableton Live** triggers them over MIDI, or an operator taps them live, or a mix of both.
- **3D stage view:** load your church as a 3D model (`.glb`, `.gltf`, `.obj`, `.3ds`), or import a whole rig from an **MVR** file. You see real coloured beams while you program and run the service.
- **FX & Presets:** dimmer/colour/position/beam presets that cues stay linked to, about 25 ready-made effects (including moving-head circles, figure 8, ballyhoo and sweeps), and an effect builder with waveforms, phase spread, groups and wings, and **selection tricks** (sort, shift, shuffle, block, groups, wings, width/parts, and From→To spreads for phase, speed, fade, delay and values).
- **Hot buttons:** Strobe and Flash on every screen, plus your own pads with keyboard shortcuts.
- **Live control:** every group gets a fader, colour buttons, a Flash button and effects (pulse, chase, sparkle, rainbow, movement) locked to a tempo. The tempo comes from TAP, the song's BPM or Ableton's MIDI clock. This works on top of anything that's running.
- **Live screen for volunteers:** a big **GO** button steps through the service cue list. Scene buttons ("Pulpit", "Baptism", "Worship wash") switch on over anything. There is a master fader and a blackout button.
- **Program screen:** tap lights on a stage map, then set intensity, colour (swatches or a colour picker), pan/tilt, zoom and haze. Save the result as a cue or a scene.
- **Output:** Art-Net, sACN (E1.31), and USB DMX widgets of the Enttec DMX USB Pro type (found automatically, no driver needed on a Mac).
- **Fixture types:** generic LED pars, dimmers, moving heads and hazers built in; import any light from a **GDTF** or **Open Fixture Library** file, or type your own from the light's manual.
- **Setup wizard and test page:** a few questions on first start, then one screen that shows whether DMX, MIDI, OSC, ProPresenter, timecode and audio are working, blinks each light, and plays test tones.
- **Safe for volunteers:** PINs for volunteers, operators and admins; **Undo**; a **Panic** button; automatic snapshots. If the app or the Mac restarts mid-service, it comes back on the cue it was on.
- **Saving and updates:** the show saves automatically, and the desktop app updates itself.
- **No installs beyond Node.js:** apart from an optional MIDI module, the app has no other dependencies.

## Desktop app (installer)

Download the installer from the repository's **Releases** page (or from the latest **Actions → Build installers** run, under *Artifacts*):

| System | File |
|---|---|
| Mac with Apple Silicon (M1–M4) | `Sanctuary-Lights-…-mac-arm64.dmg` |
| Intel Mac | `Sanctuary-Lights-…-mac-x64.dmg` |
| Windows | `Sanctuary-Lights-…-win-x64.exe` |
| Linux | `Sanctuary-Lights-…-linux-x86_64.AppImage` |

On a Mac, open the `.dmg` and drag **Sanctuary Lights** to Applications. It's a normal Mac app: it appears in the Dock, keeps running in the background without slowing down audio or lighting timing, and has its own menu (View → Toggle Full Screen).

- **First launch:** unless the build was signed with an Apple Developer certificate (see below), macOS blocks the app. Try to open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
- **Permissions:** allow the microphone (for vocals) and the local network (for Art-Net/sACN and iPads) when asked.

The app includes everything (no Node.js needed), and iPads can still connect to the address shown in Setup.

### Building installers with GitHub Actions

`.github/workflows/build.yml` runs the tests, then builds the macOS (Apple Silicon and Intel), Windows and Linux installers on GitHub's machines. Each run's installers are under **Actions → the run → Artifacts**. To publish a release:

```
git tag v1.0.0
git push origin v1.0.0
```

That creates a GitHub Release with the installers attached.

**Optional macOS signing and notarization** stops the "Open Anyway" step. It needs an Apple Developer account. Add these repository secrets:

| Secret | Contents |
|---|---|
| `MAC_CERT_P12_BASE64` | Developer ID Application certificate exported as .p12, base64-encoded |
| `MAC_CERT_PASSWORD` | Its password |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Apple team ID |

To build locally: `npm install`, then `npm run dist:mac` (or `dist:win` / `dist:linux`). `npm run app` runs the desktop app without packaging it.

**On a Mac, the easy way:** double-click **`build-mac.command`**. It installs what it needs and leaves `Sanctuary Lights-….dmg` in the `dist` folder.

> **If the macOS build on GitHub never starts** (it waits, then shows *cancelled* with no log), the account isn't allowed macOS runners on a private repository. macOS minutes cost 10× and a $0 spending budget blocks them. To fix it, do one of these:
>
> - make the repository public (GitHub's Mac runners are free for public repositories)
> - allow Actions spending under GitHub **Settings → Billing and plans**
> - build on a Mac with `build-mac.command`
>
> The Windows and Linux installers are unaffected.

## Install on a Mac (without the installer)

1. Install **Node.js LTS** from <https://nodejs.org> (download the macOS installer and click through).
2. Copy the `church-lights` folder somewhere permanent, such as `Documents`.
3. Double-click **`start.command`**. The first time, macOS may block it: right-click it, choose **Open**, then **Open**.
   The app opens at <http://localhost:8080>. Keep the Terminal window open while you use it.
4. If macOS asks whether "node" may accept incoming network connections, click **Allow**. The iPad and the lights need this.

To run it from Terminal instead, use `node server.js`. To use a different port, use `PORT=9000 node server.js`.

## First start: setup wizard and test page

On a new, empty show the **setup wizard** opens by itself (you can reopen it from **Setup → Test → Setup wizard…**). It asks:

1. What the room is called.
2. How the lights connect: USB-DMX, Art-Net, sACN, or not yet.
3. Which lights you have. Add each kind with a count; they get DMX addresses one after another. **Find** blinks a light so you can check it.
4. What tells the lights when to change: a backing-tracks app over MIDI, tracks played in this app, ProPresenter, or a volunteer pressing Next.

**Setup → Test** is the place to check everything before a service:

- **Inputs and outputs:** a green dot for each of DMX out, MIDI in, OSC in, ProPresenter, timecode and audio, with what last arrived.
- **Lights:** blink each light white at full (this works even in blackout), all together, or every light in turn with its name shown.
- **Sound** (on the computer playing the audio): a short test tone on each output pair (left, right, then both) and a mic level check.

## Connecting to the lights

You need something that turns the computer's output into DMX for the lights:

| Hardware | Settings in the Setup tab |
|---|---|
| **Art-Net node** (most common) | Tick Art-Net. "Send to" can stay as `255.255.255.255` (broadcast), or put in the node's IP. Most nodes call the first universe **0**, which is the default. |
| **sACN node**, or a console that receives sACN | Tick sACN and choose the network port the node is plugged into. |
| **Enttec DMX USB Pro** (or a compatible "Pro" widget) | Tick USB-DMX and plug it in. It is **found automatically** and reconnects if unplugged. Macs need no driver (the FTDI driver is built into macOS); Windows installs it through Windows Update. To use a particular one, enter the device in *Device*. |

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

## Cue timing, tracking and timecode

In **Cues & Scenes** every cue has:

| Column | What it does |
|---|---|
| **Fade** | Fade time for lights getting brighter or changing. |
| **Down** | Separate fade for lights getting dimmer (empty = same as Fade). |
| **Delay** | Wait before the cue starts fading. |
| **Follow** | Go to the next cue by itself after this many seconds (an auto-follow chain). |
| **Timecode** | With *Follow MIDI timecode* on (Setup), the cue goes when the timecode passes it. |

**Tracking** (switch above the cue list): each cue only stores what changed, and everything else carries on from the cues before it, like on a theatre console. Fix a light once and the change carries forward. Tick **Block** on a cue to make it a full look again (a clean starting point).

**MIDI timecode (MTC):** send timecode from Ableton, Playback, QLab or a video server to the MIDI input. Cues with a timecode go at their time. A song with a **start timecode** (Tracks tab) follows its section markers against the timecode. Jumping around the timeline puts the right cue or section up.

**Input from another lighting desk** (Setup): receive Art-Net or sACN from a console.

- **Merge:** the highest level wins on each channel.
- **Backup:** the desk is passed straight through, and Sanctuary Lights takes over if the desk stops sending.

## Importing fixture types (GDTF, Open Fixture Library)

**Patch → Import fixture file…** takes `.gdtf` files (from the manufacturer or gdtf-share.com) and Open Fixture Library `.json` files (open-fixture-library.org → a fixture → *Download → OFL JSON*). Choose the modes you want, and they appear in the list of fixture types, with colour wheels, CMY, gobo, prism, shutter and fine channels understood. MVR files with embedded GDTF bring their types in automatically.

## Access, undo and safety

- **PINs** (Setup → Access): give volunteers a PIN that only opens the **Volunteer** screen (big Next/Back buttons for the song or cue list, Panic and Blackout). Operators run everything during a service. Only admins change the patch, settings and show file. With no PINs set, everyone on the network is an admin. The computer the app runs on is always an admin.
- **Undo / Redo** (top bar, or ⌘Z / ⌘⇧Z): every change to the show can be undone, including restoring a snapshot.
- **Snapshots** (Setup): saved automatically every few minutes while you work, and at every start. Restore any of them.
- **Panic** (hold for 1 second): stops strobes, effects and every live change, sets the master to full, and fades to the **safe look** chosen in Setup → Safety.
- **Crash recovery:** if the lighting engine stops, the desktop app restarts it within a few seconds, on the same cue, song and section. The DMX output keeps its last frame in between.
- **Updates:** the desktop app checks GitHub Releases, downloads new versions in the background and installs them when you quit (or from the menu: *Check for updates*). Setup → Updates shows the version.

## Primary, secondary and tertiary colours

There is always a three-colour palette: **Primary (P)**, **Secondary (S)** and **Tertiary (T)**. It's shown at the bottom of every screen.

- **Each song has its own palette.** Tap a swatch to change it, and the change is saved to the current song. With no song picked, you're editing the default colours that every song starts with. **↺** puts a song back to the default colours.
- **Use the palette instead of fixed colours:**
  - **P / S / T** on the Program tab
  - the **P S T** buttons in each Live control strip
  - **Primary / Secondary / Tertiary** in pads ("Apply a preset")
  - **Colour A / B** in the effect editor
- **Looks stay linked.** A cue or look recorded with Primary on the back wash and Secondary on the front stays linked to the palette. One "Chorus" look then shows each song in its own colours, and changing a song's Primary recolours everything using it, even while it's on stage.
- **Palette effects:** *Palette chase*, *Palette fade*, *Palette spread* and *Primary / secondary alternate*, or the "primary → secondary → tertiary" layer in your own effects.
- **Live changes:** ProPresenter colour sync sets the **Primary** colour by default, and OSC can set any of the three (`/sl/palette/primary`). Both last until the song changes; a gold outline on the swatch shows a live change.

## OSC

Sanctuary Lights listens for OSC on **UDP port 8000** (change it in Setup → OSC). Use TouchOSC, Bitfocus Companion / Stream Deck, QLab, Open Stage Control, Ableton (with an OSC device), or anything else that sends OSC. Point it at the lighting computer's address (shown in Setup) and the port.

| Address | Does |
|---|---|
| `/sl/go`, `/sl/back` | Cue list GO / back |
| `/sl/next`, `/sl/prev` | Next / previous song section |
| `/sl/section "Chorus"` or `/sl/section/chorus` | Section of the current song (name or number) |
| `/sl/song "Name"` / `/sl/song 3` | Pick a song |
| `/sl/look "Name"`, `/sl/cue 2` | Show a look / go to a cue |
| `/sl/scene "Pulpit" [level]` | Toggle a scene, or set its level 0–1 |
| `/sl/pad 3 [1/0]`, `/sl/pad/q` | Press / release a pad (number, key or name) |
| `/sl/gm 0.8`, `/sl/blackout 1` | Master / blackout |
| `/sl/strobe 1/0`, `/sl/flash 1/0` | Strobe / flash everything while 1 |
| `/sl/tap`, `/sl/bpm 120` | Tempo |
| `/sl/mode hybrid`, `/sl/hold 1`, `/sl/release` | Follow mode, hold, release live changes |
| `/sl/part "Sermon"` | Switch the service part (Worship, Hosting, Sermon, Video, or your own) |
| `/sl/palette/primary "#ff8800"` (or r g b, 0–1) | Change a palette colour until the song changes |
| `/sl/group/<group>/level 0.5` | Group fader |
| `/sl/group/<group>/color "secondary"` | Group colour: primary / secondary / tertiary, `#rrggbb`, r g b, or no argument to release |
| `/sl/group/<group>/fx "Chase"`, `/sl/group/<group>/flash 1` | Group effect by name (no argument = off) / flash |

Buttons that send 1 on press and 0 on release work as expected. Any other OSC message can trigger a song or section with **Learn** in the song editor, the same way as MIDI. Setup shows the last message received and what it did.

## Hot buttons, pads and keyboard

These work on **every tab**:

| Key / button | Does |
|---|---|
| **Strobe** button or **S** (hold) | Strobes everything while held |
| **Flash** button or **F** (hold) | Everything to full while held |
| **B** | Blackout on/off |
| **R** | Release all live changes (pads, effects, live colours) |
| **T** | Tap tempo |
| **1 … 0** (and any key you give a pad) | Pads |
| **?** | Shortcut list |

**Pads** (on the Live and Songs tabs) are your own live buttons. Each pad runs an **effect**, applies a **preset** or **flashes** a group (or all lights). It works either as **toggle** (tap on, tap off) or **hold** (only while pressed), and can have its own key. Ten pads come ready (Pulse, Chase, Sparkle, Wave, Rainbow, Beat strobe, Circle, Ballyhoo, Figure 8, Breathe). Tap **Edit pads** to change, add, reorder or delete them.

## FX & Presets tab

This is a dedicated area for building presets and effects.

**Selection order matters.** Tap lights in the order an effect should travel (they get numbered), or tap a group to use the group's order. The same selection is used on the Program tab.

### Presets

**Dimmer**, **Colour**, **Position**, **Beam** and **All** presets work like this:

- **Record:** set the lights (on the Program tab, or with other presets), select them, pick the type and tap **+ Record preset**. Only that type's values are stored. A colour preset only holds colour, so applying it never changes brightness or position.
- **Apply:** select lights and tap a preset. Lights that weren't part of the recording get the first light's values, so a colour preset works on any colour light.
- **Linked, not copied:** cues and looks remember which preset each light used. **Edit → ⟳ (update)** a preset, and every cue and look using it changes too (e.g. move the "Pulpit" position once). Changing a value by hand breaks the link for that value only.

### Effects

There are about 25 built-in effects:

- **Dimmer:** pulse, chase, soft chase, wave, breathe, sparkle, odd/even, centre-out, strobe, beat strobe, random strobe
- **Colour:** rainbow, colour cycle, two-colour chase, warm↔cool fade, fire flicker
- **Position (moving heads):** circle, spread circle, figure 8, ballyhoo, pan sweep, tilt saw, tilt wave, gentle move
- **Beam:** zoom pulse

To use one, pick it, choose **Selected lights / All / a group**, set the speed and press **▶ Run**. Everything running is listed under **Running**, with **speed** and **size** controls. Size 50% means half as strong. Running effects are saved into cues and looks when you record them, and appear in the live strips' **More…** list.

**Build your own** with **+ New effect**, or **Copy to edit** a built-in one. An effect has one or more **layers**. Each layer moves one thing:

- **What it moves:** intensity, rainbow colour, colour A↔B, pan, tilt, zoom, focus or strobe channel
- **Wave:** sine, triangle, saw up/down, on/off, hit, random
- **Mode:** scale the planned level, exact values, or around the planned position (moving heads)
- **Range:** low/high (or size)
- **Width:** on-time for on/off and hit; 0 = one light at a time
- **Speed ×** and **offset °:** e.g. a circle is pan + tilt with tilt offset 90°

The effect as a whole has a speed (beats per cycle, locked to the tempo, or times per second) and a **phase** spread across the selected lights:

| Setting | Meaning |
|---|---|
| **Phase from / to** | 0→0: all together. 0→360: spread evenly. 0→180: odd/even. |
| **Groups** | Lights in blocks of N move together |
| **Wings** | Mirror the spread from the middle out (2 wings = symmetrical) |
| **Direction** | Forward or backward |

The bar preview shows the result as you change things, and changes save straight away, even while the effect is running.

### Selection tricks

The **Selection tricks** panel on the FX & Presets tab changes how the current selection is ordered and stepped through:

| Control | What it does |
|---|---|
| **Sort** | Tap order, or by stage position: left→right, right→left, front→back, back→front, low→high, high→low, centre→out, outside→in, or **3D direction**: any angle. **Turn** rotates around the vertical (0° = left→right, 90° = front→back, 45° = diagonal). **Tilt** angles it upwards (90° = floor→ceiling). Tap the dial to point it. Positions come from the 3D layout. |
| **Spread by distance** | Spreads by each light's real position along the sort direction instead of its place in the order, so unevenly spaced lights get uneven timing, like a real wave moving through the room |
| **Shift** | Rotates the order (e.g. start the chase on light 3) |
| **Shuffle** | Random but repeatable order; **Unshuffle** goes back |
| **Block** | That many lights in a row share one step |
| **Groups** | The pattern repeats every N steps (Groups 2 = odd/even) |
| **Wings** | Mirrors the pattern (Wings 2 = from the middle out, symmetrical) |
| **Width / Active part** | Splits the selection into parts of N lights; ◀ ▶ steps through them. Programming, presets and effects then go to the active part only. **All** clears it. |
| **Phase / Speed From → To** | Spreads the phase (degrees) or the speed (× tempo) of effects you run on the selection. These override the effect's own spread. |
| **Fade / Delay From → To** | Gives each light its own fade and delay in the next **cue or look** you record (or update), so on GO or a song section the lights change one after another. Leave Fade empty to use the cue's fade time. |
| **Spread a value now** | Sets intensity, pan, tilt or zoom from X% to Y% across the lights, following the order and pattern above |

The selection list shows each light's order number, its step and its delay. Lights outside the active part are dimmed. **Tricks on/off** pauses all of it without losing the settings, and **Reset** clears everything. Effects keep the tricks they were started with, including when they're saved into a cue or look.

## ProPresenter

Sanctuary Lights follows ProPresenter 7 (version 7.9 or later) over the network:

- **Slide groups drive the lights:** when the operator clicks a slide in a group called *Verse 1*, *Chorus* or *Bridge*, the lights go to that section of the song. *Verse 1* matches a section called *Verse* or *Verse 1*. Manual mode and Hold are respected, as with MIDI and the tracks.
- **Presentations pick songs:** a presentation with the same name as a song selects that song. If there's no matching song, a **look** with the group's name is used (e.g. a look called *Chorus*).
- **Make song from this presentation** (in Setup, while a presentation is live) creates the song with one section per group, linked to looks with matching names.
- **Colour sync** sets the live colour of the light groups you tick:
  - **ProPresenter group colour:** the colour each group has in ProPresenter.
  - **Colour of the slide on screen:** the strongest colour in the current slide image (text and greys are ignored; a black-and-white slide gives open white).
- **The live slide appears on the screens** in the 3D view.

**Setup:**

1. In ProPresenter, go to **Settings → Network** and tick **Enable Network**. Note the port.
2. In Sanctuary Lights, go to **Setup → ProPresenter**, tick *Follow ProPresenter*, and enter the address of the computer running ProPresenter (`localhost` if it's the same Mac) and the port.

The status line shows the connection and what the last slide did. Only group names and slide images are read; slide text is not used.

## Service parts: worship, hosting, sermon, videos

A service has parts that need different lighting. The **Service** bar on the Live, Songs and Volunteer screens switches between them with one tap:

| Part | Out of the box |
|---|---|
| **Worship** | Songs (MIDI, track markers, ProPresenter groups, timecode) change the lights, and the lights follow the screen colours. |
| **Hosting** | Its own look (e.g. warm white front light). Songs and screen colours don't change anything. |
| **Sermon** | The same idea, with its own look. |
| **Video** | Everything at **10%**, almost a blackout, while a video plays. |

Set each part up in **Setup → Service parts**:

- **Look:** what the stage looks like during that part. *Keep the song / cue lights* leaves the lights as they are.
- **Brightness:** an overall level on top of the look. Video uses 10%.
- **Fade:** how long the change takes.
- **Songs change the lights:** when off, MIDI from the tracks, track markers, ProPresenter slide groups and timecode are ignored, so the lights stay put during the sermon. Tapping a song section yourself still works, and brings the worship lights back.
- **Follow screen colours:** when off, ProPresenter colour sync is ignored. Switching to the part also drops the colour that came from the screen, so the sermon look shows its own colours.
- **Presentations named:** words that pick this part from the ProPresenter presentation's name (e.g. *sermon, message, scripture*).
- **+ Part** adds your own, e.g. *Communion* or *Prayer*.

**Automatic with ProPresenter** (both can be switched off in Setup → Service parts):

- **Videos:** when a video plays on the main screen, the lights switch to the Video part. When it ends (or is paused for a second), they go back to whatever part was on before, so a video during the sermon returns to the sermon lights. Audio-only items are ignored.
- **Presentations:** when the operator moves to a new presentation:
  - a song's presentation switches to Worship
  - *Sermon notes* switches to Sermon
  - *Welcome & announcements* switches to Hosting

  The bar shows *Auto: …* with the reason.

You can also switch by OSC: `/sl/part "Sermon"` (by name or number), for example from a Stream Deck with Companion. **Panic** always goes back to Worship at full brightness.

## Screens and LED walls in the 3D model

In **Patch → 3D stage & rig → Screens & LED walls**, add your projector screens and LED walls. For each one:

- Set its position (centre), size, turn and tilt, or tap **Move** / the screen in the 3D view and drag it.
- **Show slides** shows the live ProPresenter slide on it.
- **Keep light off it** checks every light, every frame, including moving heads during effects. Lights whose beam would land on the screen turn **red** in the 3D view and are listed under the screens. **Setup → Lights pointing at screens**:
  - **Warn** (default): show them only.
  - **Block:** switch them off while they point at a screen. A moving head comes back on as soon as its movement takes it off the screen.

The check uses each light's 3D position, aim, beam angle (zoom for moving heads) and pan/tilt, so place and aim your lights in 3D for it to be accurate. Front lights aimed at head height often spill onto an upstage LED wall. Fixing that is a real focusing job: aim lower, use a narrower beam, or block them here.

## Running it live

Groups (made on the Program tab) get a **Live control** strip on the Live and Songs tabs:

| Control | What it does |
|---|---|
| **Fader** | Trims that group's brightness (100% = as planned). |
| **Colour buttons** | Changes the group's colour on the fly. **×** goes back to the planned colour. |
| **Flash** | Full brightness while held. |
| **Pulse / Chase / Sparkle / Rainbow / Move** | Effects in time with the tempo. Move only appears for moving heads, and the speed selector sets beats per cycle. |
| **TAP** (or the **T** key) | Taps the tempo. Click the BPM number to type one. The tempo also comes from a song's BPM, or follows Ableton automatically when it sends MIDI clock. |
| **Release live** | Clears all live changes. |

Live changes sit on top of cues, songs and scenes, so you can busk a whole service, run it fully pre-programmed, or anything in between.

When you record a cue or look, live **colours and effects are saved with it**: a "Chorus" look can pulse the back wash on the beat every time. Fader trims and flashes are never recorded. A dashed outline on an effect button means that effect comes from the current look; tap **Off** to stop it for now.

## 3D stage and rig

The 3D view is on the Live and Program tabs (**2D / 3D** switch) and in **Patch → 3D stage & rig**, where you set it up. Drag to orbit, pinch or scroll to zoom, and use **Front / FOH / Top / Side** for quick views. **Work light** lights the room so you can see the model, and **Haze** sets how visible the beams are.

- **Your church model:** **Add 3D model…** takes `.glb` (best), `.gltf`, `.obj` or `.3ds`. SketchUp, Blender, Vectorworks and most 3D tools can export GLB. If it comes in the wrong size, set **Units in file**. If it lies on its back, set **Upright**. Without a model, a simple stage block is shown, sized under **Stage size**.
- **Placing lights:** tap a light, then drag its arrows or type its position (metres: left/right, height, front/back). **Aim: tap the stage**, then tap where it should point. Lights you haven't placed hang at 6 m above their 2D layout position.
- **MVR import:** consoles, CAD and visualisers (Vectorworks, Capture, grandMA3, Depence…) export MVR files. **Import MVR…** reads every light's name, position, aim and DMX address, plus the stage and truss geometry. You then choose which fixture type (channel layout) to use for each kind of light in the file.
- Moving heads follow their pan, tilt and zoom in the 3D view. Light sources are approximate: they are for planning, not photometric accuracy.

## Tracks: backing tracks, key and tempo, live vocal

The **Tracks** tab plays your backing tracks itself, so no Ableton or Playback is needed, and drives the lights from the timeline.

**Setting up a song**

1. Pick the song (add it on the Songs tab first, with its sections: Intro, Verse, Chorus…).
2. **+ Add tracks…**: choose all the stems at once (WAV, AIFF, MP3, M4A, FLAC). They must all start at the same moment, as exported from your DAW or MultiTracks.
3. Set **Recorded in** (key, major/minor) and the original **BPM**.
4. Play, and at the start of each part tap the section's **⌖** to set its marker. **×** removes a marker, and the timeline shows them all. As the tracks play past a marker, the lights go to that section (in Hybrid or Auto mode, as on the Songs tab).

**Changing key and tempo**

- **Plays in − / +** moves the whole song by semitones. All stems are re-rendered at the new key in the background, using several CPU cores. Click tracks keep their pitch ("Follows key" unticked) but follow the tempo.
- **Tempo − / +** changes the speed without changing the key, and markers move with the music.
- The **auto-tune follows automatically**. With *Follow the song key*, it corrects to the song's current key and scale, so changing the key once moves the tracks, the auto-tune and the tempo-synced vocal delay together.
- **Prepare set** renders every song at its key and tempo before the service, so picking a song is instant. Expect roughly 10–20 seconds per song on a recent Mac.

**Mixer:** each stem has a fader with a meter, mute and solo, pan, and an **output**. With a multi-output audio interface, send the click and guide to 3-4 for in-ears and the band tracks to Main 1-2 for FOH. Click/guide stems go to 3-4 automatically.

**Transport:** **Play/Stop**, **⏮**, click the timeline to jump, and tap a section name to jump to its marker.

- **Section jumps wait for the next bar line**, so the band stays in time. A dashed line on the timeline shows where the jump will happen; **Cancel** drops it. Set *Section jumps → Straight away* per song if you prefer.
- **Vamp** repeats the current section until you press it again.
- **Repeat** plays this section once more when it ends (a spontaneous extra chorus).
- **Skip next** skips the next section when this one ends.
- **Drag a marker** on the timeline to move it. It snaps to the beat; hold Shift to place it freely.

**Click, count-in and guide cues** (the *Click, count-in & guide cues* panel under the timeline):

- Set the **time signature** and where **bar 1** starts in the recording.
- **Click:** a click generated from the song's tempo, with an accent on beat 1, at its own level and output (usually the in-ear mix). It follows tempo changes.
- **Count-in:** one or two bars of click before the music starts when you press Play.
- **Guide cues:** upload a spoken "Verse", "Chorus", "Bridge"… once (shared by every song), tick *Speak the section name a bar early*, and the band hears it a bar before each section.

**MIDI clock out:** on the computer playing the audio, choose a MIDI output under *MIDI clock* (Tracks tab, left). Keyboards, effects pedals or Ableton then follow the song's tempo, with Start/Stop and the song position, including after jumps. This needs Chrome, Edge or the desktop app (Safari has no Web MIDI).

**Voices keep their tone:** stems named vocal, vox, guide, BGV, choir or lead are marked **Natural voice**: when the key changes, their formants are kept, so they don't sound like chipmunks or giants. Tick or untick it on any stem.

**Faster after a restart:** rendered key and tempo versions are stored with the show's files, so they are not rendered again after the app restarts.

**Which computer plays the audio:** tick **This computer plays the audio** on the Mac connected to the sound desk, and choose the output device there. Other screens (iPads, the lighting laptop) then work as remotes for play, stop, key and mix.

**Vocal (live auto-tune)**

- **Vocal on**, then choose the **input** (audio interface and channel) on the computer playing the audio.
- **Auto-tune:**
  - **Follow the song key**, or major / minor / chromatic
  - **Amount** (0–100%)
  - **Speed**: 0 = hard, "robotic" snap; 30–80 ms natural; 150 ms+ gentle
  - The display shows the sung note and how far it is being moved.
- **Tone:** low, presence, air, compression. **Effects:** reverb and a delay locked to the song tempo.
- **Save for this song** stores these settings with the song (like a snapshot) and recalls them when the song is picked.
- Latency is about 25 ms through the auto-tune (plus your interface), so most singers won't notice it in their wedges. In in-ears it can be noticeable: send their in-ear mix from the desk instead.

**Plugins (VST/AU/Waves):** a browser-based app can't host third-party plugins. If you rely on SuperRack Performer, Ableton or MainStage, keep them running and set each song's **MIDI out PC** (program change) in the Tracks tab. Choose the MIDI output in Setup. Picking a song then switches their snapshots too.

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

Join the iPad to the same Wi-Fi network. Open the address shown in Setup (for example `http://192.168.1.20:8080`) in Safari, then use Share → **Add to Home Screen**. It then opens full screen like an app, with its own icon.

- It reconnects by itself when the iPad wakes from sleep.
- Swipe the tab bar sideways to reach the other tabs.
- Every control works by touch, including the hold buttons (Strobe, Flash, Panic).
- MIDI clock out and *Use this browser's MIDI* need Chrome or Edge, so they are hidden in Safari. Everything else works.

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
npm install         # dev tools (Electron, builder) and the optional MIDI module
npm test            # unit tests (node:test): engine, cues, songs, MIDI/OSC/ProPresenter, packets, audio DSP
npm run test:ui     # browser smoke test (Playwright + Chromium)
node server.js      # or: npm start, then open http://localhost:8080
npm run app         # the desktop app (Electron)
```

There is no build step: the browser code is plain ES modules, and the server is Node.js with no runtime dependencies (`@julusian/midi` and `electron-updater` are optional).

**How it fits together:** every change is an **action** (`{ type: 'cue.record', … }`) sent to `POST /api/action`. The engine applies it to the show and the runtime state, the server saves and broadcasts the new state to every screen over server-sent events (`/api/events`), and the DMX loop renders the look about 40 times a second.

### Server (`lib/`)

| Path | What it is |
|---|---|
| `lib/engine/index.js` | `Engine`: holds the show and runtime state; `dispatch(action)` runs an action and reports whether the show changed |
| `lib/engine/actions/*.js` | The actions, one file per area: `cues`, `scenes`, `looks`, `songs`, `tracks`, `programmer`, `presets`, `effects`, `pads`, `patch`, `live`, `palette`, `osc`, `propresenter`, `show`. Each action runs with `this` = the engine |
| `lib/engine/*.js` | Engine methods, mixed into `Engine.prototype` by area: `looks` (mixing and the final look), `playback` (cue fades), `live` (busking and effects), `tricks`, `screens`, `triggers` (MIDI/OSC learn), `capture`, `patch`, `state` (DMX rendering and what screens get), `defaults`, `util` |
| `lib/server/app.js` | `App`: wires engine, store, history, auth and devices; runs actions with permission checks and undo |
| `lib/server/routes.js` | HTTP routes (actions, uploads, events, assets) |
| `lib/server/store.js` | Saving, backups, snapshots, logs |
| `lib/server/history.js` | Undo / redo |
| `lib/server/auth.js` | PINs and roles |
| `lib/server/devices.js` | Output, MIDI, ProPresenter, OSC and DMX input, connected to the engine |
| `lib/server/hub.js` | Live updates to every screen |
| `lib/output.js`, `lib/usbdmx.js` | Art-Net, sACN and Enttec packets; finding the USB-DMX interface |
| `lib/dmxinput.js` | Art-Net / sACN input (merge and backup) |
| `lib/midi.js`, `lib/timecode.js` | MIDI in/out and clock; MIDI timecode |
| `lib/profiles.js`, `lib/fixtures.js` | Fixture types; GDTF and Open Fixture Library import |
| `lib/mvr.js`, `lib/propresenter.js`, `lib/osc.js` | MVR reader; ProPresenter client (streaming and polling); OSC receiver |
| `server.js` | Entry point (also run by the desktop app in a supervised process) |

### Browser (`public/`)

- `public/js/core.js`: shared state (`S`), the server connection, `act()` to send actions, and a small event bus (`on('state' | 'runtime' | 'live', fn)`). It imports nothing, so modules can load in any order.
- `public/js/*.js`: one module per screen or feature (`live`, `program`, `songs`, `tracks`, `fx`, `patch`, `setup`, `wizard`, `testpanel`, `access`, `history`…). `main.js` imports them all and starts the session.
- `public/audio/`: the tracks engine.
  - `engine.js`: playback, scheduled jumps, routing, vocal chain
  - `timing.js`: bar/beat grid, click and count-in
  - `midiclock.js`: MIDI clock out
  - `rendercache.js`: stored renders
  - `pvcore.js`: key/tempo change (phase vocoder with formant preservation)
  - `tunercore.js`: auto-tune (YIN + PSOLA)
  - worker and worklet wrappers
- `public/geom.js`, `public/fxmath.js`: stage geometry and effect maths, shared by the server and the browser.
- `public/stage3d.js`: 3D view (three.js, bundled in `public/vendor/three` under its MIT licence).

### Desktop app (`electron/`)

- `main.js`: window, menu, power-save blocker
- `supervisor.js`: runs the server in a utility process and restarts it if it stops
- `updater.js`: automatic updates from GitHub Releases

`.github/workflows/build.yml` runs the unit and UI tests and builds the installers.

### Adding a feature

1. Add an action in the right `lib/engine/actions/*.js` file. Return `{ show: true }` if it changes the saved show.
2. If only admins may use it, add its prefix to `ADMIN_PREFIX` in `lib/server/auth.js`. Volunteer actions go in `VOLUNTEER`.
3. Call it from the browser with `act('my.action', { … })`, and redraw in an `on('state')` / `on('runtime')` handler.
4. Add a test in `test/`.
