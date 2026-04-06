import { useState, useCallback } from 'react';

// --- Types ---
interface GaugeInputs {
  stitchesPer10cm: number;
  rowsPer10cm: number;
}

interface ProjectInputs {
  widthCm: number;
  heightCm: number;
  yarnWeight: string;
  hookSize: string;
  projectType: string;
  stitchPattern: string;
  notes: string;
}

interface PatternResult {
  castOnStitches: number;
  totalRows: number;
  totalStitches: number;
  estimatedYarnMeters: number;
  pattern: string[];
}

// --- Data tables ---
const YARN_WEIGHTS = [
  { label: 'Lace (0)', value: 'lace', multiplier: 0.7 },
  { label: 'Super Fine / Fingering (1)', value: 'fingering', multiplier: 0.9 },
  { label: 'Fine / Sport (2)', value: 'sport', multiplier: 1.0 },
  { label: 'Light / DK (3)', value: 'dk', multiplier: 1.2 },
  { label: 'Medium / Worsted (4)', value: 'worsted', multiplier: 1.5 },
  { label: 'Bulky (5)', value: 'bulky', multiplier: 1.9 },
  { label: 'Super Bulky (6)', value: 'super-bulky', multiplier: 2.5 },
];

const HOOK_SIZES: Record<string, string[]> = {
  lace: ['0.75mm', '1.0mm', '1.5mm', '1.75mm'],
  fingering: ['1.75mm', '2.0mm', '2.25mm', '2.75mm'],
  sport: ['2.75mm', '3.0mm', '3.5mm'],
  dk: ['3.5mm', '4.0mm', '4.5mm'],
  worsted: ['4.5mm', '5.0mm', '5.5mm', '6.0mm'],
  bulky: ['6.0mm', '6.5mm', '7.0mm', '8.0mm', '9.0mm'],
  'super-bulky': ['9.0mm', '10.0mm', '12.0mm', '15.0mm'],
};

const PROJECT_TYPES = ['Blanket', 'Amigurumi', 'Hat', 'Scarf', 'Bag', 'Cardigan / Top', 'Other'];

const STITCH_PATTERNS = [
  { label: 'Single Crochet (sc)', value: 'sc', heightFactor: 1.0 },
  { label: 'Half Double Crochet (hdc)', value: 'hdc', heightFactor: 1.3 },
  { label: 'Double Crochet (dc)', value: 'dc', heightFactor: 1.6 },
  { label: 'Treble Crochet (tr)', value: 'tr', heightFactor: 2.0 },
  { label: 'Moss / Granite Stitch', value: 'moss', heightFactor: 1.0 },
  { label: 'Granny Square', value: 'granny', heightFactor: 1.0 },
  { label: 'Shell Stitch', value: 'shell', heightFactor: 1.6 },
  { label: 'V-Stitch', value: 'vstitch', heightFactor: 1.6 },
];

// --- Helpers ---
function generatePattern(
  gauge: GaugeInputs,
  project: ProjectInputs,
): PatternResult {
  const stitchData = STITCH_PATTERNS.find((s) => s.value === project.stitchPattern) ?? STITCH_PATTERNS[0];
  const yarnData = YARN_WEIGHTS.find((y) => y.value === project.yarnWeight) ?? YARN_WEIGHTS[4];

  // Adjust row gauge by stitch height factor
  const adjustedRowsPerCm = (gauge.rowsPer10cm / 10) / stitchData.heightFactor;

  const castOn = Math.round((gauge.stitchesPer10cm / 10) * project.widthCm);
  const totalRows = Math.round(adjustedRowsPerCm * project.heightCm);
  const totalStitches = castOn * totalRows;

  // Rough yarn estimate: stitches × width per stitch × yarn weight multiplier
  const estimatedYarnMeters = Math.round(totalStitches * 0.025 * yarnData.multiplier * 10) / 10;

  const stAbbr = stitchData.value.toUpperCase();
  const ch = project.stitchPattern === 'dc' ? 3 : project.stitchPattern === 'hdc' ? 2 : 1;

  const lines: string[] = [
    `═══════════════════════════════════════`,
    `  LOOPY & CO. PATTERN GENERATOR`,
    `═══════════════════════════════════════`,
    ``,
    `Project: ${project.projectType}`,
    `Stitch: ${stitchData.label}`,
    `Yarn Weight: ${yarnData.label}`,
    `Hook Size: ${project.hookSize}`,
    `Dimensions: ${project.widthCm}cm wide × ${project.heightCm}cm tall`,
    ``,
    `───────────────────────────────────────`,
    `GAUGE (per 10cm)`,
    `───────────────────────────────────────`,
    `  Stitches: ${gauge.stitchesPer10cm}`,
    `  Rows: ${gauge.rowsPer10cm}`,
    ``,
    `───────────────────────────────────────`,
    `YOUR PATTERN`,
    `───────────────────────────────────────`,
    ``,
    `MATERIALS`,
    `  · ${yarnData.label} weight yarn`,
    `  · ${project.hookSize} crochet hook`,
    `  · Stitch markers, yarn needle`,
    `  · ~${estimatedYarnMeters}m of yarn (estimate)`,
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
    `  ch across. — ${castOn} ${stAbbr} made.`,
    ``,
    `Rows 2–${totalRows}:`,
    `  Ch ${ch}, turn. ${stAbbr} in each ${stAbbr} across.`,
    `  — ${castOn} sts per row.`,
    ``,
    `Fasten off and weave in all ends.`,
    ``,
    `───────────────────────────────────────`,
    `SUMMARY`,
    `───────────────────────────────────────`,
    `  Cast-on stitches: ${castOn}`,
    `  Total rows: ${totalRows}`,
    `  Total stitches worked: ${totalStitches.toLocaleString()}`,
    `  Yarn estimate: ~${estimatedYarnMeters}m`,
    ``,
    ...(project.notes
      ? [`───────────────────────────────────────`, `NOTES`, `  ${project.notes}`, ``]
      : []),
    `═══════════════════════════════════════`,
    `  Made with Loopy & Co. Pattern Generator`,
    `  loopyandco.com/pattern-generator`,
    `═══════════════════════════════════════`,
  ];

  return {
    castOnStitches: castOn,
    totalRows,
    totalStitches,
    estimatedYarnMeters,
    pattern: lines,
  };
}

// --- Component ---
export default function PatternGenerator() {
  const [gauge, setGauge] = useState<GaugeInputs>({ stitchesPer10cm: 16, rowsPer10cm: 20 });
  const [project, setProject] = useState<ProjectInputs>({
    widthCm: 30,
    heightCm: 30,
    yarnWeight: 'worsted',
    hookSize: '5.0mm',
    projectType: 'Blanket',
    stitchPattern: 'sc',
    notes: '',
  });
  const [result, setResult] = useState<PatternResult | null>(null);
  const [copied, setCopied] = useState(false);

  const hookOptions = HOOK_SIZES[project.yarnWeight] ?? HOOK_SIZES['worsted'];

  const handleYarnChange = useCallback((val: string) => {
    const hooks = HOOK_SIZES[val] ?? [];
    setProject((p) => ({ ...p, yarnWeight: val, hookSize: hooks[Math.floor(hooks.length / 2)] ?? '' }));
  }, []);

  const generate = useCallback(() => {
    setResult(generatePattern(gauge, project));
  }, [gauge, project]);

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
    a.download = `loopy-pattern-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="grid lg:grid-cols-2 gap-10 items-start">
      {/* Input Panel */}
      <div className="space-y-6">
        {/* Gauge */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-serif text-xl font-semibold text-brown-dark mb-1">Your Gauge</h2>
          <p className="text-brown-light text-xs mb-5">
            Crochet a 10cm × 10cm swatch and count your stitches and rows.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-brown-warm mb-1.5">
                Stitches per 10cm
              </label>
              <input
                type="number"
                min={1}
                max={60}
                value={gauge.stitchesPer10cm}
                onChange={(e) => setGauge((g) => ({ ...g, stitchesPer10cm: Number(e.target.value) }))}
                className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-brown-warm mb-1.5">
                Rows per 10cm
              </label>
              <input
                type="number"
                min={1}
                max={80}
                value={gauge.rowsPer10cm}
                onChange={(e) => setGauge((g) => ({ ...g, rowsPer10cm: Number(e.target.value) }))}
                className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
              />
            </div>
          </div>
        </div>

        {/* Project Details */}
        <div className="bg-white rounded-2xl p-6 shadow-sm">
          <h2 className="font-serif text-xl font-semibold text-brown-dark mb-5">Project Details</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-brown-warm mb-1.5">
                  Width (cm)
                </label>
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
                <label className="block text-xs font-medium text-brown-warm mb-1.5">
                  Height (cm)
                </label>
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
              <label className="block text-xs font-medium text-brown-warm mb-1.5">
                Project Type
              </label>
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
              <label className="block text-xs font-medium text-brown-warm mb-1.5">
                Stitch Pattern
              </label>
              <select
                value={project.stitchPattern}
                onChange={(e) => setProject((p) => ({ ...p, stitchPattern: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
              >
                {STITCH_PATTERNS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-brown-warm mb-1.5">
                Yarn Weight
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
                Hook Size
              </label>
              <select
                value={project.hookSize}
                onChange={(e) => setProject((p) => ({ ...p, hookSize: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40"
              >
                {hookOptions.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-brown-warm mb-1.5">
                Notes (optional)
              </label>
              <textarea
                value={project.notes}
                onChange={(e) => setProject((p) => ({ ...p, notes: e.target.value }))}
                rows={3}
                placeholder="E.g. colour changes, custom stitch notes…"
                className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-50 text-brown-dark text-sm focus:outline-none focus:ring-2 focus:ring-rose-dust/40 resize-none"
              />
            </div>
          </div>
        </div>

        <button
          onClick={generate}
          className="w-full bg-rose-dust hover:bg-rose-dark text-white font-semibold py-4 rounded-full transition-colors text-sm flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Generate Pattern
        </button>
      </div>

      {/* Output Panel */}
      <div className="sticky top-24">
        {result ? (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-px bg-cream-300">
              {[
                { label: 'Cast-On Stitches', value: result.castOnStitches.toString() },
                { label: 'Total Rows', value: result.totalRows.toString() },
                { label: 'Total Stitches', value: result.totalStitches.toLocaleString() },
                { label: 'Yarn Estimate', value: `~${result.estimatedYarnMeters}m` },
              ].map((stat) => (
                <div key={stat.label} className="bg-cream-50 p-5 text-center">
                  <p className="text-2xl font-bold text-rose-dust font-serif">{stat.value}</p>
                  <p className="text-xs text-brown-light mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Pattern text */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-serif font-semibold text-brown-dark">Your Pattern</h3>
                <div className="flex gap-2">
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-1.5 text-xs bg-cream-100 hover:bg-cream-200 text-brown-warm px-3 py-1.5 rounded-full transition-colors"
                  >
                    {copied ? '✓ Copied!' : '⎘ Copy'}
                  </button>
                  <button
                    onClick={downloadPattern}
                    className="flex items-center gap-1.5 text-xs bg-rose-dust hover:bg-rose-dark text-white px-3 py-1.5 rounded-full transition-colors"
                  >
                    ↓ Download
                  </button>
                </div>
              </div>
              <pre className="bg-cream-100 rounded-xl p-4 text-xs text-brown-dark font-mono leading-relaxed overflow-auto max-h-[480px] whitespace-pre-wrap">
                {result.pattern.join('\n')}
              </pre>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <div className="text-6xl mb-4">🪝</div>
            <h3 className="font-serif text-2xl font-semibold text-brown-dark">
              Your pattern will appear here
            </h3>
            <p className="text-brown-light text-sm mt-3 max-w-xs mx-auto leading-relaxed">
              Fill in your gauge and project details on the left, then click Generate Pattern.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
