import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allowedName = 'TrackSnip Contributors';
const allowedEmail = 'noreply@tracksnip.local';
const failures = [];
const slash = '/';

const forbiddenPatterns = [
  {
    label: 'macOS user home path',
    regex: new RegExp(`${slash}Users${slash}[A-Za-z0-9._-]+`, 'g'),
  },
  {
    label: 'mounted volume path',
    regex: new RegExp(`${slash}Volumes${slash}[A-Za-z0-9._ -]+`, 'g'),
  },
  {
    label: 'Windows user home path',
    regex: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/g,
  },
  {
    label: 'live Suno song UUID',
    regex: /https?:\/\/(?:www\.)?suno\.com\/song\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi,
  },
  {
    label: 'private key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    label: 'OpenAI-style secret',
    regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    label: 'GitHub token',
    regex: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g,
  },
  {
    label: 'AWS access key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    label: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  },
];

function fail(message) {
  failures.push(message);
}

function runGit(args, encoding = 'utf8') {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

function scan(label, value) {
  const text = Buffer.isBuffer(value) ? value.toString('latin1') : String(value);
  for (const pattern of forbiddenPatterns) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    if (regex.test(text)) fail(`${label} contains ${pattern.label}`);
  }

  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  for (const email of emails) {
    if (email.toLowerCase() !== allowedEmail) {
      fail(`${label} contains an unapproved email address`);
    }
  }
}

function utcTimestamp(value) {
  return /(?:Z|\+00:00)$/.test(value);
}

const trackedFiles = String(runGit(['ls-files', '-z']))
  .split('\0')
  .filter(Boolean);

for (const relativePath of trackedFiles) {
  scan(`tracked path ${relativePath}`, relativePath);
  scan(`tracked file ${relativePath}`, fs.readFileSync(path.join(root, relativePath)));
}

const commits = String(runGit([
  'log',
  '--all',
  '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI',
]))
  .trim()
  .split('\n')
  .filter(Boolean);

for (const record of commits) {
  const [hash, authorName, authorEmail, committerName, committerEmail, authorDate, commitDate] =
    record.split('\0');
  if (authorName !== allowedName || committerName !== allowedName) {
    fail(`commit ${hash} uses an unapproved author or committer name`);
  }
  if (authorEmail !== allowedEmail || committerEmail !== allowedEmail) {
    fail(`commit ${hash} uses an unapproved author or committer email`);
  }
  if (!utcTimestamp(authorDate) || !utcTimestamp(commitDate)) {
    fail(`commit ${hash} exposes a non-UTC timezone`);
  }
}

const tagRecords = String(runGit([
  'for-each-ref',
  '--format=%(refname:short)%00%(objecttype)%00%(taggername)%00%(taggeremail)%00%(taggerdate:iso-strict)',
  'refs/tags',
]))
  .trim()
  .split('\n')
  .filter(Boolean);

for (const record of tagRecords) {
  const [name, objectType, taggerName, rawTaggerEmail, taggerDate] = record.split('\0');
  if (objectType !== 'tag') continue;
  const taggerEmail = rawTaggerEmail.replace(/^<|>$/g, '');
  if (taggerName !== allowedName || taggerEmail !== allowedEmail) {
    fail(`tag ${name} uses an unapproved tagger identity`);
  }
  if (!utcTimestamp(taggerDate)) fail(`tag ${name} exposes a non-UTC timezone`);
}

const seenBlobs = new Set();
const objectLines = String(runGit(['rev-list', '--objects', '--all']))
  .trim()
  .split('\n')
  .filter(Boolean);

for (const line of objectLines) {
  const separator = line.indexOf(' ');
  const objectId = separator === -1 ? line : line.slice(0, separator);
  const objectPath = separator === -1 ? '' : line.slice(separator + 1);
  if (seenBlobs.has(objectId)) continue;
  if (String(runGit(['cat-file', '-t', objectId])).trim() !== 'blob') continue;
  seenBlobs.add(objectId);
  scan(`reachable blob ${objectId}${objectPath ? ` (${objectPath})` : ''}`, runGit(
    ['cat-file', 'blob', objectId],
    null,
  ));
}

if (failures.length) {
  console.error('Public repository audit failed:\n');
  [...new Set(failures)].forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  `Public repository audit passed: ${trackedFiles.length} tracked files, `
  + `${commits.length} reachable commits, ${seenBlobs.size} reachable blobs.`,
);
