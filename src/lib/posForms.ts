/*
 * Helpers shared by the /api/pos/* routes. Everything the POS submits is a
 * plain HTML form, so every value arrives as a string — these turn that back
 * into the shapes the database expects.
 */

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function str(form: FormData, key: string): string {
  return (form.get(key)?.toString() ?? '').trim();
}

/** Trimmed value, or null when the field was left blank. */
export function nullableStr(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === '' ? null : value;
}

export function num(form: FormData, key: string, fallback: number): number {
  const raw = str(form, key);
  if (raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nullableNum(form: FormData, key: string): number | null {
  const raw = str(form, key);
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An unchecked checkbox submits nothing at all, so absence means false. */
export function bool(form: FormData, key: string): boolean {
  return form.get(key) !== null;
}

/** "merino, wool,  aran " -> ['merino','wool','aran'] */
export function csv(form: FormData, key: string): string[] {
  return str(form, key)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One value per line, blanks dropped. */
export function lines(form: FormData, key: string): string[] {
  return str(form, key)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Only ever redirect back inside the POS. */
export function safeNext(form: FormData, fallback: string): string {
  const next = str(form, 'next');
  return next.startsWith('/pos') ? next : fallback;
}

export function withFlash(path: string, kind: 'ok' | 'error', message: string): string {
  const [base, existing = ''] = path.split('?');
  const params = new URLSearchParams(existing);
  params.delete('ok');
  params.delete('error');
  params.set(kind, message);
  return `${base}?${params.toString()}`;
}

/**
 * Supabase reports a unique-constraint breach as 23505. The POS only has two
 * unique columns, both slugs, so the message can be specific.
 */
export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

/** Every value submitted under one name, in document order. */
export function all(form: FormData, key: string): string[] {
  return form.getAll(key).map((v) => v.toString().trim());
}

/**
 * A foreign key that is still pointed at by another row. The bundle editor is
 * the only place that creates such a reference, so the message can say so.
 */
export function isForeignKeyViolation(error: { code?: string } | null): boolean {
  return error?.code === '23503';
}
