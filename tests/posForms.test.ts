import { describe, expect, it } from 'vitest';
import { generatedProductSlug, slugify } from '../src/lib/posForms';

describe('product URL slugs', () => {
  it('keeps readable ASCII slugs when available', () => {
    expect(slugify('Cotton yarn, 4 mm hook')).toBe('cotton-yarn-4-mm-hook');
  });

  it('generates a stable URL-safe fallback for non-Latin names', () => {
    const slug = generatedProductSlug('新娘手作玉胳膊', 'https://item.taobao.com/item.htm?id=123', '');
    expect(slug).toMatch(/^product-[a-f0-9]{12}$/);
    expect(generatedProductSlug('新娘手作玉胳膊', 'https://item.taobao.com/item.htm?id=123', '')).toBe(slug);
    expect(generatedProductSlug('新娘手作玉胳膊', 'https://item.taobao.com/item.htm?id=456', '')).not.toBe(slug);
  });
});