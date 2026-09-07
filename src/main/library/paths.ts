import { resolve, sep } from 'node:path';

/** True when `candidate` resolves to `dir` itself, or to a path underneath it. */
export function isInsideDir(candidate: string, dir: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedDir = resolve(dir);
  return resolvedCandidate === resolvedDir || resolvedCandidate.startsWith(resolvedDir + sep);
}
