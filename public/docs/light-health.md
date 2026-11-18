# Light health and the pre-service check

Setup → **Light health** keeps track of your lights: how long each one has been on, problems someone found, and cleaning or lamp changes that are due.

> **Why a check?** DMX only goes one way: the computer talks to the lights, but a light can't answer back. So the app can't tell by itself that a light has died. The pre-service check is how it finds out, and it remembers until someone fixes it.

## The pre-service check (2 minutes)

Do it before people arrive, with someone who can see the stage.

1. Setup → Light health → **▶ Pre-service check**.
2. Each light blinks white in turn, with its name in big letters.
3. Tap **✓ Works** (or press **Enter**), or tap what is wrong:
   - *Doesn't light up*
   - *Wrong colour*
   - *Doesn't move*
   - *Flickers*
   - *Pointing the wrong way*
   - *Wrong light answered* (another light blinked: its address is wrong)
   - *Something else…* to type your own
4. **Back** goes to the previous light; **Skip** leaves one out; **Finish now** stops early.

At the end you get a summary. Problems are:

- listed in **Light health**, with the light marked in red, and
- written into today's [service report](sunday.md), so whoever looks after the lights hears about it.

A light that already has a problem shows it during the check ("Known problem: Flickers"), so you know whether it's new.

## When a light is fixed

Tap **Fixed** next to the problem. It's taken off the list, and "fixed" goes in the service report. You can also note a problem any time with **Problem…** on that light's row.

## Hours and maintenance

**Hours on** counts the time each light has been on (brighter than 2%): not in blackout, not while it's off in a look, and not in practice mode. Use it to see which lights work hardest.

**Reminders:**

1. Under the list, fill in **Remind me every … hours on to …** (e.g. *300* hours, *Clean the lenses and fans*).
2. A light that has been on that long since its last service shows **due** (in orange), and the top of the panel counts them.
3. After the work, tap **Serviced** on that light (or **All serviced**): the count starts again.

Some lights need their own interval, e.g. a hazer, or a discharge lamp with a rated life: tap **⏱** on its row and type the hours (empty = the default, 0 = never).

> The hours and problems belong to the real lights in your room, so they're kept on the lighting computer, not in the show file. Loading another show file doesn't wipe them.

## Ask the AI assistant

With the [AI assistant](ai-assistant.md) connected you can ask "Are any lights broken?" or "Front 2 is flickering again, note it", and it reads or updates the same list.
