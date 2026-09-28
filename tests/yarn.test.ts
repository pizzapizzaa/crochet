import { describe, expect, it, vi, afterEach } from 'vitest';
import { pageText, parseYarnSpecs, scrapeYarn, yarnFromText } from '../src/lib/scrape/yarn';
import iLoveThisYarn from './fixtures/yarn/hobbylobby-i-love-this-yarn.html?raw';
import braidedBasics from './fixtures/yarn/hobbylobby-braided-basics-xxl.html?raw';
import taobaoLoginWall from './fixtures/yarn/taobao-login-wall.html?raw';

/*
 * The fixtures are real pages, saved as a server fetch receives them, from the
 * shops the yarn is actually bought from. When a shop changes its markup, save
 * the page again over its fixture and see what breaks.
 */

function servePage(html: string, url: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (requested: string) => {
      // Everything but the page itself — Shopify's .json and the like — 404s.
      if (requested !== url) return new Response('', { status: 404 });
      const res = new Response(html, { status: 200 });
      // A real fetch reports where it ended up; a constructed one cannot, so
      // the getter is shadowed instead.
      Object.defineProperty(res, 'url', { value: url });
      return res;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Hobby Lobby', () => {
  it('reads I Love This Yarn in grams, metres and stitches per 5cm', async () => {
    const url = 'https://www.hobbylobby.com/yarn-needle-art/yarn-tools/yarn/353-menthe---i-love-this-yarn/p/96097';
    servePage(iLoveThisYarn, url);

    const { specs, found, note } = await scrapeYarn(url);

    expect(found).toBe(true);
    expect(note).toBeNull();
    expect(specs.name).toBe('I Love This Yarn');
    expect(specs.brand).toBe('I Love this Yarn');
    expect(specs.weight).toBe('worsted');
    expect(specs.weightStated).toBe(true);
    expect(specs.hookMm).toBe(5.5);
    expect(specs.hook).toBe('5.5mm');
    // 7 oz and 355 yd.
    expect(specs.ballGrams).toBe(198);
    expect(specs.ballMeters).toBe(325);
    expect(specs.metersPerGram).toBe(1.64);
    // 12 sc × 15 rows over 4".
    expect(specs.crochetGauge).toEqual({ stitchesPer5cm: 5.9, rowsPer5cm: 7.4, stitch: 'sc' });
    expect(specs.referenceGauge?.kind).toBe('knit');
    expect(specs.colour).toBe('353 Menthe (Green)');
    expect(specs.fibre).toBe('100% Acrylic');
  });

  it('reads Braided Basics XXL, misspelt "Crotchet" and all', async () => {
    const url = 'https://www.hobbylobby.com/yarn-needle-art/yarn-tools/yarn/black---yarn-bee-braided-basics-xxl/p/81290834';
    servePage(braidedBasics, url);

    const { specs } = await scrapeYarn(url);

    expect(specs.weight).toBe('bulky');
    // "8-10mm" — the middle of the range, which is on the bulky list.
    expect(specs.hookMm).toBe(9);
    expect(specs.hook).toBe('9.0mm');
    expect(specs.ballGrams).toBe(250);
    expect(specs.ballMeters).toBe(65);
    expect(specs.metersPerGram).toBe(0.26);
    expect(specs.crochetGauge).toEqual({ stitchesPer5cm: 3.9, rowsPer5cm: 3.9, stitch: 'sc' });
    expect(specs.colour).toBe('Black');
    expect(specs.fibre).toBe('54% Cotton & 46% Polyester');
  });
});

describe('Taobao', () => {
  it('says to paste or use the extension when a server gets the login wall', async () => {
    const url = 'https://item.taobao.com/item.htm?id=44384175454';
    servePage(taobaoLoginWall, url);

    const { found, note } = await scrapeYarn(url);

    expect(found).toBe(false);
    expect(note).toMatch(/signed-in browser/);
    expect(note).toMatch(/extension/);
  });

  /*
   * Hand-written in the shape of a Taobao parameter table, not copied from a
   * real listing — replace it with a real one once there is one to hand.
   */
  it('reads a pasted parameter table in Chinese', () => {
    const text = [
      '品牌：奶棉',
      '成分含量：60%精梳棉 40%腈纶',
      '颜色分类：03 奶白',
      '规格：5股 约50克/团 约125米',
      '建议钩针：2.5-3.0mm',
    ].join('\n');

    const { specs, found } = yarnFromText(text, { url: 'https://item.taobao.com/item.htm?id=1', title: '奶棉毛线 5股 手工钩针-淘宝网' });

    expect(found).toBe(true);
    expect(specs.brand).toBe('奶棉');
    expect(specs.fibre).toBe('60%精梳棉 40%腈纶');
    expect(specs.colour).toBe('03 奶白');
    expect(specs.ballGrams).toBe(50);
    expect(specs.ballMeters).toBe(125);
    expect(specs.hookMm).toBe(2.75);
    // No category given: 2.5 m/g is nearest DK's typical 2.3.
    expect(specs.weight).toBe('dk');
    expect(specs.weightStated).toBe(false);
    expect(specs.name).toBe('奶棉毛线 5股 手工钩针');
  });
});

describe('parseYarnSpecs', () => {
  it('never fills the crochet boxes from a knitting gauge', () => {
    const specs = parseYarnSpecs('Tension: 22 sts x 28 rows to 10cm on 4mm needles\nWeight: DK');
    expect(specs.crochetGauge).toBeNull();
    expect(specs.referenceGauge).toMatchObject({ stitchesPer5cm: 11, rowsPer5cm: 14 });
  });

  it('does not read a hook size as a length', () => {
    const specs = parseYarnSpecs('Hook: 5mm\nBall: 100g');
    expect(specs.ballMeters).toBeNull();
    expect(specs.hookMm).toBe(5);
  });

  it('takes a weight and length written on one line', () => {
    const specs = parseYarnSpecs('Paintbox Yarns Simply DK\n100g / 276m per ball', { name: 'Paintbox Yarns Simply DK' });
    expect(specs.weight).toBe('dk');
    expect(specs.metersPerGram).toBe(2.76);
  });

  it('turns spec tables into label: value lines', () => {
    const text = pageText('<table><tr><th>Yarn weight</th><td>Aran</td></tr><tr><td>Hook</td><td>5 mm</td></tr></table>');
    const specs = parseYarnSpecs(text);
    expect(specs.weight).toBe('worsted');
    expect(specs.hookMm).toBe(5);
  });
});
