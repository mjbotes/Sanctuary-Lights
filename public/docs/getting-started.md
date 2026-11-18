# Getting started

## What you need

- **A computer** to run Sanctuary Lights: a Mac (Apple Silicon or Intel), Windows or Linux. It stays at the desk and sends the signal to the lights.
- **A way to get DMX to the lights**, one of:
  - a **USB-DMX interface** (Enttec DMX USB Pro or compatible). It plugs into the computer's USB port; the DMX cable goes from it to the first light.
  - an **Art-Net or sACN node**: a box on the church network with DMX outputs.
  - lights that take **Art-Net or sACN directly** over a network cable.
- **Optional:**
  - iPads or phones on the same Wi-Fi as remotes
  - a backing-tracks app (Playback, Ableton)
  - ProPresenter
  - a Stream Deck

## Install

1. Download the installer for your computer. These links always give the newest version:
   - [Mac with Apple Silicon (M1, M2, M3, M4…)](https://github.com/mjbotes/Sanctuary-Lights/releases/latest/download/Sanctuary-Lights-mac-arm64.dmg)
   - [Intel Mac](https://github.com/mjbotes/Sanctuary-Lights/releases/latest/download/Sanctuary-Lights-mac-x64.dmg)
   - [Windows](https://github.com/mjbotes/Sanctuary-Lights/releases/latest/download/Sanctuary-Lights-Windows-Setup.exe)
   - [Linux](https://github.com/mjbotes/Sanctuary-Lights/releases/latest/download/Sanctuary-Lights-Linux.AppImage)

   Not sure which Mac? Apple menu → **About This Mac**: *Chip: Apple M…* is Apple Silicon.
2. **Mac:** open the `.dmg` and drag **Sanctuary Lights** into Applications. The first time, macOS may say it can't check the app. Open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
3. Allow the **local network** when asked (needed for Art-Net, sACN and iPads), and the **microphone** if you'll use the vocal features.

The app updates itself afterwards. See [Safety → Updates](safety.md).

## The setup wizard

On a new, empty show a short wizard opens. You can open it again any time from **Setup → Test → Setup wizard…**

1. **Welcome:** give the room or show a name.
2. **Connection:** how the lights connect.
   - **USB-DMX:** plug the interface in. It's found automatically, and the wizard shows "Connected". A Mac needs no driver.
   - **Art-Net:** leave *Send to* as `255.255.255.255` to reach every node, or type your node's address.
   - **sACN:** nothing to fill in.
   - **Not connected yet:** you can still try everything; the 2D and 3D views show what the lights would do.
3. **Lights:** add each kind of light.
   - Type how many, choose the type, give them a name (e.g. *Front wash*) and tap **Add**. They get DMX addresses one after another: set the lights themselves to the addresses shown.
   - Tap **Find** to make a light blink white, so you can check it's the right one.
   - Not in the list? Type its name in **Search the fixture library** under the list, tap it and tick its mode. Or import a GDTF file later (see [Looks and cues → Fixture types](looks-and-cues.md)).
4. **Cues from:** what tells the lights when to change.
   - **Backing tracks app:** Playback or Ableton sends MIDI. Choose the MIDI input.
   - **Tracks played here:** the app plays the backing tracks itself (see [Tracks](tracks.md)).
   - **ProPresenter:** enter the ProPresenter computer's address and port.
   - **Someone presses buttons:** a volunteer uses the Volunteer screen.
5. **Done.** Open the test page, or go straight to making your first look.

## The test page

**Setup → Test** shows everything you need to check before a service:

| Line | Green when… |
|---|---|
| **DMX out** | Art-Net or sACN is on, or the USB-DMX interface is connected |
| **MIDI in** | MIDI arrived in the last 15 seconds (it shows what it did) |
| **OSC in** | An OSC message arrived recently (e.g. from a Stream Deck) |
| **ProPresenter** | Connected (*live updates* means slide changes arrive instantly) |
| **Timecode** | MIDI timecode is running |
| **Audio** | A computer is playing the audio for the Tracks tab |

**Lights:**

- **Blink every light in turn** goes through the lights one by one and shows each name.
- **Blink all together** blinks every light at once.
- A light's own button blinks just that light.

Blinking works even in blackout, so you can test without changing anything else.

**Sound** (on the computer playing the audio): a 1 kHz test tone on each output pair (left, then right, then both), and a **mic check** with a level meter.

## Your first 15 minutes

1. **Patch tab → Arrange stage:** drag the lights to where they hang, as seen from the audience.
2. **Program tab:** tap some lights, set a colour and intensity, then **Save as scene** or record a look (Songs tab → **+ Record from stage**). See [Looks and cues](looks-and-cues.md).
3. Make looks called **Verse**, **Chorus** and **Bridge**. Song sections with those names use them automatically.
4. **Songs tab:** add a song with its sections, then tap **✨ Light this song for me** and **▶ Preview**. Or tap **+ Demo song** to see *Graves Into Gardens* fully designed.
5. **Setup → Service parts:** record a **Hosting** and a **Sermon** look. See [Service parts](service-parts.md).

Next: [Connecting lights and other gear](connections.md).
