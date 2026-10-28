"""Pairwise preference results from results/*.json (run scripts/fetch_results.mjs first).

Keeps the latest revision of each trial, drops sessions that fail an attention check (picked the
negated-chroma image) and reports per-pair win rates with Wilson 95% intervals, a two-sided exact
binomial test against 50%, overall preference per method and Bradley-Terry scores.
"""

import argparse
import json
import math
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (math.nan, math.nan)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def binom_two_sided(k: int, n: int) -> float:
    pmf = [math.comb(n, i) / 2**n for i in range(n + 1)]
    return min(1.0, sum(p for p in pmf if p <= pmf[k] * (1 + 1e-9)))


def bradley_terry(wins: dict[tuple[str, str], int], methods: list[str], iters: int = 500) -> dict[str, float]:
    """MM algorithm (Hunter 2004); scores normalised to sum to 1."""
    s = {m: 1.0 for m in methods}
    for _ in range(iters):
        new = {}
        for i in methods:
            w = sum(wins.get((i, j), 0) for j in methods if j != i)
            den = sum((wins.get((i, j), 0) + wins.get((j, i), 0)) / (s[i] + s[j]) for j in methods if j != i)
            new[i] = w / den if den else s[i]
        tot = sum(new.values())
        s = {m: v / tot for m, v in new.items()}
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", type=Path, default=ROOT / "results")
    ap.add_argument("--keep-failed-catch", action="store_true")
    ap.add_argument("--min-rt", type=int, default=300, help="drop choices faster than this (ms)")
    args = ap.parse_args()

    meta = json.loads((ROOT / "study/methods.json").read_text())
    names = meta["codes"]
    sessions = {s["id"]: s for s in json.loads((args.results / "sessions.json").read_text())}
    answers = json.loads((args.results / "answers.json").read_text())

    latest: dict[tuple[str, int], dict] = {}
    for a in answers:
        key = (a["sid"], a["idx"])
        if key not in latest or a["rev"] > latest[key]["rev"]:
            latest[key] = a
    rows = list(latest.values())

    failed = {a["sid"] for a in rows if a["kind"] == "catch" and names[a["chosen"]] == "negated"}
    catch = [a for a in rows if a["kind"] == "catch"]
    print(f"sessions {len(sessions)}, participants (devices) {len({s['client'] for s in sessions.values()})}")
    print(f"catch trials {len(catch)}, failed {sum(names[a['chosen']] == 'negated' for a in catch)}; "
          f"sessions failing a catch: {len(failed)}")

    main_rows = [a for a in rows if a["kind"] == "main" and (args.keep_failed_catch or a["sid"] not in failed)]
    fast = [a for a in main_rows if a["rt"] < args.min_rt]
    main_rows = [a for a in main_rows if a["rt"] >= args.min_rt]
    print(f"main judgements {len(main_rows)} (dropped {len(fast)} under {args.min_rt} ms)\n")

    wins: Counter = Counter()
    for a in main_rows:
        other = a["second"] if a["chosen"] == a["first"] else a["first"]
        wins[(names[a["chosen"]], names[other])] += 1

    methods = sorted({names[c] for a in main_rows for c in (a["first"], a["second"])})
    print(f"{'pair':<26}{'n':>5}{'A wins':>9}{'95% CI':>17}{'p':>9}")
    for a, b in combinations(methods, 2):
        k, n = wins[(a, b)], wins[(a, b)] + wins[(b, a)]
        if n == 0:
            continue
        lo, hi = wilson(k, n)
        print(f"{a + ' vs ' + b:<26}{n:>5}{k / n:>9.1%}{f'[{lo:.1%}, {hi:.1%}]':>17}{binom_two_sided(k, n):>9.3g}")

    shown = defaultdict(int)
    won = defaultdict(int)
    for (w, l), c in wins.items():
        won[w] += c
        shown[w] += c
        shown[l] += c
    bt = bradley_terry(dict(wins), methods)
    print(f"\n{'method':<12}{'chosen':>9}{'of shown':>10}{'Bradley-Terry':>15}")
    for m in sorted(methods, key=lambda m: -bt[m]):
        print(f"{m:<12}{won[m]:>9}{won[m] / shown[m]:>10.1%}{bt[m]:>15.3f}")

    side = Counter(a["chosen"] == a["first"] for a in main_rows)
    print(f"\nfirst slot chosen {side[True] / max(1, len(main_rows)):.1%} (left or top; position bias check)")


if __name__ == "__main__":
    main()
