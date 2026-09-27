#!/usr/bin/env python3
"""Export three wireframe skeletons from the wire-frame-scanner as a small JSON of line segments for the simulator.

The geometry is computed by the scanner's own Python functions (nothing is re-derived here):
  tower  - scanner/structures.py  tower_skeleton(EXAMPLE_PINS, ring_spacing_m, n_diagrid)
           floor rings + two helical diagrid families, radius profile = monotone PCHIP through the pins
  pylon  - scanner/pylon.py       lattice_pylon(400, bracing='K', n_arms_per_side=3)
           4 tapering legs, K bracing on every face, 3 cross-arms per side with insulator drops
  solar  - scanner/fictional.py   solar_block(...)  fixed-tilt tables stepped back at the stated pitch

Scanner location (repo Ventusltd/wire-frame-scanner, branch scanner/20260927): set WFS_PATH to its checkout
(the directory that holds scanner/). Default: /home/user/wfs. The scanner commit (git rev-parse HEAD in WFS_PATH)
and the sha256 of each scanner file used are written into the JSON, so the output is pinned to its source.

Usage:  WFS_PATH=/path/to/wire-frame-scanner python3 tools/export_skeletons.py [out.json]
Default output: prototype/mod/skeletons.data.json (kept under 200 KB; coordinates rounded to 1 mm).

Provenance: each object and value carries the scanner's own tag verbatim (`scanner_tag`) and a normalised
`provenance` in {measured, derived, assumed}. Rules of the normalisation:
  - a scanner tag 'measured' whose source is a placeholder ('cite source') is NOT cited, so it is exported as
    'assumed' (the tower's example pins are placeholders: a generic 100 m tower, not any real building);
  - 'rule-shaped between pins' (the PCHIP profile and rings, computed exactly from the pins) is 'derived';
  - 'assumed (design proposal)' (fictional.py) and 'assumed' (pylon.py) stay 'assumed'; 'derived' stays 'derived'.
All three objects are illustrative examples with assumed dimensions; none is measured and none is a real asset.
Placement offsets (metres east/north of the map centre) are an assumed display layout chosen here.
"""
import hashlib
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WFS = os.path.abspath(os.environ.get('WFS_PATH', '/home/user/wfs'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'prototype', 'mod', 'skeletons.data.json')

if not os.path.isfile(os.path.join(WFS, 'scanner', 'structures.py')):
    sys.exit(f'scanner not found at {WFS} (set WFS_PATH to a wire-frame-scanner checkout)')
sys.path.insert(0, WFS)
from scanner import structures, pylon, fictional  # noqa: E402  (the scanner's own code)

# ---- parameters (all illustrative, all assumed) ----
TOWER = dict(ring_spacing_m=5.0, n_diagrid=24)
PYLON = dict(voltage_class=400, bracing='K', n_arms_per_side=3)
SOLAR = dict(mw=1.0, module_w_wp=550, module_len_m=2.4, module_wid_m=1.1, modules_per_table=28, pitch_m=6.0,
             tilt_deg=20.0, azimuth_deg=180.0, table_rows=2, table_gap_m=0.5, front_h_m=0.8)
PLACE = {'tower': (-110.0, 0.0), 'pylon': (0.0, 0.0), 'solar': (200.0, -30.0)}   # metres east, north of map centre


def norm_tag(tag, source=None):
    t = str(tag)
    if t == 'measured':
        return 'assumed' if (not source or 'cite source' in str(source)) else 'measured'
    if t.startswith('rule-shaped') or t == 'derived':
        return 'derived'
    if t.startswith('assumed'):
        return 'assumed'
    raise ValueError(f'unknown scanner tag {t!r}')


def flat(segs):
    """((x,y,z),(x,y,z)[,kind]) -> [x0,y0,z0,x1,y1,z1, ...] rounded to 1 mm."""
    out = []
    for s in segs:
        a, b = s[0], s[1]
        out += [round(float(v), 3) + 0.0 for v in (*a, *b)]
    return out


def sha(p):
    with open(p, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def git(*a):
    try:
        return subprocess.check_output(['git', '-C', WFS, *a], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return None


# ---- tower ----
t_lines, t_model = structures.tower_skeleton(structures.EXAMPLE_PINS, **TOWER)
assert t_model['n_lines'] == t_model['n_lines_formula'] == len(t_lines)
kinds = {}
for s in t_lines:
    kinds[s[2]] = kinds.get(s[2], 0) + 1
tower = {
    'id': 'tower', 'label': 'Tower skeleton: floor rings and helical diagrid, PCHIP radius profile through pins',
    'function': 'scanner.structures.tower_skeleton', 'params': TOWER, 'place_m': PLACE['tower'],
    'provenance': 'assumed', 'scanner_label': t_model['label'],
    'note': 'Generic 100 m example tower from structures.EXAMPLE_PINS, not any real building; the pins are '
            'placeholders (source "measured (cite source)"), so exported as assumed.',
    'pins': [{'z': p['z'], 'r': p['r'], 'label': p['label'], 'scanner_tag': p['provenance'],
              'source': p['source'], 'provenance': norm_tag(p['provenance'], p['source'])} for p in t_model['pins']],
    'profile': {'method': t_model['profile']['method'], 'scanner_tag': t_model['profile']['provenance'],
                'provenance': norm_tag(t_model['profile']['provenance'])},
    'rings': [{'z': round(r['z'], 3), 'r': round(r['r'], 3), 'provenance': norm_tag(r['provenance'])}
              for r in t_model['rings']],
    'kinds': kinds, 'n_lines': len(t_lines), 'lines': flat(t_lines),
}

# ---- pylon ----
p_lines, p_model = pylon.lattice_pylon(PYLON['voltage_class'], bracing=PYLON['bracing'],
                                       n_arms_per_side=PYLON['n_arms_per_side'])
dims = {}
for k, v in p_model.items():
    if isinstance(v, dict) and 'tag' in v and k != 'insulator_drops':
        dims[k] = {'value': v['value'], 'scanner_tag': v['tag'], 'source': v['source'],
                   'provenance': norm_tag(v['tag'], v['source'])}
pyl = {
    'id': 'pylon', 'label': 'Lattice pylon skeleton: legs, K bracing, cross-arms, insulator drops',
    'function': 'scanner.pylon.lattice_pylon', 'params': PYLON, 'place_m': PLACE['pylon'],
    'provenance': 'assumed', 'note': 'Illustrative 400 kV-class dimensions, assumed (pylon._ASSUMED_DIMS), '
                                     'not from a published table; procedural fill, not a measurement.',
    'dims': dims, 'n_lines': len(p_lines), 'lines': flat(p_lines),
}

# ---- solar rows ----
s_model, s_segs = fictional.solar_block(**SOLAR)
keep = ('target_capacity', 'module_rating', 'modules_per_table', 'pitch', 'tilt', 'azimuth', 'table_length',
        'table_depth_horizontal', 'back_height', 'tables', 'tables_per_row', 'rows', 'modules', 'capacity')
sol = {
    'id': 'solar', 'label': 'Solar rows: fixed-tilt tables stepped back at the pitch',
    'function': 'scanner.fictional.solar_block', 'params': SOLAR, 'place_m': PLACE['solar'],
    'provenance': 'assumed', 'note': 'Fictional parametric design proposal (fictional.py); every value assumed.',
    'values': {k: {'value': s_model[k]['value'], 'unit': s_model[k]['unit'], 'scanner_tag': s_model[k]['provenance'],
                   'provenance': norm_tag(s_model[k]['provenance'])} for k in keep},
    'n_lines': len(s_segs), 'lines': flat(s_segs),
}

objs = [tower, pyl, sol]
doc = {
    'about': 'Wireframe skeletons exported from the wire-frame-scanner (illustrative example, dimensions assumed). '
             'Lines are [x0,y0,z0,x1,y1,z1,...] in local metres: x east, y north, z up from flat ground at 0, '
             'around each object\'s place_m offset from the map centre.',
    'provenance': 'assumed',
    'info': 'Skeletons: illustrative example, dimensions assumed (tower, lattice pylon, solar rows from the '
            'wire-frame-scanner; not measured, not real assets).',
    'source': {
        'repo': 'Ventusltd/wire-frame-scanner', 'branch': 'scanner/20260927', 'commit': git('rev-parse', 'HEAD'),
        'dirty': bool(git('status', '--porcelain', '--', 'scanner')),
        'files': {f'scanner/{n}': sha(os.path.join(WFS, 'scanner', n))
                  for n in ('structures.py', 'pylon.py', 'fictional.py')},
        'exporter': 'tools/export_skeletons.py',
    },
    'n_lines': sum(o['n_lines'] for o in objs),
    'objects': objs,
}
for o in objs:
    assert len(o['lines']) == 6 * o['n_lines']
txt = json.dumps(doc, separators=(',', ':'))
if len(txt) > 200_000:
    sys.exit(f'export too large: {len(txt)} bytes (limit 200 KB)')
with open(OUT, 'w') as f:
    f.write(txt + '\n')
print(f'wrote {OUT}: {len(txt)} bytes, {doc["n_lines"]} lines '
      f'(tower {tower["n_lines"]}, pylon {pyl["n_lines"]}, solar {sol["n_lines"]}), scanner {doc["source"]["commit"]}')
