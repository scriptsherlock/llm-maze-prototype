# 3D Asset Plan

The prototype now uses procedural Three.js geometry so it can run without external models. These are the open-source asset packs to replace the placeholder geometry when the experiment visuals need more polish.

## Primary Packs
- Kenney City Kit Roads: road pieces, intersections, curbs, crossings, street markings. License: CC0. Source: https://kenney.nl/assets/city-kit-roads
- Kenney City Kit Commercial: shops, office buildings, storefront-style building blocks. License: CC0. Source: https://kenney.nl/assets/city-kit-commercial
- Kenney Blocky Characters: simple low-poly participant/avatar characters. License: CC0. Source: https://kenney.nl/assets/blocky-characters
- Kenney Car Kit: parked cars and street props. License: CC0. Source: https://kenney.nl/assets/car-kit

## Texture Sources
- Poly Haven asphalt, concrete, brick, glass, and HDRI lighting textures. License: CC0. Source: https://polyhaven.com/license

## Needed Asset Categories
- Road tiles: straight, corner, T-junction, crossroad, dead end.
- Pavements: sidewalk strips, curbs, crossings.
- Buildings: commercial shopfronts, residential blocks, taller landmark buildings.
- Facade details: windows, doors, awnings, signs, wall materials.
- Street props: lamp posts, bins, benches, bollards, traffic signs.
- Vehicles: parked cars or bikes for scale.
- Player character: low-poly person or simple avatar marker for moderator/overview use.
- Goal landmark: exit sign, station entrance, glowing shop, or destination arch.

## Integration Notes
- Keep assets low-poly and stylistically consistent.
- Prefer `.glb`/`.gltf` models for Three.js loading.
- Place downloaded files under `public/assets/`.
- Keep attribution/license notes in this file even for CC0 assets, so dissertation documentation stays clean.
