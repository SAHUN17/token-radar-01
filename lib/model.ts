// token-radar-01 — the radar's model.
//
// One sealed snapshot in, one ranked board out. Every pre-token protocol is scored by a single
// function of the snapshot's own figures — TVL, seven-day growth and time since first listed —
// never by a hand-written list of names. The watchlist is the floor (40 slugs at or above $50M TVL
// with no token on record), and the early radar adds the strongest pre-token protocols below that
// floor, so the board also surfaces the launches a reader would otherwise miss. Protocols whose
// token already trades are set aside in a separate live view and shown at their market cap, never
// mixed into the ranked board.

export interface SnapshotProtocol {
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
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// The model's constants. The dashboard states them and the sandbox may change them.
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.55,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.5,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 270,
};

export const MODEL_VERSION = 'radar-2';
export const EARLY_ROWS = 260;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// Whole days the protocol has been tracked as of the snapshot's date; null when it has no record.
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

// The one function that scores every row:
//   implied = round( tvl_usd x base_multiple x momentum x maturity )
//   momentum = 1 + clamp(change_7d, growth_floor, growth_cap) / 100 x growth_weight
//   maturity = maturity_floor + min(age_days, maturity_days) / maturity_days x maturity_range
// TVL is the size of the protocol; momentum rewards protocols whose deposits are still growing;
// maturity rewards a protocol that has stayed alive long enough to be a plausible launcher. A
// missing growth reads as 0 and a missing age as unknown_age_days, so a sparse record is scored,
// not skipped.
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

// One farm position's size, from the protocol's own TVL: a bigger protocol usually needs a bigger
// position to matter, so the plan scales it in four steps.
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

// How long to hold: younger protocols get a longer window so one snapshot can still catch the
// position across more than one rewards period.
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 365) return 60;
  return 45;
}

// The category's one concrete action, written so a farmer can follow it. The action names the
// protocol and its chain and states the capital, but it is derived from the category alone, never
// from a hand-written list of names.
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator')) return `Allocate $${capital} to a lending market that ${name} sets risk parameters for on ${chain}, and keep the position in the market it curates.`;
  if (c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in your wallet.`;
  if (c.includes('cdp') || c.includes('collateral')) return `Deposit $${capital} of collateral into ${name} on ${chain} and mint a small, well-collateralized position.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the LP position open.`;
  if (c.includes('rwa')) return `Mint or buy $${capital} of ${name}'s real-world-asset yield token on ${chain} and hold it.`;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small fraction against it to stay active.`;
  if (c.includes('restak')) return `Restake $${capital} of a staked asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('staking') || c.includes('stake pool')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the position.`;
  if (c.includes('payment')) return `Deposit $${capital} into a ${name} channel or route on ${chain} and keep the channel funded.`;
  if (c.includes('basis trading')) return `Deposit $${capital} of USDC into ${name}'s basis trade on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${name}'s yield strategy on ${chain} and keep the position open.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC onto ${name} on ${chain} and use one of its core apps to build activity.`;
  if (c.includes('cedefi')) return `Deposit $${capital} of USDC into ${name}'s CeDeFi yield on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC across ${name} on ${chain} and use the bridged funds in its app.`;
  if (c.includes('deriv') || c.includes('perpetual') || c.includes('option')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small, low-leverage position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name} on ${chain}.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold the basket.`;
  if (c.includes('privacy')) return `Move $${capital} through ${name} on ${chain} and keep a shielded balance there.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into ${name}'s managed liquidity on ${chain} and keep the position.`;
  if (c.includes('governance')) return `Lock $${capital} of the chain's asset with ${name} on ${chain}, vote in its governance and keep the position.`;
  if (c.includes('btc')) return `Bridge or mint $${capital} of a BTC-backed asset through ${name} on ${chain} and hold it.`;
  if (c.includes('otc')) return `Place a $${capital} limit order through ${name} on ${chain} and keep it quoted.`;
  if (c.includes('uncollateralized')) return `Deposit $${capital} into ${name}'s lending pool on ${chain} and keep the position open.`;
  if (c.includes('card')) return `Load $${capital} onto a ${name} card on ${chain} and use it for a few small payments.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

// A protocol's farm plan: eight steps, each an action with a cost and a time, all derived from the
// protocol's own record — category, chains, TVL and age — never from a hand-written list of names.
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week — a deposit, a borrow, a swap, a vote or a channel update — so the protocol logs your activity.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted across more than one rewards snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Keep the protocol's own points or rewards page bookmarked and check it every week for a new campaign or a claim window.`,
      cost: 'no fee to check',
      time: '5 minutes a week',
    },
    {
      text: `Before you withdraw, claim only from the link ${p.name} publishes itself; never pay anyone to claim on your behalf.`,
      cost: 'never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Watch the protocol's announcements for a token or points snapshot date and make sure your position is live on that date.`,
      cost: 'nothing but the position you already hold',
      time: '5 minutes when it is announced',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

// The protocols the board ranks, strongest first, ranks 1..n. The watchlist is the floor: every
// slug is chosen first, even one the snapshot no longer carries. The early radar then adds the
// strongest pre-token protocols below the floor, by TVL, capped at EARLY_ROWS; a chosen protocol
// stays chosen.
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, model);
    return { p, implied, growthPct, growthMult, maturityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

// The live-token protocols, by market cap, shown separately with the market's own value.
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

// A board row's compact form for data.js, with the farm plan carried whole so the page and the
// board carry the same steps.
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

// Everything the dashboard renders, from the snapshot.
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// The snapshot out of a file's text, refused unless it is the shape the model scores.
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

// Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied
// value, and the farm steps' count and length.
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

// A compact data.js: the dashboard's whole dataset as one script, no fetch and no network.
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
