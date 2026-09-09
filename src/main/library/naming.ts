export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
/** Post ids come from page-evaluated JS, so they are reduced to characters that cannot shape a path. */
export function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '').slice(0, 32) || 'x';
}
export function pdfFileName(meta: { date: Date; author: string; title: string; id: string }): string {
  const date = meta.date.toISOString().slice(0, 10);
  const author = slugify(meta.author) || 'x';
  const title = slugify(meta.title).split('-').slice(0, 8).join('-') || 'post';
  return `${date}-${author}-${title}-${sanitizeId(meta.id)}.pdf`;
}
