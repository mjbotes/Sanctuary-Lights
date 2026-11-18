# AI assistant (Claude)

Sanctuary Lights can let an AI assistant such as **Claude** see the show and change it for you, through **MCP** (the Model Context Protocol). You ask in your own words; it does the clicking.

Examples:

- "Light this Sunday's songs."
- "Make the bridge of Graves Into Gardens bigger: movers sweeping, back wash in the secondary colour, chasing."
- "Add a Baptism part with a bright, cool look on the front, and switch to it when the presentation says baptism."
- "Set the colours of Way Maker to deep blue and magenta."
- "Every Sunday at 9:30 switch to Pre-service, and black out at 12:30."
- "What's on stage right now?"

## Safety first

- **Off until an admin switches it on.** In Setup → **AI assistant (MCP)**, tick *Allow an AI assistant to connect*.
- **Secret token:** only an assistant with the token can connect. **New token** cuts off everyone using the old one. The token is kept on the lighting computer only, not in the show file.
- **You choose what it may do:**
  - **Operator** (default): songs, looks, service parts and running the lights
  - **Admin**: also the patch, settings and the schedule

  The same checks apply as for a person with that PIN.
- **Everything it changes appears on every screen straight away, and Undo reverses it** (↶ at the top), one step at a time, like a button press.
- During a service, **Panic** works as always.

## Connect Claude Desktop

1. In Sanctuary Lights: **Setup → AI assistant (MCP)** → tick *Allow an AI assistant to connect*.
2. Under **Claude Desktop on this computer**, tap **Copy**.
3. In Claude Desktop: **Settings → Developer → Edit Config**. Paste it into the file. If the file already has `"mcpServers"`, add the `"sanctuary-lights"` part inside it instead. Save.
4. Restart Claude Desktop. *sanctuary-lights* appears in its tools (the slider icon) and you can start asking.

**Claude Desktop on another computer** (e.g. a laptop, with the lights on the church Mac):

1. Install Node.js on the laptop.
2. Download the bridge from the link in that section of Setup, and put its path in `"args"`.
3. Use the config shown there; it points at the lighting computer's network address. Both computers must be on the same network.

## Connect Claude Code

Copy the `claude mcp add …` line from Setup and run it in a terminal. Claude Code then has the Sanctuary Lights tools in every session.

## What the assistant can do

| Tool | Does |
|---|---|
| get_overview | The lights (by role and group), service parts, set list and library, looks, effects, and what's on stage now |
| get_song | A song's sections, looks, colours, key and BPM |
| add_song / arrange_song | Add a song with its sections, or change their order (lighting is kept) |
| light_song | *Light this song for me* |
| set_song_colors | A song's primary / secondary / tertiary colours |
| compose_look | Build or change a look in plain terms: which lights, intensity, colour, pan/tilt/zoom, an effect |
| set_section | Which look a section shows, and its fade |
| show_look / go | Put a look on stage; go to a song or section |
| set_part / save_part | Switch the service part; create or change one |
| set_master | Master level and blackout |
| add_schedule | A weekly scheduled change (admin) |
| panic / undo | As the buttons |
| run_action | Anything else the app can do, for advanced use |

## Other assistants

Any MCP client can connect:

- **HTTP:** the address is `http://<lighting computer>:8080/mcp` (MCP *Streamable HTTP*), with the header `Authorization: Bearer <token>`.
- **Clients that start a command (stdio):** use the bridge shown in Setup.
