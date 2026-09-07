export function slugify(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function pdfFileName(meta: { date: Date; author: string; title: string; id: string }): string {
  const date = meta.date.toISOString().slice(0, 10);
  const author = slugify(meta.author) || 'x';
  const title = slugify(meta.title).split('-').slice(0, 8).join('-') || 'post';
  return `${date}-${author}-${title}-${meta.id}.pdf`;
}
