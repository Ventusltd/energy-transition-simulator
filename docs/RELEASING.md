# Releasing

## One line: main

`main` is the only line of development. There are no feature branches and no release branches: work is
committed straight to `main` in small, locally gated commits. Versions, not branches, are the unit of
progress, because versions can be put side by side and cross-checked, while a branch that is never shipped
is forgotten.

## Every main commit becomes a dated version

A CD loop watches `origin/main`. Every 5 minutes it takes any new commit, runs a fresh-clone smoke test and a
names-and-paths scan, and publishes the commit as a dated version (`YYYYMMDDHHMM`) on globalgrid2050.com.
A push to `main` is therefore a release: it is live within about 5 to 10 minutes, or it is refused by the gate
and stays unpublished.

## Cross-checking versions

All published versions sit under `/energy-transition-simulator/` on the site, each in its own dated folder,
with `/latest/` pointing at the newest. Any two versions can be opened side by side at the same place
(the `?lat=..&lon=..` query) to compare what changed. Nothing is overwritten: an older version stays
where it was published.

## The gate before every push

Every commit is gated locally before it is pushed, and CI (`.github/workflows/overlay.yml`) repeats what it can
on every push to `main`:

1. `tests/overlay-smoke.cjs` and every other `tests/*.cjs` (CI runs them on software WebGL, so the GPU-only
   thresholds are checked locally on a real GPU; the known `ui` "far lines fade" check is tolerated in CI).
2. `tests/privacy-scan.cjs`: no local drive paths, no e-mail addresses, and no token whose sha256 is in
   `tests/privacy-hashes.json`. Only hashes are committed; the plain lists never enter this repository.
3. Locally only: the GPU look (the overlay at the reference farm renders VISIBLE, not blank) and the frame
   rate at 4K at the farm (at least 90 fps) with each module switched on.

If a change fails the gate it is fixed or left switched off. Red is never pushed, because red would become a
version.

## Rules

- No branches. No force-push. `git pull --rebase` before every push.
- Small commits, each one shippable on its own, even when the feature is incomplete.
- Private material (site names, addresses, drive paths, working registers) stays off this public repository.
