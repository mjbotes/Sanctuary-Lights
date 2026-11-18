# When something goes wrong

**First, in a service:** hold **Panic** for one second. It almost always gets the lights back to normal. Then find the cause below.

## No lights at all

1. **Blackout** on? It glows red. Tap it.
2. **Master** slider (bottom) down? Push it up.
3. The current **service part** at 0% brightness (e.g. *Video*)? Tap **Worship**.
4. **Setup → Test → DMX out:** is the dot green?
   - **USB-DMX:** does it say *Connected*? Try another USB port or cable. Unplug and plug it back in: it's found again by itself.
   - **Art-Net / sACN:** is the computer on the same network as the node? Is the node's address in the same range?
5. **Blink every light in turn** (Setup → Test). If nothing blinks, the problem is between the computer and the lights: the interface or node, cables, or power.

## One light doesn't work, or does the wrong thing

- **Blink** it on the test page. Does another light blink instead? The **address** on the light doesn't match the patch.
- Does it come on in a strange colour, or move by itself? The light's **mode** (number of channels) doesn't match the fixture type. Change the mode on the light, or the type on the Patch tab.
- Is the light aimed at a screen with **Block** on? It's switched off on purpose (it shows red in 3D).
- Check the DMX cable and the terminator at the end of the chain.

## The tracks don't change the lights

Check the **MIDI in** line on the test page, or the line under the song on the Songs tab. It tells you why:

| It says | Fix |
|---|---|
| *No MIDI inputs found* | Turn on the IAC Driver or a Network session (Audio MIDI Setup), or check the USB MIDI interface |
| Nothing arrives | Is the track app sending to the right port and channel? Does the song have MIDI events at its sections? |
| *ignored: Manual mode* | Switch the follow mode to **Hybrid** |
| *ignored: Hold is on* | Press **Hold** again to release it |
| *ignored: Sermon* (or another part) | That part doesn't let songs change the lights. Tap **Worship**. |
| *no match* | The note isn't one it knows. Use **Learn** on the section, or check the first-note setting (C1 = 36). |

## ProPresenter doesn't change the lights

See [ProPresenter → Troubleshooting](propresenter.md).

## The lights stay dim after a video

The Video part comes back by itself when the video stops. If ProPresenter lost its connection mid-video, or someone tapped a part during the video, tap the part you want (e.g. **Worship**). **Panic** works too.

## The colours keep changing during the sermon

The current part has **Follow screen colours** on. Switch to the **Sermon** part (it's off there), or untick it for that part in Setup → Service parts.

## Someone can't do something

Volunteers (volunteer PIN) only see the Volunteer screen. Operators see everything except **Patch** and **Setup** (so the test page and service-part settings need an admin PIN). See [Safety → PINs](safety.md).

## Tracks: no sound, or a song isn't ready

- Is **This computer plays the audio** ticked on the computer connected to the sound desk? Is its output device right? Play a **test tone** (Setup → Test).
- *Changing key/tempo… %*: the song is still being rendered. **Prepare set** before the service avoids the wait.
- No sound on an iPad remote is normal: the audio plays on the audio computer.

## I changed something by mistake

**Undo** (↶ at the top, or ⌘Z). For something older, restore a **snapshot** (Setup → Snapshots). See [Safety](safety.md).

## The screen says "Not connected" (grey dot)

The page can't reach the lighting computer. Is it on, with the app open? Is the iPad on the same network? Reload the page. The lights keep their last look in the meantime.
