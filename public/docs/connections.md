# Connecting lights and other gear

Everything here is in the **Setup** tab. **Save output settings** applies changes; **Setup → Test** shows whether each connection is working.

## Lights (DMX out)

| You have… | Do this |
|---|---|
| **USB-DMX interface** (Enttec DMX USB Pro or a compatible "Pro" box) | Tick **USB-DMX interface** and plug it in. It's found automatically, and reconnects if it's unplugged. A Mac needs no driver (the FTDI driver is built into macOS); Windows gets it from Windows Update. Choose which **universe** it sends. |
| **Art-Net node**, or lights with Art-Net | Tick **Art-Net**. Leave *Send to* as `255.255.255.255` (every node on the network), or type the node's IP address. Most nodes call the first universe **0**, which is the default. |
| **sACN node**, or a console receiving sACN | Tick **sACN** and choose the network port the node is on. Leave *Unicast* empty unless your node needs it. |

**Not supported:** cheap "Open DMX" USB cables and uDMX sticks. Use a "Pro"-type interface or a network node.

**Networks:** the computer and the node must be on the same network. Many Art-Net nodes come set to a `2.x.x.x` address: either set the node to your network's addresses, or give the computer a matching address.

**DMX monitor** (Setup) shows exactly what's sent on each channel, which helps when one light misbehaves.

## Addresses and universes

Each light listens from a **start address** in a **universe** (a cable or network stream of 512 channels). A 4-channel par at address 1 uses 1–4, so the next one starts at 5. The Patch tab shows each light as `universe.address` (e.g. `1.5`). Set the same address on the light itself, and the same **mode** (number of channels).

## MIDI from backing tracks

- **Listen on:** *All MIDI inputs*, or one port. Choose a **channel** if your track app sends on several.
- **First section note:** C1 (36) by default: note 36 triggers section 1, 37 section 2, and so on.
- **Program change n selects song n:** on by default.
- **Send to (MIDI out):** for program changes to SuperRack, Ableton or MainStage when a song is picked.

Setting up the IAC bus (same Mac) or a network session (iPad) is described in [Songs](songs.md).

If the computer's MIDI system can't be opened, tick **Use this browser's MIDI** in Chrome or Edge on the lighting computer instead.

## OSC: Stream Deck, Companion, TouchOSC, QLab

Sanctuary Lights listens for OSC on **UDP port 8000** (changeable). In your OSC app, send to the lighting computer's IP address (shown under *Open on iPad / phone*) and that port.

Useful buttons for a **Stream Deck with Bitfocus Companion** (use the *Generic OSC* module):

| Button | OSC message |
|---|---|
| GO | `/sl/go` |
| Next section | `/sl/next` |
| Worship / Hosting / Sermon | `/sl/part "Worship"` (etc.) |
| Blackout on / off | `/sl/blackout 1` / `/sl/blackout 0` |
| Flash (hold) | `/sl/flash 1` on press, `/sl/flash 0` on release |
| A scene | `/sl/scene "Pulpit"` |
| A look | `/sl/look "Chorus"` |
| Tap tempo | `/sl/tap` |

The full list is in **Setup → OSC addresses**. Any other OSC message can be **Learn**ed for a song section, like MIDI.

## Hardware controller (Launchpad, APC mini, or any MIDI controller)

Physical buttons are faster and safer than a touchscreen during a service. In **Setup → Hardware controller**, tick *Use a hardware controller*, choose the model and its MIDI port.

The controller gets its own MIDI port, so its buttons never trigger song sections, even if the tracks' MIDI listens on all inputs.

**Launchpad (Mini MK3, X, Pro MK3) and Akai APC mini mk2** get a ready-made layout on the 8 × 8 grid, top row first:

| Row | Buttons |
|---|---|
| 8 | Service parts: Worship, Hosting, Sermon, Video… (green = on) |
| 7, 6, 5 | Sections of the current song (in their look's colour; the current one pulses) |
| 4, 3 | Pads 1–16 |
| 2 | Set-list songs 1–8 |
| 1 | ◀ section · section ▶ · next item · Flash (hold) · Strobe (hold) · Blackout · Panic (hold 1 s) · Tap tempo |

On a Launchpad, Sanctuary Lights switches it to Programmer mode by itself.

**Any other MIDI controller:** choose *Another MIDI controller*, tap **Learn** next to a function, and press a button. Buttons that send notes light up when their function is on (if the controller supports it).

For a Stream Deck, use Bitfocus Companion with OSC (above).

## MIDI timecode (MTC)

Tick **Follow MIDI timecode** and send MTC from Ableton, Playback, QLab or a video server to the MIDI input. Cues and songs with a timecode follow it. See [Songs](songs.md).

## Input from another lighting desk

Receive Art-Net or sACN from a console:

- **Merge:** the highest level wins, channel by channel.
- **Backup:** the desk is passed straight through, and Sanctuary Lights takes over if the desk stops sending.

## iPads and phones

1. Connect the iPad to the **same network** as the lighting computer.
2. In Safari, open the address shown in **Setup → Open on iPad / phone** (e.g. `http://192.168.1.20:8080`).
3. **Share → Add to Home Screen**: it then opens full screen like an app.

Several screens can be open at once; they all stay in sync. It reconnects by itself after the iPad sleeps.

> Anyone on that network can open the controller. Use the production network, not guest Wi-Fi, and set PINs ([Safety](safety.md)).

## ProPresenter

See [ProPresenter](propresenter.md).
