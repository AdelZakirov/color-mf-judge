"""Pairwise preference results from results/*.json (run scripts/fetch_results.mjs first).

Keeps the latest revision of each trial, drops sessions listed in study/excluded_sessions.json and
sessions that fail an attention check (picked the negated-chroma image), then reports per-pair win
rates and Bradley-Terry scores.

Judgements are not independent: one person's answers are correlated, and one image is judged by
several people. Intervals therefore come from a crossed bootstrap that resamples participants
(devices) and images at the same time; each judgement is weighted by the product of how often its
participant and its image were drawn.

That product-weight ("pigeonhole") bootstrap is conservative: it counts the per-judgement noise
about three times (Owen 2007, Ann. Appl. Stat.), which dominates when each image is judged only once
or twice. So the table also gives Owen's two-way variance, V = V_people + V_images - V_naive, from
one-way bootstraps over people and over images; it reduces to the binomial variance when there is no
person or image effect. The naive Wilson interval is printed for comparison only.
"""

import argparse
import json
import math
from collections import Counter
from itertools import combinations
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def bradley_terry(w: np.ndarray, iters: int = 200) -> np.ndarray:
    """MM algorithm (Hunter 2004) on a win matrix w[i, j] = (weighted) wins of i over j; sums to 1."""
    n = w + w.T
    s = np.ones(len(w)) / len(w)
    for _ in range(iters):
        # a method that never wins in a bootstrap draw drives its score to 0; 0/0 pairs count as 0
        with np.errstate(divide="ignore", invalid="ignore"):
            den = np.nan_to_num(n / (s[:, None] + s[None, :])).sum(1)
        s = np.where(den > 0, w.sum(1) / np.maximum(den, 1e-12), s)
        s = s / s.sum()
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", type=Path, default=ROOT / "results")
    ap.add_argument("--include-excluded", action="store_true", help="ignore study/excluded_sessions.json")
    ap.add_argument("--keep-failed-catch", action="store_true")
    ap.add_argument("--min-rt", type=int, default=300, help="drop choices faster than this (ms)")
    ap.add_argument("--boot", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    names = json.loads((ROOT / "study/methods.json").read_text())["codes"]
    excluded = {} if args.include_excluded else json.loads((ROOT / "study/excluded_sessions.json").read_text())
    sessions = {s["id"]: s for s in json.loads((args.results / "sessions.json").read_text())}
    answers = json.loads((args.results / "answers.json").read_text())

    latest: dict[tuple[str, int], dict] = {}
    for a in answers:
        key = (a["sid"], a["idx"])
        if key not in latest or a["rev"] > latest[key]["rev"]:
            latest[key] = a
    rows = [a for a in latest.values() if a["sid"] not in excluded]
    print(f"sessions {len(sessions)}, excluded by list {len(set(excluded) & set(sessions))}")

    failed = {a["sid"] for a in rows if a["kind"] == "catch" and names[a["chosen"]] == "negated"}
    catch = [a for a in rows if a["kind"] == "catch"]
    print(f"catch trials {len(catch)}, failed {sum(names[a['chosen']] == 'negated' for a in catch)}; "
          f"sessions failing a catch: {len(failed)}")

    main_rows = [a for a in rows if a["kind"] == "main" and (args.keep_failed_catch or a["sid"] not in failed)]
    fast = [a for a in main_rows if a["rt"] < args.min_rt]
    main_rows = [a for a in main_rows if a["rt"] >= args.min_rt]
    if not main_rows:
        print("no judgements left")
        return

    # participant = device (client id), so two sessions on one phone count as one person
    person = [sessions.get(a["sid"], {}).get("client", a["sid"]) for a in main_rows]
    people, p_idx = np.unique(person, return_inverse=True)
    images, i_idx = np.unique([a["image"] for a in main_rows], return_inverse=True)
    methods = sorted({names[c] for a in main_rows for c in (a["first"], a["second"])})
    m_of = {m: k for k, m in enumerate(methods)}
    win = np.array([m_of[names[a["chosen"]]] for a in main_rows])
    lose = np.array([m_of[names[a["second"] if a["chosen"] == a["first"] else a["first"]]] for a in main_rows])
    print(f"main judgements {len(main_rows)} from {len(people)} participants on {len(images)} images "
          f"(dropped {len(fast)} under {args.min_rt} ms)")
    if len(people) < 10:
        print(f"WARNING: {len(people)} participants; bootstrap intervals over people are not meaningful yet")
    print()

    def stats(weight: np.ndarray) -> tuple[dict, np.ndarray, np.ndarray]:
        w = np.zeros((len(methods), len(methods)))
        np.add.at(w, (win, lose), weight)
        rate = {(a, b): w[i, j] / (w[i, j] + w[j, i]) if w[i, j] + w[j, i] else np.nan
                for (i, a), (j, b) in combinations(enumerate(methods), 2)}
        share = w.sum(1) / np.maximum(w.sum(1) + w.sum(0), 1e-12)
        return rate, bradley_terry(w), share

    rate0, bt0, share0 = stats(np.ones(len(main_rows)))
    rng = np.random.default_rng(args.seed)
    boot_rate = {k: [] for k in rate0}
    one_way = {k: ([], []) for k in rate0}  # (people only, images only)
    boot_bt, boot_share = [], []
    for _ in range(args.boot):
        wp = np.bincount(rng.integers(len(people), size=len(people)), minlength=len(people))[p_idx]
        wi = np.bincount(rng.integers(len(images), size=len(images)), minlength=len(images))[i_idx]
        r, bt, sh = stats((wp * wi).astype(float))
        rp, ri = stats(wp.astype(float))[0], stats(wi.astype(float))[0]
        for k in r:
            boot_rate[k].append(r[k])
            one_way[k][0].append(rp[k])
            one_way[k][1].append(ri[k])
        boot_bt.append(bt)
        boot_share.append(sh)
    ci = lambda xs: np.nanpercentile(xs, [2.5, 97.5])

    print(f"{'pair':<24}{'n':>5}{'A wins':>8}{'crossed bootstrap':>20}{'p':>7}{'two-way (Owen)':>18}"
          f"{'naive Wilson':>18}")
    for (a, b), r in rate0.items():
        i, j = m_of[a], m_of[b]
        k = int(((win == i) & (lose == j)).sum())
        n = k + int(((win == j) & (lose == i)).sum())
        if n == 0:
            continue
        xs = np.array(boot_rate[(a, b)])
        xs = xs[~np.isnan(xs)]
        lo, hi = ci(xs)
        p = min(1.0, 2 * min((xs <= 0.5).mean(), (xs >= 0.5).mean()))
        vp, vi = np.nanvar(one_way[(a, b)][0]), np.nanvar(one_way[(a, b)][1])
        # the difference can fall below either one-way variance (few people, or noisy estimates);
        # it is never allowed to: clustering cannot make the estimate more precise than one way
        v = max(vp + vi - r * (1 - r) / n, vp, vi)
        half = 1.96 * math.sqrt(v)
        olo, ohi = max(0.0, r - half), min(1.0, r + half)
        wl, wh = wilson(k, n)
        print(f"{a + ' vs ' + b:<24}{n:>5}{r:>8.1%}{f'[{lo:.1%}, {hi:.1%}]':>20}{p:>7.3f}"
              f"{f'[{olo:.1%}, {ohi:.1%}]':>18}{f'[{wl:.1%}, {wh:.1%}]':>18}")

    boot_bt, boot_share = np.array(boot_bt), np.array(boot_share)
    print(f"\n{'method':<12}{'chosen':>8}{'95% CI':>18}{'Bradley-Terry':>15}{'95% CI':>18}")
    for m in sorted(methods, key=lambda m: -bt0[m_of[m]]):
        k = m_of[m]
        slo, shi = ci(boot_share[:, k])
        blo, bhi = ci(boot_bt[:, k])
        print(f"{m:<12}{share0[k]:>8.1%}{f'[{slo:.1%}, {shi:.1%}]':>18}{bt0[k]:>15.3f}{f'[{blo:.3f}, {bhi:.3f}]':>18}")

    side = Counter(a["chosen"] == a["first"] for a in main_rows)
    print(f"\nfirst slot chosen {side[True] / len(main_rows):.1%} (left or top; position bias check)")
    print(f"bootstrap: {args.boot} draws over participants and images, seed {args.seed}")


if __name__ == "__main__":
    main()
