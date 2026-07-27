# 3D asset credits & sources

All models are glTF (`.glb`) loaded via three.js `GLTFLoader`. Kept here so it's
easy to re-download or attribute.

| Asset | Author | Source | License |
|---|---|---|---|
| **Hedge** (`Hedge by Quaternius - df8uCl1YpK.glb`) | Quaternius | https://poly.pizza/m/df8uCl1YpK | CC0 (public domain) |
| **City Kit — Suburban** (`city/`) | Kenney | https://kenney.nl/assets/city-kit-suburban | CC0 (public domain) |

Notes:
- These licenses (CC0) mean free use, including commercial, with no attribution
  required — but crediting the authors here is good practice.
- The hedge `.glb` embeds its own leaf texture (self-contained). The City Kit `.glb`s
  share an external `city/Textures/colormap.png`.
- The hedge filename contains spaces, so load it with a URL-encoded path (the code
  uses `encodeURIComponent`).
