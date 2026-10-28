# True Colors: pairwise colorization study

A small web app for a two-alternative forced-choice user study of automatic colorization.
Each participant sees 20 pairs: the same ImageNet photo colorized by two methods, and picks the
one that looks more like a real color photo. Live at <https://cmf-check.web.app> (Firebase
project `cmf-check`).

## Methods

| method | outputs |
|---|---|
| ColorMF B+D + FD (step 25k) + distilled autoguidance, w 2, ω 2 (the final one-pass model) | `scratch/hue/bdfd_agd_w2_omega2`, seed 1 (bit-identical to the val50k run, whose PNGs were deleted) |
| DDColor, released checkpoint, its own pipeline at its native input 512 | `ddcolor/results/val5k_crop256_pipeline_in512` |
| CtrlColor (IJCV 2025), automatic mode, DDIM 20 steps, CFG 7 | `baselines/ctrlcolor/val5k`, seed 1 |

`study/methods.json` maps the neutral codes used in URLs and data back to these. All three colorize the same 256×256 centre crops of the first 5k ImageNet val images (ColorMF
eval protocol) and keep the original L channel, so they differ only in chroma. Participants never
see method names: images live under neutral hash folders.

## Protocol

- **Pool:** 300 images drawn at random (seed 2026) from val5k, skipping near-grayscale originals
  (GT colorfulness < 5, 134 of 5000). Images are lossless WebP, so no chroma subsampling.
- **Batch of 20:** 18 real pairs plus 2 attention checks (GT against the GT with a\*b\* negated:
  blue faces, purple grass), one in each half, never in the first three. Images are fresh for the
  device until the pool runs out.
- **Allocation 12 / 3 / 3** (`design` in `pool.json`, `--alloc` in `build_pool.py`): 12 ColorMF vs
  DDColor, 3 ColorMF vs CtrlColor, 3 DDColor vs CtrlColor. CtrlColor (CF 62) loses almost every
  pair, so its pairs only anchor the Bradley-Terry scale and the main comparison gets two thirds
  of the judgements: ~360 at 30 people instead of ~180. Sessions store the design id; the two
  author test sessions of 28.10 used the earlier 6 / 6 / 6.
- **Sides:** each pair is randomly ordered. Landscape screens show left/right, portrait phones
  top/bottom (side by side would make each photo ~170 px wide on a phone). The slot and the layout
  are logged, so position bias can be checked.
- **No "can't tell" option.** A wrong tap can be undone with Back; the analysis keeps the
  latest answer.
- **The UI is achromatic** (neutral grays, no accent color) so nothing on the page tints the
  judgement.
- Reaction time is measured from the moment both images are on screen.

## Data

Firestore (eur3), create-only from clients, no client reads (`firestore.rules`):

- `sessions/{sid}`: name, per-device client id, language, pool version, user agent, viewport, DPR,
  time zone, server time.
- `answers/{sid}_{idx}_{rev}`: kind (`main`/`catch`), image, `first` and `second` (method codes in
  display order), `chosen`, layout (`row`/`column`), reaction time in ms, server time.

Writes are queued in `localStorage` and retried, so a flaky phone connection does not lose
answers; the last screen says whether everything reached the server.

## Analysis

```bash
npx firebase login          # once, as the project owner
node scripts/fetch_results.mjs   # -> results/sessions.json, results/answers.json
python3 scripts/analyze.py       # win rates, Wilson CIs, binomial p, Bradley-Terry
```

`analyze.py` drops sessions listed in `study/excluded_sessions.json` (author test runs), sessions
that picked a negated image and choices faster than 300 ms (`--include-excluded`,
`--keep-failed-catch`, `--min-rt` to change).

Judgements are not independent (a person's answers correlate, an image is judged by several
people), so intervals come from bootstraps over participants (device id) and images:

- **crossed bootstrap:** both resampled at once, judgement weight = product of the draw counts.
  It is conservative: per-judgement noise is counted about three times (Owen 2007), which
  dominates here because an image is judged only once or twice. On simulated data without any
  person or image effect it gives ±8% where the true ±5% is right.
- **two-way (Owen):** V = V_people + V_images − V_binomial from one-way bootstraps. It matches the
  binomial interval when there is no clustering and widens when there is (simulation with person
  and image effects: ±7.5% vs Wilson ±5% vs crossed ±10.5%).
- **naive Wilson**, for comparison only.

## Rebuild and deploy

```bash
npm install
python3 scripts/build_pool.py    # needs the ColorMF outputs on /mnt/IMAGING and the val5k GT
npm run dev                      # local; writes are a dry run unless the URL has ?live
npm run deploy                   # build + hosting + firestore rules
```

`public/img/` is not committed (ImageNet-derived); `build_pool.py` regenerates it deterministically.
Changing the pool changes its version string, and old in-progress sessions on devices are reset.
