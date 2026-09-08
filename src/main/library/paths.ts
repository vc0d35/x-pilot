import { extname, resolve, sep } from 'node:path';

export function isInsideDir(candidate: string, dir: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedDir = resolve(dir);
  return resolvedCandidate === resolvedDir || resolvedCandidate.startsWith(resolvedDir + sep);
}

/**
 * The one rule for handing a path to the system opener: a PDF that either lives in the current
 * library folder or was recorded by the library (the folder can change; saved items stay openable).
 */
export function isOpenablePdf(path: string, libraryDir: string, hasLibraryPath: (p: string) => boolean): boolean {
  const resolved = resolve(path);
  if (extname(resolved).toLowerCase() !== '.pdf') return false;
  return isInsideDir(resolved, libraryDir) || hasLibraryPath(resolved);
}
