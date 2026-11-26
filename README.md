# Launch Radar — token launch radar (model v3)

A make.fun **token-radar-01** entry: a Node 22 TypeScript program (standard
library only) that reads the sealed DefiLlama snapshot and ranks the
protocols whose token does not exist yet by what that token could be worth.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Writes `board.json` (198 ranked rows), `data.js`, a static `dashboard/`,
`screenshots/` and `dossier.json` (via the vendored `buildDossier`) into the
output directory. Two runs write identical bytes; the program verifies its
own dossier against a rebuild before it exits.

## The model

Implied value = **TVL × category multiple × growth × maturity × breadth**

- **Category multiple** — measured from the snapshot itself: the median
  market-cap/TVL of the protocols in that category whose token already
  trades, shrunk toward the global median (0.205) with weight n/(n+10),
  clamped to [0.04, 1.60]; categories with fewer than 3 launched peers are
  capped at 2.5× the global median.
- **Growth** = 1 + 0.55·tanh(7d TVL change / 30) — saturating, so one freak
  print cannot price a protocol.
- **Maturity** = 0.72 + 0.55·(1 − e^(−age/520d)) — years run with no token
  count for something; unknown listing dates use the candidate median age.
- **Breadth** = 1 + 0.06·log2(chains), capped at 1.18.

The universe is the snapshot watchlist's own exclusion rule (no token
recorded; not a wrapped, staked or bridged product of a traded token; no
version-suffixed names; no exchange-prefixed names) applied to the whole
snapshot with no TVL floor: all 40 watchlist protocols plus 158 early
finds. The 128 protocols with a recorded market cap are never ranked —
they are the calibration set, shown in the dashboard's "Already launched"
view at market value.

Every row carries a 7-step farm plan generated from its own record
(category action, main-chain gas band, TVL-tier position size, age-based
holding period), each step naming a dollar cost and a time.

## Dashboard

`dashboard/` is a static page with no network and no framework: sortable
board, search, category and chain filters, Watchlist / Early finds /
Already launched segments, a per-protocol detail view with the full
multiplier breakdown and farm plan, the published calibration table, and
deep links (`?seg=early&select=<slug>`). Its three screenshots are real
renders of the page.

## Layout

- `main.ts` — entrypoint: read snapshot, write board, data, dashboard,
  screenshots, dossier; self-verifies the dossier.
- `lib/model.ts` — calibration, ranking, farm plans, gate-shaped self-check.
- `vendor/makefun-board.ts` — make.fun's vendored dossier library.
- `dashboard/`, `screenshots/` — the hand-in page and its images.

MIT licensed.
