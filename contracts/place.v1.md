# Place contract v1

One description of "where you are", used in both directions between GridAtlas and the world. The parameter names are GridAtlas's own.

| Parameter | Meaning | Rules |
|---|---|---|
| `latitude`, `longitude` | WGS84 degrees | 6 decimal places |
| `zoom` | Map zoom | GridAtlas uses 512 px tiles, so the world's metres-per-pixel maps to zoom minus 1 |
| `bearing` | Heading, degrees clockwise from north | 0 to 360, 1 decimal place |
| `pitch` | Degrees | |
| `basemap` | `dark` or `sat` | GridAtlas's existing modes, passed through unchanged |
| `mode` | `map` or `world` | |
| `from` | `site-world` when the world sent you | |
| `back` | URL to return to | Same-site origins only |

## Rules

- An explicit latitude and longitude always win over any default site.
- When sent from the world, the pin is "you are here, walking" or "you are here, drone", drawn as a heading chevron. It is never a project card and never a name.
- From a drone, the pin marks the ground point directly under the drone.
- Outside Great Britain, the world uses a local frame at the arrival point. Round trips must be exact to 1 mm.
