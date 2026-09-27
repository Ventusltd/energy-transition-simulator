# Energy Transition Simulator

Walk real grid connections, see them, and model real trenches.

The simulator joins two engines into one experience:

- **GridAtlas.** The national grid map: substations, lines, and renewable projects from the public register. It already has dark and satellite modes.
- **The Site World.** A light wireframe 3D engine on real ground. It uses Environment Agency 1 m LiDAR in England, other open LiDAR where it exists, and open satellite elevation or a plainly labelled simulated plain everywhere else.

## The game loop

1. **Find a place.** Pick a substation, a solar farm or battery from the public register, a postcode, a grid reference or coordinates, on GridAtlas or in the address bar.
2. **Arrive and walk.** You land on real ground. A plain line of text always says what the ground is, for example "NO LIDAR data here - flat field is simulated using openly available data".
3. **Walk the connection route.** Go on foot, by buggy or by drone, from a 400, 275, 132, 66 or 33 kV substation to the site.
4. **Lay the cable.** Choose the route, the trench and the dig type (directional drill, soft dig or hard dig) and handle the crossings. The cable is sized and checked by our own methods, which cite BS 7671 and the other standards by clause number. Any check that fails shows as small red text.
5. **See what exists.** Operational solar farms appear as the LiDAR shows them, and you can design new ones beside them.
6. **Switch to GridAtlas at any moment.** A pin marks exactly where you are standing or flying, and one click brings you back.

## Principles

- **Show the truth; don't expose people.** No project, site or person names appear on screen.
- **Standards are cited, never copied.** Private rule files stay private.
- **Every coordinate is reconciled.** GridAtlas and the world must agree asset by asset, or the run fails. Agreement shows consistency, not truth, and the known offsets are stated.
- **The heavy work is done once, on a GPU, during development.** The player's device only draws, so it runs on a low-powered phone.

## Where the parts live

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [contracts/](contracts/).

## Status

This is an early integration. The work is in progress; see [docs/STATUS.md](docs/STATUS.md).
