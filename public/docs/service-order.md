# Service order, Planning Center and schedule

## Planning Center: bring Sunday's plan in

If you plan services in **Planning Center Services**, Sanctuary Lights can read each plan:

- **Songs**, in order, with their **key**, **BPM** and **arrangement**. The arrangement becomes the song's sections: Verse 1, Chorus, Bridge…
- **The service order:** the countdown video, welcome, sermon, prayer…

### Connect (once, admin)

1. Sign in at **api.planningcenteronline.com** → **Personal Access Tokens** → **New Personal Access Token**. Give it a name such as *Sanctuary Lights*.
2. Copy the **Application ID** and the **Secret**.
3. In Sanctuary Lights: **Setup → Planning Center**, paste both and tap **Connect**.

The token is kept on the lighting computer only, in its own file. It isn't in the show file, backups or exports. **Disconnect** removes it.

### Import a plan

In **Setup → Planning Center**, choose the **service type** (e.g. *Sunday Morning*) and the **plan** (the next few dates are listed), then tap **Import this plan**. Afterwards, **Import from Planning Center** / **↻ Import again** on the Songs tab imports the next plan of that service type in one tap.

Importing:

- **adds new songs** with their arrangement as sections, key and BPM. With *Light new songs automatically* ticked, each new song gets a design straight away (see [Songs → Let it light the song for you](songs.md)).
- **keeps songs you already have** as they are (their sections and looks). It only fills in a missing key or BPM.
- **puts this service's songs at the top of the set list**, in order.
- **fills the service order** (below).

Import again whenever the plan changes; nothing you programmed is lost.

## The service order

The **Service order** shows on the **Songs** tab (under the set list) and on the **Volunteer** screen:

| Item in the plan | What tapping it does |
|---|---|
| A song (♪) | Picks the song, switches to **Worship** and goes to its first section |
| A video / media item | Switches to the **Video** part |
| An item whose name matches a [service part](service-parts.md) (*Welcome*, *Sermon*, *Baptism*…) | Switches to that part |
| Anything else (e.g. *Closing prayer*) | Shown greyed: no lighting change |
| Headers (*Worship*, *Message*…) | Shown as titles |

**Next item ▶** (and **◀**) steps through the service, so a volunteer can run the whole morning with one button.

The words that link items to parts are the same ones that ProPresenter presentations use. Change them in **Setup → Service parts → Presentations named**.

**Clear** removes the service order; the songs stay in the set list.

## Schedule: lights that change by themselves

**Setup → Schedule** (admin) runs things at a time of the week:

| Example | Day | Time | Does |
|---|---|---|---|
| Walk-in look | Sun | 09:30 | Switch to part **Pre-service** |
| House lights down | Sun | 09:59 | Show look **Service start** |
| All off | Sun | 12:30 | **Blackout on** |
| Ready for next week | Mon | 08:00 | **Blackout off** |

Each entry has:

- **On / off** (the checkbox)
- **days**: tap the letters
- **time**
- **what it does**: switch to a part, show a look, blackout on, blackout off, or set the master level

**Test** does it now. The line at the top shows what runs next.

Good to know:

- Times use the **lighting computer's clock**. The computer must be on, with Sanctuary Lights running, at that time.
- An entry runs **once** at its time. If the computer was off, it doesn't run late when it comes back on.
- You can always tap something else afterwards; the schedule doesn't lock anything.
