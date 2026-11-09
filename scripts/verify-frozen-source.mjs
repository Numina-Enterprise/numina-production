import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Historical pytest cache bytes are listed in the preserved manifest but were
// never committed. Their absence must be reported without bypassing source checks.
export function verifyFrozenFiles(directory, entries) {
  const missingCacheFiles = [];
  let verifiedFiles = 0;
  for (const entry of entries) {
    if (!entry.path || entry.path.startsWith('/') || entry.path.includes('\\') || entry.path.split('/').some(part => part === '..' || part === '.')) {
      throw new Error('Invalid frozen source path');
    }
    const file = join(directory, entry.path);
    if (!existsSync(file) && /^core\/\.pytest_cache\/(?:\.gitignore|CACHEDIR\.TAG|README\.md|v\/cache\/(?:lastfailed|nodeids))$/.test(entry.path)) {
      missingCacheFiles.push(entry.path);
      continue;
    }
    if (digest(readFileSync(file)) !== entry.sha256) throw new Error('Frozen core bytes differ: ' + entry.path);
    verifiedFiles++;
  }
  return {verifiedFiles, expectedFiles: entries.length, missingCacheFiles, complete: missingCacheFiles.length === 0};
}
