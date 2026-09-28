/*
 * The yarn weight table, shared by the pattern generator and the yarn scraper.
 *
 * The scraper has to land on exactly the values the generator's dropdowns
 * offer — a weight it names that the form does not have would be dropped on
 * the floor — so both read them from here rather than keeping a copy each.
 *
 * `metersPerGram` is a typical figure for the category. It is what the yarn
 * estimate falls back on when nobody has told us the real one, and what the
 * scraper matches against when a page gives length and weight but no category.
 */

export type YarnWeight = 'lace' | 'fingering' | 'sport' | 'dk' | 'worsted' | 'bulky' | 'super-bulky';

export interface YarnWeightInfo {
  label: string;
  value: YarnWeight;
  multiplier: number;
  metersPerGram: number;
}

export const YARN_WEIGHTS: YarnWeightInfo[] = [
  { label: 'Lace (0)', value: 'lace', multiplier: 0.7, metersPerGram: 9.0 },
  { label: 'Super Fine / Fingering (1)', value: 'fingering', multiplier: 0.9, metersPerGram: 4.0 },
  { label: 'Fine / Sport (2)', value: 'sport', multiplier: 1.0, metersPerGram: 3.2 },
  { label: 'Light / DK (3)', value: 'dk', multiplier: 1.2, metersPerGram: 2.3 },
  { label: 'Medium / Worsted (4)', value: 'worsted', multiplier: 1.5, metersPerGram: 2.0 },
  { label: 'Bulky (5)', value: 'bulky', multiplier: 1.9, metersPerGram: 1.1 },
  { label: 'Super Bulky (6)', value: 'super-bulky', multiplier: 2.5, metersPerGram: 0.6 },
];

export const HOOK_SIZES: Record<YarnWeight, string[]> = {
  lace: ['0.75mm', '1.0mm', '1.5mm', '1.75mm'],
  fingering: ['1.75mm', '2.0mm', '2.25mm', '2.75mm'],
  sport: ['2.75mm', '3.0mm', '3.25mm', '3.5mm'],
  dk: ['3.5mm', '3.75mm', '4.0mm', '4.25mm', '4.5mm'],
  worsted: ['4.0mm', '4.5mm', '5.0mm', '5.5mm', '6.0mm'],
  bulky: ['6.0mm', '6.5mm', '7.0mm', '8.0mm', '9.0mm'],
  'super-bulky': ['9.0mm', '10.0mm', '12.0mm', '15.0mm'],
};

/** "5.5mm", the way the hook lists spell sizes, from a number of millimetres. */
export const hookLabel = (mm: number): string => `${Number.isInteger(mm) ? mm.toFixed(1) : String(mm)}mm`;
