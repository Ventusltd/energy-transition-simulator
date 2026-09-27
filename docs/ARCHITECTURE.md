# Architecture

The simulator owns the joins and the game loop. The engines stay in their own repositories.

| Part | Repository | Role |
|---|---|---|
| Map | Ventusltd/gridatlas | The national grid map, with dark and satellite modes. It receives a position and drops a "you are here" pin. |
| 3D world | Ventusltd/graphics-engines-open-source | The wireframe engine: walk, drone, buggy, design and trench tools. Frozen releases are published on globalgrid2050.com. |
| UK ground | Ventusltd/lidar | EA LiDAR fetch, local mirror (Parquet tiles, DuckDB index, GeoJSON coverage), GPU tiles. |
| World ground | Ventusltd/world-lidar | The open LiDAR and satellite elevation registry, and packs for other countries. |
| Substations | Ventusltd/substations | Substation survey: position, voltages, compound outline, confidence. |
| Maths cartridges | Ventusltd/primordial-brain | GPU cartridges with CPU witnesses, including the GridAtlas and world reconciliation. |

## Joins this repository defines

- **Place contract** (`contracts/place.v1.md`): one way to say where you are, shared by the GridAtlas pin, the world's link and the address bar.
- **Reconciliation** (planned): the rule that GridAtlas and the world agree on every asset, and the stated offset to the national grid transform.
- **Version pins** (planned): which GridAtlas generation and which world release are played together.
