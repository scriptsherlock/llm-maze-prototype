# City assets (Kenney City Kit — Suburban)

Put the **`.glb` model files here** — this exact folder:

    public/assets/city/

## How to get them
1. Download **City Kit (Suburban)** from https://kenney.nl/assets/city-kit-suburban (CC0 — free, no attribution needed).
2. Unzip it. Inside you'll find several format folders (GLB, GLTF, OBJ, FBX…).
3. From the **GLB** folder, copy the individual model files (e.g. `building-type-a.glb`, `detail-tree.glb`, …) **directly into this folder** — not the whole zip, just the `.glb` files.

So it ends up like:

    public/assets/city/
      building-type-a.glb
      building-type-b.glb
      detail-tree.glb
      ...

## After you've copied them
Tell me (or I'll list the folder) and I'll wire the actual filenames into the
`BUILDING_MODELS` list in `public/game.js`, then tune scale/orientation to the maze.

These files are committed to the repo so they're served statically (works locally
and on Vercel). glTF is the format three.js loads natively.
