/**
 * Fencing for text the app did not write: page content, tool output, and prompts the model
 * stored earlier. Delimiters are escaped so fenced text cannot close its own fence, and
 * fields the surrounding prompt renders on one line lose their line breaks.
 */

const DELIMITERS = /<\/?(page-content|tool-output|task-prompt)/gi;
const CR = 0x0d;
const TAB = 0x09;
const BREAKS = new Set([0x0a, CR, 0x2028, 0x2029]);

/** C0 and C1 control characters. */
const isControl = (code: number): boolean => code < 0x20 || (code >= 0x7f && code <= 0x9f);

/** Anything but a primitive would render as "[object Object]", which tells the reader nothing. */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value) ?? '';
}

/** Drops control characters; a line break becomes a newline (block) or a space (single line). */
function sanitize(value: unknown, multiline: boolean): string {
  let out = '';
  for (const ch of stringify(value)) {
    const code = ch.codePointAt(0) ?? 0;
    if (BREAKS.has(code)) {
      if (multiline && code !== CR) out += '\n';
      else if (!multiline) out += ' ';
      continue;
    }
    if (isControl(code)) {
      if (multiline && code === TAB) out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Escapes the delimiters that fence untrusted text, so the text cannot close or forge a fence. */
export function fence(text: string): string {
  return String(text).replace(DELIMITERS, (m) => `<\\${m.slice(1)}`);
}

/** A single-line untrusted field (handle, name, URL, page kind): no breaks, no controls, capped. */
export function fenceLine(value: unknown, max: number): string {
  return fence(sanitize(value, false).replace(/ {2,}/g, ' ').trim().slice(0, max));
}

/** A multi-line untrusted body: line breaks kept, other control characters dropped, capped. */
export function fenceBlock(value: unknown, max: number): string {
  return fence(sanitize(value, true).slice(0, max));
}

/** Wraps a tool result for the model: untrusted page data, with its own delimiters escaped. */
export function wrapToolOutput(text: string): string {
  return `<tool-output untrusted source="x.com">\n${fence(text)}\n</tool-output>`;
}

/** Wraps lines in an untrusted fence. Every field inside must already have gone through `fence*`. */
export function pageContentBlock(lines: string[]): string {
  return ['<page-content untrusted>', ...lines, '</page-content>'].join('\n');
}
