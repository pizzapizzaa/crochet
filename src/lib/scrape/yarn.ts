import { fetchPage, isFetchableUrl, stripTags } from './html';
import { scrapeProduct, tidySourceUrl } from './product';
import { HOOK_SIZES, YARN_WEIGHTS, hookLabel } from '../yarnWeights';
import type { YarnWeight } from '../yarnWeights';

/*
 * Reading a yarn's specs off the page that sells it, for the pattern generator.
 *
 * The product scraper gets us the name, brand and photos, but almost no shop
 * puts the numbers a crocheter needs into structured data. They are written
 * out for people instead — a "Product Details" list on Hobby Lobby, a
 * parameter table on Taobao — as "Label: value" lines in whatever units the
 * shop thinks in. So this works on the page as text, one line at a time, and
 * converts everything into what the generator counts in: grams, metres, and
 * stitches per 5cm.
 *
 * Two rules shape it:
 *
 *  - Nothing is filled that the page did not say, with one exception made in
 *    the open: a weight category with no label is inferred from metres per
 *    gram, and flagged as inferred.
 *  - Gauge is only ever taken from a line that says it is a *crochet* gauge.
 *    The label's gauge is nearly always a knitting one, and a knitting gauge in
 *    the crochet boxes would quietly produce the wrong stitch counts. It is
 *    passed back as a reference instead.
 */

export interface Gauge {
  stitchesPer5cm: number;
  rowsPer5cm: number;
  /** 'sc', 'hdc', 'dc' or 'tr' when the gauge names the stitch it was worked in. */
  stitch: string | null;
}

export type SpecField = 'weight' | 'hook' | 'ball' | 'crochetGauge' | 'referenceGauge' | 'colour' | 'fibre';

export interface YarnSpecs {
  sourceUrl: string | null;
  siteName: string | null;
  name: string | null;
  brand: string | null;
  colour: string | null;
  fibre: string | null;
  weight: YarnWeight | null;
  /** False when the category was worked out from metres per gram. */
  weightStated: boolean;
  hookMm: number | null;
  /** The hook as the generator's list spells it — its nearest size where one is close. */
  hook: string | null;
  ballGrams: number | null;
  ballMeters: number | null;
  metersPerGram: number | null;
  crochetGauge: Gauge | null;
  /** A knitting gauge, or one that does not say — shown, never filled in. */
  referenceGauge: (Gauge & { kind: 'knit' | 'unspecified' }) | null;
  /** The line each value was read from, so the form can show its working. */
  evidence: Partial<Record<SpecField, string>>;
}

export interface YarnOutcome {
  specs: YarnSpecs;
  /** True when enough came back to be worth filling the form with. */
  found: boolean;
  /** Said to the user verbatim — what to do next, not what broke. */
  note: string | null;
}

/* ── Numbers and units ────────────────────────────────────────────── */

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;

/** "1,000" is a thousand; "2,5" is two and a half. */
function toNumber(raw: string): number {
  return Number(raw.replace(/,(?=\d{3}(?!\d))/, '').replace(',', '.'));
}

const round1 = (value: number) => Math.round(value * 10) / 10;

const OUNCE_G = 28.3495;
const YARD_M = 0.9144;
const INCH_CM = 2.54;

// Units are followed by a lookahead rather than \b, which does not work next to
// Chinese characters. `m(?![a-z])` is also what keeps "5mm" from reading as
// five metres.
const MASS = new RegExp(`${NUM}\\s*(ounces?|oz|grams?|gr|g|克)(?![a-z])`, 'gi');
const LENGTH = new RegExp(`${NUM}\\s*(yards?|yds?|metres?|meters?|m|米)(?![a-z])`, 'gi');

function grams(value: number, unit: string): number {
  return /^o/i.test(unit) ? value * OUNCE_G : value;
}

function metres(value: number, unit: string): number {
  return /^y/i.test(unit) ? value * YARD_M : value;
}

/* ── Lines ────────────────────────────────────────────────────────── */

interface Line {
  text: string;
  /** Lower-cased label before the colon, when the line has one. */
  label: string | null;
  value: string;
}

/** Spec lists are short lines; a paragraph of marketing is not one of them. */
const MAX_LINE = 220;

function toLines(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/：/g, ':')
      .replace(/[•·▪●◆■*]\s*/g, '')
      .replace(/[“”″]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line || line.length > MAX_LINE) continue;
    const labelled = line.match(/^([^:]{1,40}):\s*(.*)$/);
    out.push(
      labelled
        ? { text: line, label: labelled[1].trim().toLowerCase(), value: labelled[2].trim() }
        : { text: line, label: null, value: line },
    );
  }
  return out;
}

const evidenceOf = (line: Line) => line.text.slice(0, 140);

/* ── Weight category ──────────────────────────────────────────────── */

/** The Craft Yarn Council's 0–7; the generator has no jumbo, so 7 joins 6. */
const CYC: YarnWeight[] = ['lace', 'fingering', 'sport', 'dk', 'worsted', 'bulky', 'super-bulky', 'super-bulky'];

/*
 * Checked in order, so the longer names come first: "super bulky" before
 * "bulky", "light worsted" before "worsted", and 极粗 before the 粗 inside it.
 */
const WEIGHT_WORDS: [RegExp, YarnWeight][] = [
  [/super\s*(?:bulky|chunky)|\bjumbo\b|\broving\b|极粗|超粗/i, 'super-bulky'],
  [/\bbulky\b|\bchunky\b|\b1[24]\s*-?\s*ply\b|粗线/i, 'bulky'],
  [/light\s*worsted|\bdk\b|double\s*knit|\b8\s*-?\s*ply\b/i, 'dk'],
  [/\baran\b|\bworsted\b|\bafghan\b|\b10\s*-?\s*ply\b|中粗/i, 'worsted'],
  [/\bsport\b|\b5\s*-?\s*ply\b/i, 'sport'],
  [/\bfingering\b|\bsock\b|super\s*fine|\b[34]\s*-?\s*ply\b|细线/i, 'fingering'],
  [/\blace\b|\bcobweb\b|\b[12]\s*-?\s*ply\b/i, 'lace'],
];

/*
 * The Craft Yarn Council's own names. Only trusted on a line labelled as the
 * yarn's weight — "medium" and "light" turn up everywhere else on a page.
 */
const LABEL_ONLY_WORDS: [RegExp, YarnWeight][] = [
  [/super\s*fine/i, 'fingering'],
  [/\bmedium\b/i, 'worsted'],
  [/\blight\b/i, 'dk'],
  [/\bfine\b/i, 'sport'],
];

const WEIGHT_LABEL = /yarn\s*weight|weight\s*(?:category|class|group)|^weight$|thickness|^ply$|粗细/i;

function wordWeight(text: string, table: [RegExp, YarnWeight][]): YarnWeight | null {
  for (const [re, weight] of table) if (re.test(text)) return weight;
  return null;
}

function statedWeight(lines: Line[], name: string | null): { weight: YarnWeight; line: string } | null {
  for (const line of lines) {
    if (!line.label || !WEIGHT_LABEL.test(line.label)) continue;
    const cyc = line.value.match(/^\(?([0-7])\)?(?!\s*(?:ply|股|mm|g|oz))\b/i);
    if (cyc) return { weight: CYC[Number(cyc[1])], line: evidenceOf(line) };
    const word =
      wordWeight(line.value, WEIGHT_WORDS) ?? wordWeight(line.value, LABEL_ONLY_WORDS);
    if (word) return { weight: word, line: evidenceOf(line) };
  }

  for (const line of lines) {
    const cyc = line.text.match(/\b(?:cyc|craft\s*yarn\s*council)\D{0,12}([0-7])\b/i);
    if (cyc) return { weight: CYC[Number(cyc[1])], line: evidenceOf(line) };
  }

  // Shops often put the category in the product name: "Simply DK", "Aran Tweed".
  if (name) {
    const word = wordWeight(name, WEIGHT_WORDS);
    if (word) return { weight: word, line: name.slice(0, 140) };
  }
  return null;
}

/** The category whose typical metres per gram is nearest, measured as a ratio. */
function inferredWeight(metersPerGram: number): YarnWeight {
  let best = YARN_WEIGHTS[0];
  for (const candidate of YARN_WEIGHTS) {
    const distance = Math.abs(Math.log(candidate.metersPerGram / metersPerGram));
    if (distance < Math.abs(Math.log(best.metersPerGram / metersPerGram))) best = candidate;
  }
  return best.value;
}

/* ── Ball size ────────────────────────────────────────────────────── */

/** Lines where a weight or a length means something other than the ball. */
const NOT_THE_BALL = /gauge|tension|hook|needle|ship|deliver|dimension|package|price|\$|密度|钩针|针号|运费/i;
const MASS_LABEL = /weight|skein|ball|net|重量|克重|净重|每团|单团/i;
const LENGTH_LABEL = /yardage|length|meterage|yards|metres|meters|长度|米数/i;

function firstMatch(re: RegExp, text: string): RegExpMatchArray | null {
  re.lastIndex = 0;
  return [...text.matchAll(re)][0] ?? null;
}

function ballSize(lines: Line[]): { grams: number; meters: number; line: string } | null {
  let mass: { grams: number; line: Line } | null = null;
  let length: { meters: number; line: Line } | null = null;

  for (const line of lines) {
    if (NOT_THE_BALL.test(line.text)) continue;
    const m = firstMatch(MASS, line.value);
    const l = firstMatch(LENGTH, line.value);

    // Both on one line — "100g / 200m", "50克 约125米" — is the strongest
    // evidence there is, and wins outright.
    if (m && l) {
      return {
        grams: grams(toNumber(m[1]), m[2]),
        meters: metres(toNumber(l[1]), l[2]),
        line: evidenceOf(line),
      };
    }
    const labelled = line.label ?? '';
    if (m && !mass && MASS_LABEL.test(labelled)) mass = { grams: grams(toNumber(m[1]), m[2]), line };
    if (l && !length && LENGTH_LABEL.test(labelled)) length = { meters: metres(toNumber(l[1]), l[2]), line };
  }

  if (!mass || !length) return null;
  return {
    grams: mass.grams,
    meters: length.meters,
    line: `${evidenceOf(mass.line)} · ${evidenceOf(length.line)}`,
  };
}

/* ── Hook ─────────────────────────────────────────────────────────── */

const HOOK_LINE = /hook|钩针/i;
const HOOK_RANGE = new RegExp(`${NUM}\\s*(?:mm)?\\s*(?:-|–|—|~|to|至)\\s*${NUM}\\s*mm`, 'i');
const HOOK_SINGLE = new RegExp(`${NUM}\\s*mm`, 'i');

function hookSize(lines: Line[]): { mm: number; line: string } | null {
  for (const line of lines) {
    if (!HOOK_LINE.test(line.text)) continue;
    const range = line.value.match(HOOK_RANGE) ?? line.text.match(HOOK_RANGE);
    // A range is a recommendation either side of a size; its middle is the one
    // to start a swatch on.
    const mm = range
      ? (toNumber(range[1]) + toNumber(range[2])) / 2
      : (() => {
          const single = line.value.match(HOOK_SINGLE) ?? line.text.match(HOOK_SINGLE);
          return single ? toNumber(single[1]) : null;
        })();
    if (mm && mm >= 0.5 && mm <= 30) return { mm: Math.round(mm * 100) / 100, line: evidenceOf(line) };
  }
  return null;
}

/** The generator's own spelling of a size, when one of its sizes is close. */
function hookFor(mm: number, weight: YarnWeight | null): string {
  const options = weight ? HOOK_SIZES[weight] : Object.values(HOOK_SIZES).flat();
  const nearest = options
    .map((label) => ({ label, mm: parseFloat(label) }))
    .sort((a, b) => Math.abs(a.mm - mm) - Math.abs(b.mm - mm))[0];
  return nearest && Math.abs(nearest.mm - mm) <= 0.13 ? nearest.label : hookLabel(mm);
}

/* ── Gauge ────────────────────────────────────────────────────────── */

const GAUGE_LINE = /gauge|tension|密度/i;
const CROCHET_WORDS = /cro[t]?chet|\bsc\b|\bhdc\b|\bdc\b|钩针|短针|长针/i;
const KNIT_WORDS = /knit|stockinette|stocking|棒针/i;

const STITCHES = new RegExp(
  `${NUM}\\s*(?:stitches|sts?|(?:half\\s*)?(?:single|double|treble)\\s*cro[t]?chets?|hdc|sc|dc|tr|针)(?![a-z])`,
  'i',
);
const ROWS = new RegExp(`${NUM}\\s*(?:rows?|rnds?|rounds?|行)(?![a-z])`, 'i');
const SQUARE = new RegExp(`(?:=|to|over|per|in)\\s*${NUM}\\s*("|''|inch(?:es)?|in\\b|cm|厘米)`, 'i');
const SQUARE_BARE = new RegExp(`${NUM}\\s*("|''|inch(?:es)?|in\\b|cm|厘米)\\s*(?:x|×)`, 'i');

function stitchOf(text: string): string | null {
  if (/half\s*double|\bhdc\b/i.test(text)) return 'hdc';
  if (/treble|\btr\b/i.test(text)) return 'tr';
  if (/double\s*cro[t]?chet|\bdc\b|长针/i.test(text)) return 'dc';
  if (/single\s*cro[t]?chet|\bsc\b|短针/i.test(text)) return 'sc';
  return null;
}

function readGauge(line: Line): Gauge | null {
  const sts = line.text.match(STITCHES);
  const rows = line.text.match(ROWS);
  if (!sts || !rows) return null;

  // A gauge that does not say how big its square is is almost always the
  // standard 10cm / 4" one.
  const square = line.text.match(SQUARE) ?? line.text.match(SQUARE_BARE);
  const sizeCm = square
    ? toNumber(square[1]) * (/cm|厘米/i.test(square[2]) ? 1 : INCH_CM)
    : 10;
  if (!sizeCm) return null;

  const per5 = (count: number) => round1((count * 5) / sizeCm);
  return {
    stitchesPer5cm: per5(toNumber(sts[1])),
    rowsPer5cm: per5(toNumber(rows[1])),
    stitch: stitchOf(line.text),
  };
}

function gauges(lines: Line[]) {
  let crochet: { gauge: Gauge; line: string } | null = null;
  let reference: { gauge: Gauge & { kind: 'knit' | 'unspecified' }; line: string } | null = null;

  for (const line of lines) {
    if (!GAUGE_LINE.test(line.text)) continue;
    const gauge = readGauge(line);
    if (!gauge) continue;
    const isKnit = KNIT_WORDS.test(line.text);
    if (!isKnit && CROCHET_WORDS.test(line.text)) {
      crochet ??= { gauge, line: evidenceOf(line) };
    } else {
      reference ??= { gauge: { ...gauge, kind: isKnit ? 'knit' : 'unspecified' }, line: evidenceOf(line) };
    }
  }
  return { crochet, reference };
}

/* ── Labelled text fields ─────────────────────────────────────────── */

/*
 * A shop's option pickers carry their own "Color: …" lines — Hobby Lobby's
 * reads "Color: Product Color Option 353 Menthe" — and they come before the
 * spec list on the page. That is the widget talking, not the yarn.
 */
const CONTROL_TEXT = /\b(?:option|select|choose|pick)\b/i;

function labelled(lines: Line[], label: RegExp, max: number): { value: string; line: string } | null {
  for (const line of lines) {
    if (line.label && label.test(line.label) && line.value && !CONTROL_TEXT.test(line.value)) {
      return { value: line.value.slice(0, max), line: evidenceOf(line) };
    }
  }
  return null;
}

const COLOUR_NAME = /^(?:colou?r(?:\s*name)?|shade|颜色|颜色分类)$/i;
const COLOUR_CODE = /^(?:colou?r\s*(?:code|number|no\.?)|shade\s*(?:code|number)|色号)$/i;
const FIBRE = /^(?:fib(?:re|er)(?:\s*content)?|content|composition|materials?|成分(?:含量)?|材质)$/i;
const BRAND = /^(?:brand|品牌)$/i;
const NAME = /^(?:product\s*name|yarn\s*name|name|品名|商品名称)$/i;

function colourFrom(lines: Line[]): { value: string; line: string } | null {
  const name = labelled(lines, COLOUR_NAME, 60);
  const code = labelled(lines, COLOUR_CODE, 60);
  if (code && name && code.value.toLowerCase() !== name.value.toLowerCase()) {
    return { value: `${code.value} (${name.value})`, line: `${code.line} · ${name.line}` };
  }
  return code ?? name;
}

/* ── The whole parse ──────────────────────────────────────────────── */

export interface ParseContext {
  sourceUrl?: string | null;
  siteName?: string | null;
  name?: string | null;
  brand?: string | null;
}

/** Everything the page said, in the generator's units. Pure: text in, specs out. */
export function parseYarnSpecs(text: string, context: ParseContext = {}): YarnSpecs {
  const lines = toLines(text);
  const evidence: YarnSpecs['evidence'] = {};

  const name = context.name ?? labelled(lines, NAME, 140)?.value ?? null;
  const brand = context.brand ?? labelled(lines, BRAND, 80)?.value ?? null;

  const ball = ballSize(lines);
  let ballGrams: number | null = null;
  let ballMeters: number | null = null;
  let metersPerGram: number | null = null;
  if (ball) {
    const ratio = ball.meters / ball.grams;
    // Outside these a unit was misread, not a yarn found.
    if (ball.grams >= 5 && ball.grams <= 1000 && ball.meters >= 5 && ball.meters <= 5000 && ratio >= 0.05 && ratio <= 20) {
      ballGrams = Math.round(ball.grams);
      ballMeters = Math.round(ball.meters);
      metersPerGram = Math.round(ratio * 100) / 100;
      evidence.ball = ball.line;
    }
  }

  const stated = statedWeight(lines, name);
  let weight: YarnWeight | null = null;
  if (stated) {
    weight = stated.weight;
    evidence.weight = stated.line;
  } else if (metersPerGram) {
    weight = inferredWeight(metersPerGram);
    evidence.weight = `Worked out from ${metersPerGram} m/g`;
  }

  const hook = hookSize(lines);
  if (hook) evidence.hook = hook.line;

  const { crochet, reference } = gauges(lines);
  if (crochet) evidence.crochetGauge = crochet.line;
  if (reference) evidence.referenceGauge = reference.line;

  const colour = colourFrom(lines);
  if (colour) evidence.colour = colour.line;
  const fibre = labelled(lines, FIBRE, 80);
  if (fibre) evidence.fibre = fibre.line;

  return {
    sourceUrl: context.sourceUrl ?? null,
    siteName: context.siteName ?? null,
    name,
    brand,
    colour: colour?.value ?? null,
    fibre: fibre?.value ?? null,
    weight,
    weightStated: Boolean(stated),
    hookMm: hook?.mm ?? null,
    hook: hook ? hookFor(hook.mm, weight) : null,
    ballGrams,
    ballMeters,
    metersPerGram,
    crochetGauge: crochet?.gauge ?? null,
    referenceGauge: reference?.gauge ?? null,
    evidence,
  };
}

/* ── Turning a page into lines ────────────────────────────────────── */

/**
 * A page as text, with the markup that separates a label from its value —
 * table cells, definition lists — turned into "Label: value" first, so a spec
 * table reads the same as a spec list.
 */
export function pageText(html: string): string {
  return stripTags(
    html
      .replace(/<\/t[hd]>\s*<t[hd][^>]*>/gi, ': ')
      .replace(/<\/dt>\s*<dd[^>]*>/gi, ': ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(dd|dt|ul|ol|table|section)\s*>/gi, '\n'),
  );
}

/** "Some Yarn 100g – Shop name" → "Some Yarn 100g", the way product.ts reads titles. */
export function nameFromTitle(title: string | null | undefined): string | null {
  const trimmed = (title ?? '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+[|–—·_-]\s+|-(?=淘宝网|天猫)/).filter(Boolean);
  const longest = parts.length > 1 ? [...parts].sort((a, b) => b.length - a.length)[0] : trimmed;
  return longest.slice(0, 140);
}

/* ── Outcomes ─────────────────────────────────────────────────────── */

const FIELD_NAMES: [keyof YarnSpecs, string][] = [
  ['weight', 'the yarn weight'],
  ['hookMm', 'a hook size'],
  ['metersPerGram', 'the ball length and weight'],
  ['crochetGauge', 'a crochet gauge'],
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'that page';
  }
};

const isMarketplaceBehindLogin = (url: string) => /(^|\.)(taobao|tmall|1688)\.com$/i.test(hostOf(url));

const PASTE_OR_EXTENSION =
  'Copy the spec text off the page into the paste box, or open it in Chrome and use the ZippyZack extension.';

function blankSpecs(sourceUrl: string | null): YarnSpecs {
  return parseYarnSpecs('', { sourceUrl, siteName: sourceUrl ? hostOf(sourceUrl) : null });
}

/** What to say about a parse, given what it did and did not find. */
export function outcomeFor(specs: YarnSpecs): YarnOutcome {
  const missing = FIELD_NAMES.filter(([key]) => specs[key] === null).map(([, label]) => label);
  const foundCount = FIELD_NAMES.length - missing.length;

  if (foundCount === 0) {
    return {
      specs,
      found: Boolean(specs.colour || specs.fibre),
      note: `No yarn specs were listed there. ${PASTE_OR_EXTENSION}`,
    };
  }

  const notes: string[] = [];
  if (missing.length) {
    notes.push(`Nothing gave ${missing.join(', ').replace(/, ([^,]*)$/, ' or $1')} — fill ${missing.length === 1 ? 'it' : 'those'} in yourself.`);
  }
  if (!specs.crochetGauge && specs.referenceGauge) {
    notes.push(
      specs.referenceGauge.kind === 'knit'
        ? 'The gauge listed is for knitting, so it was not put in the crochet boxes.'
        : 'The gauge listed does not say whether it is knitted or crocheted, so it was not put in the boxes.',
    );
  }
  return { specs, found: true, note: notes.join(' ') || null };
}

/** Specs from text somebody pasted, or that the extension read off a rendered page. */
export function yarnFromText(
  text: string,
  context: { url?: string | null; title?: string | null } = {},
): YarnOutcome {
  const sourceUrl = context.url ? tidySourceUrl(context.url) : null;
  const specs = parseYarnSpecs(text, {
    sourceUrl,
    siteName: sourceUrl ? hostOf(sourceUrl) : null,
    name: nameFromTitle(context.title),
  });
  return outcomeFor(specs);
}

/**
 * Read one yarn page. Never throws: a page that cannot be read comes back as
 * empty specs and a note saying what to do instead.
 */
export async function scrapeYarn(rawUrl: string): Promise<YarnOutcome> {
  const url = tidySourceUrl(rawUrl);
  const fail = (note: string): YarnOutcome => ({ specs: blankSpecs(url), found: false, note });

  if (!isFetchableUrl(url)) return fail('That is not a public web address.');

  let page;
  try {
    page = await fetchPage(url);
  } catch {
    return fail(`That page did not answer in time. ${PASTE_OR_EXTENSION}`);
  }

  // Taobao answers a server with a 200 and a page that only redirects to its
  // login, so the status alone does not tell us we were turned away.
  const loginWall = /login\.taobao\.com|login\.tmall\.com|login\.1688\.com|member\/login/i.test(page.html);
  if (isMarketplaceBehindLogin(page.finalUrl) || loginWall) {
    return fail(
      `${hostOf(page.finalUrl)} only shows listings to a signed-in browser, so it cannot be read from here. ${PASTE_OR_EXTENSION}`,
    );
  }

  if (!page.html) {
    return fail(
      page.status === 403 || page.status === 401 || page.status === 429
        ? `${hostOf(page.finalUrl)} refused the request (${page.status}). ${PASTE_OR_EXTENSION}`
        : `${hostOf(page.finalUrl)} answered ${page.status || 'with a redirect'} for that link. Check the URL.`,
    );
  }

  // The product scraper already knows how to find a name and brand; the specs
  // come from the page text and whatever description it found.
  const product = await scrapeProduct(url, page);
  const text = [product.draft.description ?? '', pageText(page.html)].join('\n');

  return outcomeFor(
    parseYarnSpecs(text, {
      sourceUrl: product.draft.sourceUrl,
      siteName: product.draft.siteName,
      name: product.draft.name,
      brand: product.draft.brand,
    }),
  );
}
