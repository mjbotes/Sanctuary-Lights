# 3D stage

The 3D view shows your room with real coloured beams. Use it to plan looks before the lights are hung, to check moving-head positions, and to keep light off the screens.

Switch between **2D / 3D** on the Live and Program tabs. Set it up in **Patch → 3D stage & rig**.

## Moving around

- **Drag** to orbit; **pinch or scroll** to zoom.
- **Front / FOH / Top / Side** jump to standard views.
- **Work light** lights the room so you can see the model; **Haze** sets how visible the beams are.

## Your church in 3D

**Add 3D model…** takes `.glb` (best), `.gltf`, `.obj` or `.3ds`. SketchUp, Blender, Vectorworks and most 3D tools can export GLB.

- Wrong size? Set **Units in file**.
- Lying on its back? Set **Upright**.

Without a model, a simple stage block is shown, sized under **Stage size**.

## Placing lights

- **Tap a light**, then drag its arrows or type its position in metres: left/right, height, front/back.
- **Aim: tap the stage**, then tap where it should point.
- Lights you haven't placed hang at 6 m above their 2D position.
- Moving heads follow their pan, tilt and zoom.

## Aim moving heads by tapping (focus points)

1. Select the moving heads (Program tab: tap them, or a group).
2. In the 3D view, choose what to aim at: **at a person** (1.2 m above the spot, the default), **on the floor**, or **above a person**. Then tap **🎯 Aim movers**.
3. Tap the spot on the stage: the pulpit, the baptism pool, the worship leader's mic. Each moving head works out its own pan and tilt to point there.
4. Name it to save it as a **focus point** (e.g. *Pulpit*), or cancel to keep it just for now.

A focus point is a **Position** preset (FX & Presets) that stores the *place*, not pan/tilt numbers. Looks and cues using it stay on that place even if a light is moved or re-hung: move the light in the 3D view and it re-aims by itself. To move the place itself, aim again and save with the same name.

This needs the lights placed in the 3D view at roughly their real positions.

## Importing a rig (MVR)

Consoles, CAD and visualisers (Vectorworks, Capture, grandMA3, Depence…) export **MVR** files. **Import MVR…** reads every light's name, position, aim and DMX address, plus stage and truss geometry. Fixture types in the file (GDTF) come in automatically; otherwise you choose a type for each kind of light.

## Projector screens and LED walls

Add them with **+ Projector screen** and **+ LED wall**. For each:

- Set its position, size, turn and tilt, or tap **Move** and drag it.
- **Show slides:** shows the live ProPresenter slide on it.
- **Keep light off it:** checks every light, every frame (moving heads during effects too). Lights that would hit it turn red, and **Setup → Lights pointing at screens** decides what happens:
  - **Warn:** they're only marked.
  - **Block:** they're switched off while they point at the screen.

> Front lights aimed at head height often spill onto an upstage LED wall. Fix that by aiming lower or using a narrower beam, or block them here.

The beams are approximate: good for planning, not for photometric accuracy.
