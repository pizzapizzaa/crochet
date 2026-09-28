import { useState, useCallback, useEffect } from 'react';
import { HOOK_SIZES, YARN_WEIGHTS } from '../lib/yarnWeights';
import type { YarnWeight } from '../lib/yarnWeights';
import type { YarnOutcome, YarnSpecs } from '../lib/scrape/yarn';
import { schematicSvg } from '../lib/schematic';

// --- Types ---
interface GaugeInputs {
  stitchesPer5cm: number;
  rowsPer5cm: number;
}

interface ProjectInputs {
  widthCm: number;
  heightCm: number;
  yarnWeight: string;
  hookSize: string;
  projectType: string;
  stitchPattern: string;
  yarnColor: string;
  notes: string;
}

interface PatternResult {
  castOnStitches: number;
  totalRows: number;
  totalStitches: number;
  estimatedYarnGrams: number;
  /** Balls needed at each size — the looked-up yarn's own first, when there is one. */
  rolls: { size: number; count: number; own: boolean }[];
  pattern: string[];
  /** The panel drawn to scale, as SVG markup, from the same numbers as the pattern. */
  schematic: string;
}

/** The fields a yarn lookup can fill, so each can say where its value came from. */
type FillableField = 'yarnWeight' | 'hookSize' | 'yarnColor' | 'gauge';

const ROLL_SIZES = [50, 100, 125, 150];

const hooksFor = (weight: string): string[] => HOOK_SIZES[weight as YarnWeight] ?? HOOK_SIZES.worsted;
const middleHook = (weight: string): string => {
  const hooks = hooksFor(weight);
  return hooks[Math.floor(hooks.length / 2)] ?? '';
};

const PROJECT_TYPES = [
  'Blanket',
  'Amigurumi',
  'Hat',
  'Beanie',
  'Scarf',
  'Bag',
  'Cross Bag',
  'Hand Bag',
  'Crop Top',
  'Cardigan Top',
  'Other',
];

const STITCH_PATTERNS = [
  { label: 'Single Crochet (sc)', value: 'sc', heightFactor: 1.0, yarnFactor: 1.0 },
  { label: 'Half Double Crochet (hdc)', value: 'hdc', heightFactor: 1.3, yarnFactor: 1.4 },
  { label: 'Double Crochet (dc)', value: 'dc', heightFactor: 1.6, yarnFactor: 1.8 },
  { label: 'Treble Crochet (tr)', value: 'tr', heightFactor: 2.0, yarnFactor: 2.4 },
  { label: 'Moss / Granite Stitch', value: 'moss', heightFactor: 1.0, yarnFactor: 1.1 },
  { label: 'Granny Square', value: 'granny', heightFactor: 1.0, yarnFactor: 1.6 },
  { label: 'Shell Stitch', value: 'shell', heightFactor: 1.6, yarnFactor: 2.0 },
  { label: 'V-Stitch', value: 'vstitch', heightFactor: 1.6, yarnFactor: 1.8 },
  { label: 'Tunisian Simple Stitch (Tss)', value: 'tunisian', heightFactor: 0.8, yarnFactor: 1.2 },
];

// Granny square patterns -- place images in /public/granny-patterns/
const GRANNY_PATTERNS = [
  { id: 'granny-01', name: 'Granny Pattern 1', file: 'granny-01.png' },
  { id: 'granny-02', name: 'Granny Pattern 2', file: 'granny-02.png' },
  { id: 'granny-03', name: 'Granny Pattern 3', file: 'granny-03.png' },
  { id: 'granny-04', name: 'Granny Pattern 4', file: 'granny-04.png' },
  { id: 'granny-05', name: 'Granny Pattern 5', file: 'granny-05.png' },
  { id: 'granny-06', name: 'Granny Pattern 6', file: 'granny-06.png' },
];

// --- Helpers ---
function generatePattern(
  gauge: GaugeInputs,
  project: ProjectInputs,
  grannyPatternName?: string,
  yarn?: YarnSpecs | null,
): PatternResult {
  const stitchData = STITCH_PATTERNS.find((s) => s.value === project.stitchPattern) ?? STITCH_PATTERNS[0];
  const yarnData = YARN_WEIGHTS.find((y) => y.value === project.yarnWeight) ?? YARN_WEIGHTS[4];
  // The real yarn's length for its weight beats the category's typical one —
  // for a braided or roving yarn it can be four times out.
  const metersPerGram = yarn?.metersPerGram ?? yarnData.metersPerGram;

  const adjustedRowsPerCm = (gauge.rowsPer5cm / 5) / stitchData.heightFactor;
  const castOn = Math.round((gauge.stitchesPer5cm / 5) * project.widthCm);
  const totalRows = Math.round(adjustedRowsPerCm * project.heightCm);
  const totalStitches = castOn * totalRows;

  // Yarn estimate: base 3cm per stitch for sc with worsted, scaled by yarn weight multiplier and stitch yarn factor.
  const yarnPerStitchCm = 3.0 * yarnData.multiplier * stitchData.yarnFactor;
  const estimatedYarnMeters = (totalStitches * yarnPerStitchCm) / 100;
  const estimatedYarnGrams = Math.ceil(estimatedYarnMeters / metersPerGram);
  const ownBall = yarn?.ballGrams ?? null;
  const rolls = [
    ...(ownBall ? [{ size: ownBall, own: true }] : []),
    ...ROLL_SIZES.filter((s) => s !== ownBall).map((size) => ({ size, own: false })),
  ].map((r) => ({ ...r, count: Math.ceil(estimatedYarnGrams / r.size) }));

  // Brand only when the name does not already say it — shops disagree with
  // themselves about capitals ("I Love This Yarn" by "I Love this Yarn").
  const brandInName = Boolean(yarn?.brand && yarn.name?.toLowerCase().includes(yarn.brand.toLowerCase()));
  const yarnTitle = yarn ? [yarn.name, yarn.brand && !brandInName ? `by ${yarn.brand}` : null].filter(Boolean).join(' ') : '';
  const ballLabel = yarn?.ballGrams && yarn.ballMeters ? `${yarn.ballGrams}g / ${yarn.ballMeters}m per ball` : null;

  const stAbbr = stitchData.value === 'tunisian' ? 'Tss' : stitchData.value.toUpperCase();
  const ch = project.stitchPattern === 'dc' ? 3 : project.stitchPattern === 'hdc' ? 2 : 1;

  const grannyNote = grannyPatternName ? `\nSelected Granny Pattern: ${grannyPatternName}` : '';

  const lines: string[] = [
    `===========================================`,
    `  ZIPPYZACK.COM PATTERN GENERATOR`,
    `===========================================`,
    ``,
    `Project: ${project.projectType}`,
    `Stitch: ${stitchData.label}${grannyNote}`,
    ...(yarnTitle ? [`Yarn: ${yarnTitle}`] : []),
    ...(yarn?.fibre ? [`Fibre: ${yarn.fibre}`] : []),
    `Yarn Weight: ${yarnData.label}`,
    `Hook Size: ${project.hookSize}`,
    ...(project.yarnColor ? [`Yarn Colour: ${project.yarnColor}`] : []),
    `Dimensions: ${project.widthCm}cm wide x ${project.heightCm}cm tall`,
    ``,
    `-------------------------------------------`,
    `GAUGE (per 5cm)`,
    `-------------------------------------------`,
    `  Stitches: ${gauge.stitchesPer5cm}`,
    `  Rows: ${gauge.rowsPer5cm}`,
    ``,
    `-------------------------------------------`,
    `YOUR PATTERN`,
    `-------------------------------------------`,
    ``,
    `MATERIALS`,
    yarnTitle
      ? `  . ${yarnTitle} (${yarnData.label} weight${ballLabel ? `, ${ballLabel}` : ''})`
      : `  . ${yarnData.label} weight yarn`,
    `  . ${project.hookSize} crochet hook`,
    `  . Stitch markers, yarn needle`,
    `  . ~${estimatedYarnGrams}g of yarn (estimate)`,
    `     Rolls needed: ${rolls.map((r) => `${r.count}x ${r.size}g${r.own ? ' (this yarn)' : ''}`).join('  |  ')}`,
    ``,
    `ABBREVIATIONS`,
    `  ch = chain`,
    `  ${stAbbr} = ${stitchData.label}`,
    `  st(s) = stitch(es)`,
    `  rep = repeat`,
    ``,
    `PATTERN INSTRUCTIONS`,
    ``,
    `Foundation Chain:`,
    `  Ch ${castOn + ch}.`,
    ``,
    `Row 1:`,
    `  ${stAbbr} in ${ch + 1}th ch from hook, ${stAbbr} in each`,
    `  ch across. -- ${castOn} ${stAbbr} made.`,
    ``,
    `Rows 2-${totalRows}:`,
    `  Ch ${ch}, turn. ${stAbbr} in each ${stAbbr} across.`,
    `  -- ${castOn} sts per row.`,
    ``,
    `Fasten off and weave in all ends.`,
    ``,
    `-------------------------------------------`,
    `SUMMARY`,
    `-------------------------------------------`,
    `  Cast-on stitches: ${castOn}`,
    `  Total rows: ${totalRows}`,
    `  Total stitches worked: ${totalStitches.toLocaleString()}`,
    `  Yarn estimate: ~${estimatedYarnGrams}g`,
    ``,
    ...(project.notes
      ? [`-------------------------------------------`, `NOTES`, `  ${project.notes}`, ``]
      : []),
    ...(yarn?.sourceUrl ? [`Yarn specs from: ${yarn.sourceUrl}`, ``] : []),
    `===========================================`,
    `  Made with ZippyZack.com Pattern Generator`,
    `  zippyzack.com/pattern-generator`,
    `===========================================`,
  ];

  const schematic = schematicSvg({
    widthCm: project.widthCm,
    heightCm: project.heightCm,
    castOn,
    totalRows,
    turningChain: ch,
    stitchesPer5cm: gauge.stitchesPer5cm,
    rowsPer5cm: gauge.rowsPer5cm,
    stitchLabel: stitchData.label + (grannyPatternName ? ` · ${grannyPatternName}` : ''),
    stitchAbbr: stAbbr,
    hookSize: project.hookSize,
    yarnLabel: yarnTitle ? `${yarnTitle} (${yarnData.label})` : yarnData.label,
    projectType: project.projectType,
  });

  return { castOnStitches: castOn, totalRows, totalStitches, estimatedYarnGrams, rolls, pattern: lines, schematic };
}

function buildImagePrompt(project: ProjectInputs, grannyPatternName?: string): string {
  const colorPart = project.yarnColor ? `in ${project.yarnColor}` : '';
  const grannyPart = grannyPatternName ? `, ${grannyPatternName} granny square style` : '';
  return (
    `A beautifully crafted handmade crochet ${project.projectType.toLowerCase()} ${colorPart}${grannyPart}, ` +
    `using ${project.stitchPattern === 'granny' ? 'granny square stitch' : project.stitchPattern + ' crochet stitch'}, ` +
    `${project.yarnWeight} yarn weight, ${project.widthCm}cm x ${project.heightCm}cm. ` +
    `Soft natural lighting, flat-lay or styled product photo, artisan handmade aesthetic.`
  );
}

// --- Granny Pattern Modal ---
function GrannyModal({
  selectedId,
  onSelect,
  onClose,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brown-dark/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-cream-300">
          <div>
            <h2 className="font-display text-xl font-semibold text-brown-dark">Granny Square Patterns</h2>
            <p className="text-xs text-brown-light mt-0.5">Choose a pattern to include in your project</p>
          </div>
          <button
            onClick={onClose}
            className="text-brown-light hover:text-brown-dark transition-colors text-xl leading-none"
          >
            x
          </button>
        </div>

        <div className="p-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
          {GRANNY_PATTERNS.map((p) => (
            <button
              key={p.id}
              onClick={() => { onSelect(p.id); onClose(); }}
              className={`group rounded-xl overflow-hidden border-2 transition-all text-left ${
                selectedId === p.id
                  ? 'border-rose-dust shadow-md'
                  : 'border-cream-300 hover:border-rose-dust/50'
              }`}
            >
              <div className="aspect-square bg-cream-100 relative overflow-hidden">
                <img
                  src={`/granny-patterns/${p.file}`}
                  alt={p.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    img.style.display = 'none';
                    const placeholder = img.parentElement?.querySelector('.img-placeholder') as HTMLElement | null;
                    if (placeholder) placeholder.style.display = 'flex';
                  }}
                />
                <div
                  className="img-placeholder absolute inset-0 items-center justify-center bg-cream-200 text-4xl"
                  style={{ display: 'none' }}
                >
                  🧶
                </div>
                {selectedId === p.id && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-rose-dust flex items-center justify-center text-white text-xs">
                    v
                  </div>
                )}
              </div>
              <div className="px-3 py-2">
                <p className="text-xs font-medium text-brown-dark truncate">{p.name}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="px-6 pb-6">
          <p className="text-xs text-brown-light text-center">
            Upload images to <code className="bg-cream-100 px-1 rounded">/public/granny-patterns/</code> named: granny-01.png, granny-02.png, ..., granny-06.png
          </p>
        </div>
      </div>
    </div>
  );
}

/** Marks a field whose value came from the yarn lookup rather than from the user. */
function FromYarn({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-sage/15 px-2 py-0.5 text-[10px] font-semibold text-sage align-middle">
      from yarn
    </span>
  );
}

// --- Main Component ---
export default function PatternGenerator() {
  const [gauge, setGauge] = useState<GaugeInputs>({ stitchesPer5cm: 8, rowsPer5cm: 10 });
  const [project, setProject] = useState<ProjectInputs>({
    widthCm: 30,
    heightCm: 30,
    yarnWeight: 'worsted',
    hookSize: '5.0mm',
    projectType: 'Blanket',
    stitchPattern: 'sc',
    yarnColor: '',
    notes: '',
  });
  const [result, setResult] = useState<PatternResult | null>(null);
  const [copied, setCopied] = useState(false);

  const [grannyModalOpen, setGrannyModalOpen] = useState(false);
  const [selectedGrannyId, setSelectedGrannyId] = useState('granny-01');
  const selectedGrannyPattern = GRANNY_PATTERNS.find((p) => p.id === selectedGrannyId);

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'visualise' | 'pattern' | 'schematic'>('visualise');

  // A looked-up hook the weight's list does not have — a 3.25mm on a DK, say —
  // still has to be selectable, or the select would silently show another.
  const hookOptions = (() => {
    const hooks = hooksFor(project.yarnWeight);
    return project.hookSize && !hooks.includes(project.hookSize)
      ? [...hooks, project.hookSize].sort((a, b) => parseFloat(a) - parseFloat(b))
      : hooks;
  })();

  // --- Yarn lookup ---
  const [yarnMode, setYarnMode] = useState<'link' | 'paste'>('link');
  const [yarnUrl, setYarnUrl] = useState('');
  const [yarnText, setYarnText] = useState('');
  const [yarnLoading, setYarnLoading] = useState(false);
  const [yarnError, setYarnError] = useState<string | null>(null);
  const [yarnNote, setYarnNote] = useState<string | null>(null);
  const [yarn, setYarn] = useState<YarnSpecs | null>(null);
  const [autoFilled, setAutoFilled] = useState<Set<FillableField>>(new Set());

  /** A field the user has changed by hand no longer came from the link. */
  const touch = useCallback((field: FillableField) => {
    setAutoFilled((current) => {
      if (!current.has(field)) return current;
      const next = new Set(current);
      next.delete(field);
      return next;
    });
  }, []);

  const handleYarnChange = useCallback((val: string) => {
    setProject((p) => ({ ...p, yarnWeight: val, hookSize: middleHook(val) }));
    touch('yarnWeight');
    touch('hookSize');
  }, [touch]);

  /*
   * One setProject for everything, deliberately: going through
   * handleYarnChange would reset the hook to the weight's middle size right
   * after the looked-up one was put in.
   */
  const applyYarn = useCallback((outcome: YarnOutcome) => {
    const { specs } = outcome;
    setYarnNote(outcome.note);
    if (!outcome.found) {
      setYarn(null);
      return;
    }

    setProject((p) => {
      const weight = specs.weight ?? p.yarnWeight;
      const hookSize = specs.hook ?? (weight !== p.yarnWeight ? middleHook(weight) : p.hookSize);
      return { ...p, yarnWeight: weight, hookSize, yarnColor: specs.colour ?? p.yarnColor };
    });
    if (specs.crochetGauge) {
      setGauge({
        stitchesPer5cm: specs.crochetGauge.stitchesPer5cm,
        rowsPer5cm: specs.crochetGauge.rowsPer5cm,
      });
    }
    setAutoFilled(
      new Set<FillableField>([
        ...(specs.weight ? (['yarnWeight'] as const) : []),
        ...(specs.hook ? (['hookSize'] as const) : []),
        ...(specs.colour ? (['yarnColor'] as const) : []),
        ...(specs.crochetGauge ? (['gauge'] as const) : []),
      ]),
    );
    setYarn(specs);
  }, []);

  const lookUpYarn = useCallback(async () => {
    const payload = yarnMode === 'link' ? { url: yarnUrl.trim() } : { text: yarnText };
    if (yarnMode === 'link' ? !payload.url : !yarnText.trim()) return;
    setYarnLoading(true);
    setYarnError(null);
    setYarnNote(null);
    try {
      const res = await fetch('/api/pos/yarn-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) setYarnError(data.error ?? 'Could not read that yarn.');
      else applyYarn(data as YarnOutcome);
    } catch {
      setYarnError('Network error. Please try again.');
    } finally {
      setYarnLoading(false);
    }
  }, [yarnMode, yarnUrl, yarnText, applyYarn]);

  const clearYarn = useCallback(() => {
    setYarn(null);
    setYarnNote(null);
    setYarnError(null);
    setAutoFilled(new Set());
  }, []);

  /*
   * The extension's hand-off: it reads a page this server cannot (Taobao,
   * behind its login), has the specs parsed, and opens this page with them in
   * the fragment. The fragment never reaches a server, and is cleared once
   * read so a reload does not apply it twice.
   */
  useEffect(() => {
    const match = window.location.hash.match(/^#yarn=(.+)$/);
    if (!match) return;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
      const outcome = JSON.parse(decodeURIComponent(match[1])) as YarnOutcome;
      if (!outcome?.specs || typeof outcome.specs !== 'object') return;
      if (outcome.specs.sourceUrl) setYarnUrl(outcome.specs.sourceUrl);
      applyYarn(outcome);
    } catch {
      setYarnError('The extension sent specs this page could not read. Try sending them again.');
    }
  }, [applyYarn]);

  const handleStitchChange = useCallback((val: string) => {
    setProject((p) => ({ ...p, stitchPattern: val }));
    if (val === 'granny') setGrannyModalOpen(true);
  }, []);

  const generate = useCallback(() => {
    const grannyName = project.stitchPattern === 'granny' ? selectedGrannyPattern?.name : undefined;
    setResult(generatePattern(gauge, project, grannyName, yarn));
    setGeneratedImage(null);
    setImageError(null);
    setActiveTab('pattern');
  }, [gauge, project, selectedGrannyPattern, yarn]);

  const visualise = useCallback(async () => {
    const grannyName = project.stitchPattern === 'granny' ? selectedGrannyPattern?.name : undefined;
    const prompt = buildImagePrompt(project, grannyName);
    setImageLoading(true);
    setImageError(null);
    setGeneratedImage(null);
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setImageError(data.error ?? 'Failed to generate image.');
      } else {
        setGeneratedImage(data.image);
      }
    } catch {
      setImageError('Network error. Please try again.');
    } finally {
      setImageLoading(false);
    }
  }, [project, selectedGrannyPattern]);

  const copyToClipboard = useCallback(() => {
    if (!result) return;
    navigator.clipboard.writeText(result.pattern.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [result]);

  const downloadPattern = useCallback(() => {
    if (!result) return;
    const text = result.pattern.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zippyzack-pattern-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const downloadSchematic = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.schematic], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zippyzack-schematic-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <>
      {grannyModalOpen && (
        <GrannyModal
          selectedId={selectedGrannyId}
          onSelect={setSelectedGrannyId}
          onClose={() => setGrannyModalOpen(false)}
        />
      )}

      <div className="grid lg:grid-cols-2 gap-10 items-start">
        {/* Input Panel */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-1">
              <h2 className="font-display text-xl font-semibold text-brown-dark">Your Yarn</h2>
              <div className="flex shrink-0 rounded-full bg-cream-100 p-0.5 text-xs font-medium">
                {(['link', 'paste'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setYarnMode(mode)}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      yarnMode === mode ? 'bg-white text-brown-dark shadow-sm' : 'text-brown-light hover:text-brown-warm'
                    }`}
                  >
                    {mode === 'link' ? 'Link' : 'Paste specs'}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-brown-light text-xs mb-5">
              {yarnMode === 'link'
                ? 'Paste the shop link for your yarn and its specs fill in below.'
                : 'For shops that only show a listing when you are signed in, like Taobao: copy the spec table off the page and paste it here.'}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookUpYarn();
              }}
              className={yarnMode === 'link' ? 'flex gap-2' : 'space-y-2'}
            >
              {yarnMode === 'link' ? (
                <input
                  type="url"
                  inputMode="url"
                  value={yarnUrl}
                  onChange={(e) => setYarnUrl(e.target.value)}
                  placeholder="https://www.hobbylobby.com/…"
                  className="min-w-0 flex-1 px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                />
              ) : (
                <textarea
                  value={yarnText}
                  onChange={(e) => setYarnText(e.target.value)}
                  rows={5}
                  placeholder={'Yarn Weight: 4 - Medium\nRecommended Crochet Hook: 5.5mm\nSkein Weight: 7 Ounces\nSkein Yardage: 355 Yards'}
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40 resize-y"
                />
              )}
              <button
                type="submit"
                disabled={yarnLoading || (yarnMode === 'link' ? !yarnUrl.trim() : !yarnText.trim())}
                className={`shrink-0 bg-sage/10 hover:bg-sage/20 text-brown-dark font-medium px-5 py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  yarnMode === 'paste' ? 'w-full' : ''
                }`}
              >
                {yarnLoading ? 'Reading…' : yarnMode === 'link' ? 'Fetch specs' : 'Read specs'}
              </button>
            </form>

            {yarnError && <p className="mt-3 text-xs text-rose-dust">{yarnError}</p>}

            {yarn && (
              <div className="mt-4 rounded-xl border border-cream-200 bg-cream-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-brown-dark truncate">{yarn.name ?? 'Your yarn'}</p>
                    <p className="text-xs text-brown-light truncate">
                      {[yarn.brand, yarn.siteName].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearYarn}
                    className="shrink-0 text-xs text-brown-light hover:text-rose-dust transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {[
                    yarn.weight && {
                      key: 'weight',
                      text:
                        (YARN_WEIGHTS.find((w) => w.value === yarn.weight)?.label ?? yarn.weight) +
                        (yarn.weightStated ? '' : ' (worked out)'),
                      title: yarn.evidence.weight,
                    },
                    yarn.ballGrams && yarn.ballMeters && {
                      key: 'ball',
                      text: `${yarn.ballGrams}g / ${yarn.ballMeters}m · ${yarn.metersPerGram} m/g`,
                      title: yarn.evidence.ball,
                    },
                    yarn.hook && { key: 'hook', text: `${yarn.hook} hook`, title: yarn.evidence.hook },
                    yarn.crochetGauge && {
                      key: 'gauge',
                      text: `${yarn.crochetGauge.stitchesPer5cm} sts × ${yarn.crochetGauge.rowsPer5cm} rows / 5cm`,
                      title: yarn.evidence.crochetGauge,
                    },
                    yarn.fibre && { key: 'fibre', text: yarn.fibre, title: yarn.evidence.fibre },
                  ]
                    .filter((chip): chip is { key: string; text: string; title: string | undefined } => Boolean(chip))
                    .map((chip) => (
                      <li
                        key={chip.key}
                        title={chip.title}
                        className="rounded-full bg-white border border-cream-200 px-3 py-1 text-xs text-brown-warm"
                      >
                        {chip.text}
                      </li>
                    ))}
                </ul>
                {!yarn.crochetGauge && yarn.referenceGauge && (
                  <p className="mt-3 text-xs text-brown-light leading-relaxed">
                    The label gives a {yarn.referenceGauge.kind === 'knit' ? 'knitting gauge' : 'gauge'} of{' '}
                    {yarn.referenceGauge.stitchesPer5cm} sts × {yarn.referenceGauge.rowsPer5cm} rows per 5cm. Crochet
                    a swatch for yours.
                  </p>
                )}
              </div>
            )}

            {yarnNote && (
              <p className="mt-3 text-xs text-brown-light leading-relaxed bg-cream-50 rounded-xl px-3 py-2">{yarnNote}</p>
            )}
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-display text-xl font-semibold text-brown-dark mb-1">
              Your Gauge <FromYarn show={autoFilled.has('gauge')} />
            </h2>
            <p className="text-brown-light text-xs mb-5">
              {autoFilled.has('gauge')
                ? "Filled from the yarn label's crochet gauge. Your own swatch is more accurate."
                : 'Crochet a 5cm x 5cm swatch and count your stitches and rows.'}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">
                  Stitches per 5cm
                </label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={gauge.stitchesPer5cm}
                  step="any"
                  onChange={(e) => {
                    setGauge((g) => ({ ...g, stitchesPer5cm: Number(e.target.value) }));
                    touch('gauge');
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">
                  Rows per 5cm
                </label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={gauge.rowsPer5cm}
                  step="any"
                  onChange={(e) => {
                    setGauge((g) => ({ ...g, rowsPer5cm: Number(e.target.value) }));
                    touch('gauge');
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-display text-xl font-semibold text-brown-dark mb-5">Project Details</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-brown-warm mb-1.5">Width (cm)</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={project.widthCm}
                    onChange={(e) => setProject((p) => ({ ...p, widthCm: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-brown-warm mb-1.5">Height (cm)</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={project.heightCm}
                    onChange={(e) => setProject((p) => ({ ...p, heightCm: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">Project Type</label>
                <select
                  value={project.projectType}
                  onChange={(e) => setProject((p) => ({ ...p, projectType: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                >
                  {PROJECT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">Stitch Pattern</label>
                <select
                  value={project.stitchPattern}
                  onChange={(e) => handleStitchChange(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                >
                  {STITCH_PATTERNS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                {project.stitchPattern === 'granny' && (
                  <button
                    type="button"
                    onClick={() => setGrannyModalOpen(true)}
                    className="mt-2 flex items-center gap-2 text-xs text-rose-dust hover:text-rose-dark transition-colors"
                  >
                    <span className="text-sm">🧶</span>
                    <span>
                      Pattern: <strong>{selectedGrannyPattern?.name}</strong>
                    </span>
                    <span className="underline underline-offset-2">Change</span>
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">
                  Yarn Weight <FromYarn show={autoFilled.has('yarnWeight')} />
                </label>
                <select
                  value={project.yarnWeight}
                  onChange={(e) => handleYarnChange(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                >
                  {YARN_WEIGHTS.map((y) => (
                    <option key={y.value} value={y.value}>{y.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">
                  Hook Size <FromYarn show={autoFilled.has('hookSize')} />
                </label>
                <select
                  value={project.hookSize}
                  onChange={(e) => {
                    setProject((p) => ({ ...p, hookSize: e.target.value }));
                    touch('hookSize');
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                >
                  {hookOptions.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">
                  Yarn Colour <span className="text-brown-light font-normal">(for AI visualisation)</span>
                  <FromYarn show={autoFilled.has('yarnColor')} />
                </label>
                <input
                  type="text"
                  value={project.yarnColor}
                  onChange={(e) => {
                    setProject((p) => ({ ...p, yarnColor: e.target.value }));
                    touch('yarnColor');
                  }}
                  placeholder="e.g. sage green, dusty rose, cream..."
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">
                  Notes (optional)
                </label>
                <textarea
                  value={project.notes}
                  onChange={(e) => setProject((p) => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  placeholder="E.g. colour changes, custom stitch notes..."
                  className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40 resize-none"
                />
              </div>
            </div>
          </div>

          <button
            onClick={generate}
            className="w-full bg-btn-gradient text-ink hover:brightness-105 font-semibold py-4 rounded-full transition-all text-sm flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate Pattern
          </button>
        </div>

        {/* Output Panel */}
        <div className="sticky top-24">
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-cream-200">
              <button
                onClick={() => setActiveTab('visualise')}
                className={`flex-1 py-3.5 text-xs font-semibold tracking-wide transition-colors ${
                  activeTab === 'visualise'
                    ? 'text-brown-dark border-b-2 border-rose-dust bg-white'
                    : 'text-brown-light hover:text-brown-warm bg-cream-50'
                }`}
              >
                ✨ AI Visualisation
              </button>
              <button
                onClick={() => setActiveTab('pattern')}
                className={`flex-1 py-3.5 text-xs font-semibold tracking-wide transition-colors ${
                  activeTab === 'pattern'
                    ? 'text-brown-dark border-b-2 border-rose-dust bg-white'
                    : 'text-brown-light hover:text-brown-warm bg-cream-50'
                }`}
              >
                📄 Your Pattern
              </button>
              <button
                onClick={() => setActiveTab('schematic')}
                className={`flex-1 py-3.5 text-xs font-semibold tracking-wide transition-colors ${
                  activeTab === 'schematic'
                    ? 'text-brown-dark border-b-2 border-rose-dust bg-white'
                    : 'text-brown-light hover:text-brown-warm bg-cream-50'
                }`}
              >
                📐 Schematic
              </button>
            </div>

            {/* AI Visualisation Tab */}
            {activeTab === 'visualise' && (
              <>
                <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-cream-200">
                  <p className="text-xs text-brown-light">See what your project could look like</p>
                  <button
                    onClick={visualise}
                    disabled={imageLoading}
                    className="flex items-center gap-2 bg-sage/10 hover:bg-sage/20 text-brown-dark font-medium px-4 py-2 rounded-full text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {imageLoading ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Generating...
                      </>
                    ) : (
                      <>✨ Visualise</>
                    )}
                  </button>
                </div>
                <div className="p-6">
                  {generatedImage ? (
                    <img
                      src={generatedImage}
                      alt="AI-generated project visualisation"
                      className="w-full rounded-xl object-cover aspect-square"
                    />
                  ) : imageError ? (
                    <div className="aspect-square rounded-xl bg-cream-100 flex flex-col items-center justify-center gap-2 text-center p-6">
                      <span className="text-3xl">⚠️</span>
                      <p className="text-xs text-brown-light leading-relaxed">{imageError}</p>
                      {imageError.includes('GEMINI_API_KEY') && (
                        <p className="text-xs text-brown-light mt-1">
                          Add <code className="bg-cream-200 px-1 rounded">GEMINI_API_KEY</code> to your Vercel environment variables.
                        </p>
                      )}
                      {imageError.includes('paid Gemini API plan') && (
                        <a
                          href="https://aistudio.google.com/apikey"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-rose-dust underline mt-1"
                        >
                          Enable billing in Google AI Studio →
                        </a>
                      )}
                    </div>
                  ) : imageLoading ? (
                    <div className="aspect-square rounded-xl bg-cream-100 flex flex-col items-center justify-center gap-3">
                      <svg className="w-8 h-8 animate-spin text-rose-dust/40" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      <p className="text-xs text-brown-light">Imagining your project...</p>
                    </div>
                  ) : (
                    <div className="aspect-square rounded-xl bg-cream-100 flex flex-col items-center justify-center gap-2 text-center p-6">
                      <span className="text-4xl">✨</span>
                      <p className="text-sm font-medium text-brown-dark">Visualise your project</p>
                      <p className="text-xs text-brown-light leading-relaxed">
                        Click <strong>Visualise</strong> above to generate an AI image of your finished piece.
                        Add a yarn colour for best results.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Pattern Tab */}
            {activeTab === 'pattern' && (
              result ? (
                <>
                  <div className="grid grid-cols-4 gap-px bg-cream-300">
                    {[
                      { label: 'Cast-On Stitches', value: result.castOnStitches.toString() },
                      { label: 'Total Rows', value: result.totalRows.toString() },
                      { label: 'Total Stitches', value: result.totalStitches.toLocaleString() },
                      { label: 'Yarn Estimate', value: `~${result.estimatedYarnGrams}g` },
                    ].map((stat) => (
                      <div key={stat.label} className="bg-cream-50 p-5 text-center">
                        <p className="text-2xl font-bold text-rose-dust font-display">{stat.value}</p>
                        <p className="text-xs text-brown-light mt-1">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="bg-cream-50 border-b border-cream-200 px-5 py-3">
                    <p className="text-xs text-brown-light text-center mb-2">Rolls needed</p>
                    <div className="flex justify-center gap-6">
                      {result.rolls.map((roll) => (
                        <div key={roll.size} className="text-center">
                          <p className="text-lg font-bold text-rose-dust font-display">{roll.count}</p>
                          <p className={`text-xs ${roll.own ? 'text-sage font-semibold' : 'text-brown-light'}`}>
                            {roll.size}g {roll.own ? 'ball (this yarn)' : 'roll'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-display font-semibold text-brown-dark">Your Pattern</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={copyToClipboard}
                          className="flex items-center gap-1.5 text-xs bg-cream-100 hover:bg-cream-200 text-brown-warm px-3 py-1.5 rounded-full transition-colors"
                        >
                          {copied ? '✓ Copied!' : 'Copy'}
                        </button>
                        <button
                          onClick={downloadPattern}
                          className="flex items-center gap-1.5 text-xs bg-btn-gradient text-ink hover:brightness-105 px-3 py-1.5 rounded-full transition-all"
                        >
                          Download
                        </button>
                      </div>
                    </div>
                    <pre className="bg-cream-100 rounded-xl p-4 text-xs text-brown-dark font-mono leading-relaxed overflow-auto max-h-[480px] whitespace-pre-wrap">
                      {result.pattern.join('\n')}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="p-12 text-center">
                  <div className="text-6xl mb-4">🪝</div>
                  <h3 className="font-display text-2xl font-semibold text-brown-dark">
                    Your pattern will appear here
                  </h3>
                  <p className="text-brown-light text-sm mt-3 max-w-xs mx-auto leading-relaxed">
                    Fill in your gauge and project details on the left, then click Generate Pattern.
                  </p>
                </div>
              )
            )}

            {/* Schematic Tab */}
            {activeTab === 'schematic' && (
              result ? (
                <div className="p-6">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="font-display font-semibold text-brown-dark">Schematic</h3>
                      <p className="text-xs text-brown-light">Drawn to scale from your pattern's own numbers.</p>
                    </div>
                    <button
                      onClick={downloadSchematic}
                      className="flex items-center gap-1.5 text-xs bg-btn-gradient text-ink hover:brightness-105 px-3 py-1.5 rounded-full transition-all"
                    >
                      Download SVG
                    </button>
                  </div>
                  {/* Our own markup, built by schematicSvg with every value escaped. */}
                  <div
                    className="rounded-xl overflow-hidden border border-cream-200 [&>svg]:w-full [&>svg]:h-auto"
                    dangerouslySetInnerHTML={{ __html: result.schematic }}
                  />
                </div>
              ) : (
                <div className="p-12 text-center">
                  <div className="text-6xl mb-4">📐</div>
                  <h3 className="font-display text-2xl font-semibold text-brown-dark">
                    Your schematic will appear here
                  </h3>
                  <p className="text-brown-light text-sm mt-3 max-w-xs mx-auto leading-relaxed">
                    Generate a pattern and the piece is drawn to scale, with its foundation chain, rows and gauge.
                  </p>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </>
  );
}
