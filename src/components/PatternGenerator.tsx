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
  yarnColor: string;
  notes: string;
}

interface PatternResult {
  castOnStitches: number;
  totalRows: number;
  totalStitches: number;
  estimatedYarnMeters: number;
  estimatedSkeins: number;
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
  sport: ['2.75mm', '3.0mm', '3.25mm', '3.5mm'],
  dk: ['3.5mm', '3.75mm', '4.0mm', '4.25mm', '4.5mm'],
  worsted: ['4.0mm', '4.5mm', '5.0mm', '5.5mm', '6.0mm'],
  bulky: ['6.0mm', '6.5mm', '7.0mm', '8.0mm', '9.0mm'],
  'super-bulky': ['9.0mm', '10.0mm', '12.0mm', '15.0mm'],
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
  'Cardigan / Top',
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
function generatePattern(gauge: GaugeInputs, project: ProjectInputs, grannyPatternName?: string): PatternResult {
  const stitchData = STITCH_PATTERNS.find((s) => s.value === project.stitchPattern) ?? STITCH_PATTERNS[0];
  const yarnData = YARN_WEIGHTS.find((y) => y.value === project.yarnWeight) ?? YARN_WEIGHTS[4];

  const adjustedRowsPerCm = (gauge.rowsPer10cm / 10) / stitchData.heightFactor;
  const castOn = Math.round((gauge.stitchesPer10cm / 10) * project.widthCm);
  const totalRows = Math.round(adjustedRowsPerCm * project.heightCm);
  const totalStitches = castOn * totalRows;

  // Yarn estimate: each sc stitch uses ~0.3cm of yarn per mm of hook size equivalent.
  // Base: 3cm per stitch for sc with worsted, scaled by yarn weight multiplier and stitch yarn factor.
  const yarnPerStitchCm = 3.0 * yarnData.multiplier * stitchData.yarnFactor;
  const estimatedYarnMeters = Math.round((totalStitches * yarnPerStitchCm) / 100 * 10) / 10;
  // Assume a standard 100m skein for skein count
  const estimatedSkeins = Math.ceil(estimatedYarnMeters / 100);

  const stAbbr = stitchData.value.toUpperCase();
  const ch = project.stitchPattern === 'dc' ? 3 : project.stitchPattern === 'hdc' ? 2 : 1;

  const grannyNote = grannyPatternName ? `\nSelected Granny Pattern: ${grannyPatternName}` : '';

  const lines: string[] = [
    `===========================================`,
    `  ZIPPYZACK.COM PATTERN GENERATOR`,
    `===========================================`,
    ``,
    `Project: ${project.projectType}`,
    `Stitch: ${stitchData.label}${grannyNote}`,
    `Yarn Weight: ${yarnData.label}`,
    `Hook Size: ${project.hookSize}`,
    ...(project.yarnColor ? [`Yarn Colour: ${project.yarnColor}`] : []),
    `Dimensions: ${project.widthCm}cm wide x ${project.heightCm}cm tall`,
    ``,
    `-------------------------------------------`,
    `GAUGE (per 10cm)`,
    `-------------------------------------------`,
    `  Stitches: ${gauge.stitchesPer10cm}`,
    `  Rows: ${gauge.rowsPer10cm}`,
    ``,
    `-------------------------------------------`,
    `YOUR PATTERN`,
    `-------------------------------------------`,
    ``,
    `MATERIALS`,
    `  . ${yarnData.label} weight yarn`,
    `  . ${project.hookSize} crochet hook`,
    `  . Stitch markers, yarn needle`,
    `  . ~${estimatedYarnMeters}m of yarn (estimate)`,
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
    `  Yarn estimate: ~${estimatedYarnMeters}m (~${estimatedSkeins} x 100m skein${estimatedSkeins !== 1 ? 's' : ''})`,
    ``,
    ...(project.notes
      ? [`-------------------------------------------`, `NOTES`, `  ${project.notes}`, ``]
      : []),
    `===========================================`,
    `  Made with ZippyZack.com Pattern Generator`,
    `  zippyzack.com/pattern-generator`,
    `===========================================`,
  ];

  return { castOnStitches: castOn, totalRows, totalStitches, estimatedYarnMeters, estimatedSkeins, pattern: lines };
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
            <h2 className="font-serif text-xl font-semibold text-brown-dark">Granny Square Patterns</h2>
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

// --- Main Component ---
export default function PatternGenerator() {
  const [gauge, setGauge] = useState<GaugeInputs>({ stitchesPer10cm: 16, rowsPer10cm: 20 });
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
  const [activeTab, setActiveTab] = useState<'visualise' | 'pattern'>('visualise');

  const hookOptions = HOOK_SIZES[project.yarnWeight] ?? HOOK_SIZES['worsted'];

  const handleYarnChange = useCallback((val: string) => {
    const hooks = HOOK_SIZES[val] ?? [];
    setProject((p) => ({ ...p, yarnWeight: val, hookSize: hooks[Math.floor(hooks.length / 2)] ?? '' }));
  }, []);

  const handleStitchChange = useCallback((val: string) => {
    setProject((p) => ({ ...p, stitchPattern: val }));
    if (val === 'granny') setGrannyModalOpen(true);
  }, []);

  const generate = useCallback(() => {
    const grannyName = project.stitchPattern === 'granny' ? selectedGrannyPattern?.name : undefined;
    setResult(generatePattern(gauge, project, grannyName));
    setGeneratedImage(null);
    setImageError(null);
    setActiveTab('pattern');
  }, [gauge, project, selectedGrannyPattern]);

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
            <h2 className="font-serif text-xl font-semibold text-brown-dark mb-1">Your Gauge</h2>
            <p className="text-brown-light text-xs mb-5">
              Crochet a 10cm x 10cm swatch and count your stitches and rows.
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

          <div className="bg-white rounded-2xl p-6 shadow-sm">
            <h2 className="font-serif text-xl font-semibold text-brown-dark mb-5">Project Details</h2>
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
                <label className="block text-xs font-medium text-brown-warm mb-1.5">Yarn Weight</label>
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
                <label className="block text-xs font-medium text-brown-warm mb-1.5">Hook Size</label>
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
                  Yarn Colour <span className="text-brown-light font-normal">(for AI visualisation)</span>
                </label>
                <input
                  type="text"
                  value={project.yarnColor}
                  onChange={(e) => setProject((p) => ({ ...p, yarnColor: e.target.value }))}
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
                  <div className="grid grid-cols-3 gap-px bg-cream-300">
                    {[
                      { label: 'Cast-On Stitches', value: result.castOnStitches.toString() },
                      { label: 'Total Rows', value: result.totalRows.toString() },
                      { label: 'Total Stitches', value: result.totalStitches.toLocaleString() },
                      { label: 'Yarn Estimate', value: `~${result.estimatedYarnMeters}m` },
                      { label: 'Skeins (100m)', value: `~${result.estimatedSkeins}` },
                    ].map((stat) => (
                      <div key={stat.label} className="bg-cream-50 p-5 text-center">
                        <p className="text-2xl font-bold text-rose-dust font-serif">{stat.value}</p>
                        <p className="text-xs text-brown-light mt-1">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-serif font-semibold text-brown-dark">Your Pattern</h3>
                      <div className="flex gap-2">
                        <button
                          onClick={copyToClipboard}
                          className="flex items-center gap-1.5 text-xs bg-cream-100 hover:bg-cream-200 text-brown-warm px-3 py-1.5 rounded-full transition-colors"
                        >
                          {copied ? '✓ Copied!' : 'Copy'}
                        </button>
                        <button
                          onClick={downloadPattern}
                          className="flex items-center gap-1.5 text-xs bg-rose-dust hover:bg-rose-dark text-white px-3 py-1.5 rounded-full transition-colors"
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
                  <h3 className="font-serif text-2xl font-semibold text-brown-dark">
                    Your pattern will appear here
                  </h3>
                  <p className="text-brown-light text-sm mt-3 max-w-xs mx-auto leading-relaxed">
                    Fill in your gauge and project details on the left, then click Generate Pattern.
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
