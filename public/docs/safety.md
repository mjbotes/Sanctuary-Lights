# Safety, PINs and backups

## PINs: who can change what

In **Setup → Access**, set up to three PINs:

| Role | Can |
|---|---|
| **Volunteer** | Only the **Volunteer** screen (and Help): next/back, song sections, the Service bar, scenes, pads, Flash, Strobe, Blackout, Panic |
| **Operator** | Everything except the **Patch** and **Setup** tabs: run the service, and program looks, cues, songs, tracks and effects |
| **Admin** | Everything, including the patch, Setup (connections, test page, service parts, PINs) and the show file |

- With **no PINs**, everyone on the network is an admin.
- The **computer the app runs on** is always admin (you can turn that off).
- **Lock** (top bar badge) logs out, so the next person enters their PIN.
- Turning PINs off again: **Turn off PINs** in Setup → Access.

## Undo and redo

**↶ / ↷** at the top (or **⌘Z / ⌘⇧Z**, **Ctrl+Z** on Windows) undo and redo any change to the show: a deleted song, an overwritten look, a changed patch, even a restored snapshot. Quick edits in a row (dragging a fader) count as one step.

## Panic

**Hold Panic for one second.** It:

- stops strobes, flashes and every effect
- clears live changes, pads and the programmer
- turns blackout off and sets the master to full
- goes back to the **Worship** part at full brightness
- fades to the **safe look** (Setup → Safety: choose your normal worship lighting)

Use it whenever the lights are doing something you don't understand.

## Saving and snapshots

- Everything **saves automatically**, a moment after each change.
- **Snapshots** are kept every few minutes while you work, and at every start. Restore one in **Setup → Snapshots** (and undo the restore if it was the wrong one).
- **Backups:** every start copies the show into the *backups* folder; the last 30 are kept.
- **Download backup** saves the show as a file; **Load show file…** opens one, e.g. to move a show to another computer.

The show is kept in the *SanctuaryLights* folder in your home folder (Setup shows where).

## If the computer or app restarts

The lighting engine runs separately from the window. If it stops, the app restarts it within a few seconds, on the **same cue, song and section**. In the meantime the lights hold their last state. After a power cut, the app opens where it left off.

## Updates

The desktop app checks for new versions, downloads them in the background, and installs them **when you quit**, so never during a service. **Check for updates** is in the app menu; Setup → Updates shows the version you have.

## Good habits

- Test with **Setup → Test** before every service.
- Give volunteers the **volunteer PIN**, not the admin one.
- Choose a **safe look** for Panic.
- Before big changes, tap **Save snapshot** (Setup → Snapshots).
- Put the lighting computer and the nodes on a **wired, private network**.
