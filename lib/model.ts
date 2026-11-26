// Launch Radar model v3 — a category-calibrated token launch radar.
//
// Everything the board claims is derived from the sealed snapshot's own
// figures, in three steps:
//
//   1. CALIBRATION. Protocols whose token already trades carry both a TVL
//      and a market cap in the snapshot. Per category, the median
//      mcap/TVL of those launched protocols is the category's raw
//      multiple. It is shrunk toward the global median with weight
//      n/(n+10) (a category with three members barely moves off the
//      global figure; one with thirty stands mostly on its own), then
//      clamped to [0.04, 1.60]. Categories with fewer than 3 launched
//      members are additionally capped at 2.5x the global median, so a
//      two-member outlier cannot price a whole category.
//
//   2. ADJUSTMENT. A pre-token protocol's implied value is
//        TVL x category multiple x growth x maturity x breadth
//      growth   = 1 + 0.55 * tanh(change_7d / 30)   (change_7d is in %;
//                 a protocol shrinking 30% in a week is marked down, one
//                 growing 30% is marked up, and a freak +4,000% print
//                 saturates instead of exploding the board)
//      maturity = 0.72 + 0.55 * (1 - exp(-age_days / 520))
//                 (a protocol that has run for years with no token has
//                 proved the TVL is real; a three-week-old one has not.
//                 Unknown listing dates use the candidate median age.)
//      breadth  = 1 + 0.06 * log2(chain count), capped at 1.18
//                 (the same product live on four chains reaches more
//                 wallets at launch than a single-chain one.)
//
//   3. SEPARATION. The universe is every protocol that records no token
//      and is not a wrapped, staked or bridged product of one that
//      trades — the snapshot watchlist's own exclusion rule, applied to
//      the whole snapshot with no TVL floor. The 416 protocols whose
//      token already trades are never ranked; the dashboard lists them
//      separately at their recorded market value.
//
// No protocol name is ever special-cased: two protocols with the same
// category, TVL, growth, age and chains always get the same value.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface DetailRow extends BoardRow {
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  segment: 'watchlist' | 'early';
  multiple: number;
  growth: number;
  maturity: number;
  breadth: number;
  band_low_usd: number;
  band_high_usd: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface CalibrationRow {
  category: string;
  launched: number;
  median_ratio: number;
  multiple: number;
}

export interface Radar {
  as_of: string;
  model: string;
  scanned: number;
  watchlist_size: number;
  early_size: number;
  live_size: number;
  global_median: number;
  median_age_days: number;
  calibration: CalibrationRow[];
  rows: DetailRow[];
  live: LiveRow[];
}

const DAY_MS = 86_400_000;

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** The watchlist's own exclusion test, minus its $50M floor. */
export function isWrappedOrStakedProduct(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return true;
  return false;
}

export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function ageDays(p: Protocol, asOfMs: number): number | null {
  if (p.listed_at === null) return null;
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (Number.isNaN(listed)) return null;
  return Math.max(0, Math.round((asOfMs - listed) / DAY_MS));
}

/** Per-category multiples measured from the snapshot's launched protocols. */
export function calibrate(snapshot: Snapshot): { globalMedian: number; rows: CalibrationRow[]; byCategory: Map<string, number> } {
  const all: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const globalMedian = median(all);
  const rows: CalibrationRow[] = [];
  const byCategory = new Map<string, number>();
  for (const [category, ratios] of [...perCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const med = median(ratios);
    const n = ratios.length;
    let multiple = (n * med + 10 * globalMedian) / (n + 10);
    if (n < 3) multiple = Math.min(multiple, 2.5 * globalMedian);
    multiple = Math.min(1.6, Math.max(0.04, multiple));
    rows.push({ category, launched: n, median_ratio: round4(med), multiple: round4(multiple) });
    byCategory.set(category, multiple);
  }
  return { globalMedian, rows, byCategory };
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
function round3(x: number): number {
  return Math.round(x * 1_000) / 1_000;
}

// ------------------------------------------------------------------ farm plans

const GAS_BANDS: Record<string, { label: string; usd: string }> = {
  Ethereum: { label: 'Ethereum mainnet', usd: '$6–$20' },
  Arbitrum: { label: 'Arbitrum', usd: '$0.10–$0.60' },
  Optimism: { label: 'Optimism', usd: '$0.10–$0.60' },
  Base: { label: 'Base', usd: '$0.05–$0.40' },
  BSC: { label: 'BNB Chain', usd: '$0.10–$0.50' },
  Solana: { label: 'Solana', usd: '$0.02–$0.10' },
  Polygon: { label: 'Polygon', usd: '$0.01–$0.10' },
  Avalanche: { label: 'Avalanche', usd: '$0.10–$0.80' },
  zkSync: { label: 'zkSync Era', usd: '$0.10–$0.60' },
  Linea: { label: 'Linea', usd: '$0.10–$0.60' },
  Scroll: { label: 'Scroll', usd: '$0.10–$0.60' },
  Mantle: { label: 'Mantle', usd: '$0.05–$0.40' },
};

function gasFor(chains: string[]): { label: string; usd: string } {
  for (const c of chains) if (GAS_BANDS[c] !== undefined) return GAS_BANDS[c]!;
  return { label: chains[0] ?? 'its main chain', usd: '$0.50–$3' };
}

const CATEGORY_ACTIONS: Record<string, string> = {
  Lending: 'supply a blue-chip collateral asset and take one small borrow-and-repay cycle',
  Dexs: 'swap both directions in its deepest pool and add a small two-sided LP position',
  'Risk Curators': 'deposit into its flagship curated vault and keep the position through a full reporting cycle',
  Yield: 'deposit into its main vault and let one full harvest cycle compound',
  'Onchain Capital Allocator': 'allocate into its main strategy vault and hold through one rebalancing window',
  RWA: 'complete its onboarding and hold its smallest tokenised real-world-asset position',
  'Yield Aggregator': 'deposit into its largest auto-compounding vault and keep it through two harvests',
  'Perps DEX': 'open and close small hedged perpetual positions on two different markets',
  Derivatives: 'trade one small contract end to end, open to settlement',
  'Cross Chain Bridge': 'bridge a small amount across two of its routes in both directions',
  Bridge: 'bridge a small amount across two of its routes in both directions',
  'Launchpad': 'join its current sale or waitlist round with the minimum ticket',
  Indexes: 'buy and hold its smallest index basket position',
  'Basis Trading': 'open its smallest basis position and hold it through one funding cycle',
  'Leveraged Farming': 'open its smallest leveraged position at the lowest leverage tier',
  'Options': 'buy one small, short-dated option contract and hold it to expiry',
  'Prediction Market': 'take small positions on three open markets and settle at least one',
  Gaming: 'create a profile, finish its starter quests and make its smallest in-game purchase',
  NFT: 'mint or buy its cheapest listed collection piece and hold it',
  'NFT Marketplace': 'list one item and complete one small purchase',
  'Privacy': 'make one shielded deposit and one shielded transfer',
  'Chain': 'deploy one test contract and make daily small transfers on it',
  'Payments': 'make one real payment through it to a second wallet you control',
};

function actionFor(category: string): string {
  return CATEGORY_ACTIONS[category] ?? `use its core ${category.toLowerCase()} product end to end with a real, if small, position`;
}

function positionFor(tvl: number): string {
  if (tvl >= 500_000_000) return '$500–$1,000';
  if (tvl >= 100_000_000) return '$250–$500';
  if (tvl >= 25_000_000) return '$100–$250';
  return '$50–$100';
}

function holdWeeks(age: number | null): number {
  if (age === null) return 10;
  if (age >= 900) return 6;
  if (age >= 365) return 8;
  if (age >= 120) return 12;
  return 16;
}

/** Seven concrete steps, each naming a cost and a time, built from the record itself. */
export function farmPlan(p: Protocol, age: number | null): string[] {
  const gas = gasFor(p.chains);
  const chainList = p.chains.slice(0, 3).join(', ') || gas.label;
  const size = positionFor(p.tvl_usd);
  const weeks = holdWeeks(age);
  const category = p.category ?? 'Uncategorised';
  return [
    `Set up: create a fresh wallet profile for ${p.name} on ${gas.label}, fund it with ${size} plus gas money, and bookmark only the official app link. Cost: ${gas.usd} in gas to fund and approve; time: about 20 minutes.`,
    `Core action (week 1): on ${chainList}, ${actionFor(category)} with ${size}. Cost: ${gas.usd} gas plus any protocol fee shown before you sign; time: about 30 minutes.`,
    `Second surface (week 1–2): repeat a smaller action on a second product or chain of ${p.name} (${chainList}) at half the first size, so your history is not one single transaction. Cost: ${gas.usd}; time: about 20 minutes.`,
    `Cadence: return once a week for ${weeks} weeks and repeat the core action at a small size, varying the amount and day so the pattern reads as real use. Cost: ${gas.usd} per visit; time: about 15 minutes a week.`,
    `Position: keep at least half of the ${size} position open for the full ${weeks} weeks; snapshots for launches usually reward duration and balance, not one-day spikes. Cost: opportunity cost only, no gas; time: 5 minutes a week to check it is intact.`,
    `Signals: follow ${p.name}'s official announcements and governance forum weekly, join any public points, waitlist or testnet programme it opens, and vote in its governance polls if a tokenless vote exists. Cost: $0; time: about 10 minutes a week.`,
    `At a launch: claim only through the official announcement link, verify the contract address twice before signing, and never pay a third party to claim for you. Cost: ${gas.usd} claim gas; time: about 15 minutes on claim day.`,
  ];
}

// ------------------------------------------------------------------ the radar

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const { globalMedian, rows: calibration, byCategory } = calibrate(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  const candidates = snapshot.protocols.filter((p) => recordsNoToken(p) && !isWrappedOrStakedProduct(p));
  const ages = candidates.map((p) => ageDays(p, asOfMs)).filter((a): a is number => a !== null);
  const medianAge = Math.round(median(ages));

  const details: DetailRow[] = [];
  for (const p of candidates) {
    const age = ageDays(p, asOfMs);
    const effectiveAge = age ?? medianAge;
    const multiple = byCategory.get(p.category ?? 'Uncategorised') ?? globalMedian;
    const growth = p.change_7d === null ? 1 : 1 + 0.55 * Math.tanh(p.change_7d / 30);
    const maturity = 0.72 + 0.55 * (1 - Math.exp(-effectiveAge / 520));
    const breadth = Math.min(1.18, 1 + 0.06 * Math.log2(Math.max(1, p.chains.length)));
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growth * maturity * breadth));
    // The band widens when the category's calibration rests on few launched peers.
    const peers = calibration.find((c) => c.category === (p.category ?? 'Uncategorised'))?.launched ?? 0;
    const spread = peers >= 10 ? 0.45 : peers >= 4 ? 0.6 : 0.8;
    details.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmPlan(p, age),
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      segment: watchlist.has(p.slug) ? 'watchlist' : 'early',
      multiple: round4(multiple),
      growth: round3(growth),
      maturity: round3(maturity),
      breadth: round3(breadth),
      band_low_usd: Math.round(implied * (1 - spread)),
      band_high_usd: Math.round(implied * (1 + spread)),
    });
  }
  details.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  details.forEach((row, i) => {
    row.rank = i + 1;
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : 0,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);

  const radar: Radar = {
    as_of: snapshot.as_of,
    model: 'launch-radar-3',
    scanned: snapshot.protocols.length,
    watchlist_size: details.filter((r) => r.segment === 'watchlist').length,
    early_size: details.filter((r) => r.segment === 'early').length,
    live_size: live.length,
    global_median: round4(globalMedian),
    median_age_days: medianAge,
    calibration,
    rows: details,
    live: live.slice(0, 160),
  };
  const board: BoardRow[] = details.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));
  return { board, radar };
}

/** The dashboard's data, as one script the static page loads beside itself. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** A gate-shaped board check, so the program refuses its own bad output. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `only ${board.length} rows, the gate needs at least 100`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const [i, row] of board.entries()) {
    if (!known.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${i + 1}: bad implied value`;
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1}: implied value rises with rank`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1}: ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
