import { extname, resolve, sep } from 'node:path';

/** True when `candidate` resolves to `dir` itself, or to a path underneath it. */
export function isInsideDir(candidate: string, dir: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedDir = resolve(dir);
  return resolvedCandidate === resolvedDir || resolvedCandidate.startsWith(resolvedDir + sep);
}

/**
 * The one rule for handing a path to the system opener: it must be a PDF, and it must either
 * live in the current library folder or be a path the library recorded (the folder can change
 * after items were saved, and those stay openable).
 */
export function isOpenablePdf(path: string, libraryDir: string, hasLibraryPath: (p: string) => boolean): boolean {
  const resolved = resolve(path);
  if (extname(resolved).toLowerCase() !== '.pdf') return false;
  return isInsideDir(resolved, libraryDir) || hasLibraryPath(resolved);
}
