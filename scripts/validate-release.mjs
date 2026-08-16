import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredDocs = [
  'README.md',
  'LICENSE',
  'PRIVACY.md',
  'SECURITY.md',
  'ASSET_PROVENANCE.md',
  'CHANGELOG.md',
];
const sourceExtensions = new Set(['.js', '.mjs']);
const referencedAssetExtensions = new Set([
  '.js', '.mjs', '.css', '.html', '.png', '.jpg', '.jpeg', '.gif',
  '.webm', '.mp4', '.svg', '.ico', '.json',
]);
const failures = [];
const checked = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`Missing ${relativePath}`);
    return null;
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolutePath);
    return [absolutePath];
  });
}

const manifestText = read('manifest.json');
const packageText = read('package.json');
let manifest;
let packageMetadata;
if (manifestText) {
  try {
    manifest = JSON.parse(manifestText);
    if (manifest.manifest_version !== 3) fail('manifest.json must use Manifest V3');
    if (!manifest.name || !manifest.version) fail('manifest.json must define name and version');
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error.message}`);
  }
}

if (packageText) {
  try {
    packageMetadata = JSON.parse(packageText);
  } catch (error) {
    fail(`package.json is not valid JSON: ${error.message}`);
  }
}

if (manifest) {
  if (packageMetadata?.version !== manifest.version) {
    fail('package.json and manifest.json versions must match');
  }
  if (JSON.stringify(manifest).includes('<all_urls>')) {
    fail('manifest.json must not request <all_urls>');
  }
  if (manifest.content_scripts) {
    fail('Metadata scripts must be injected with activeTab, not static content_scripts');
  }

  const references = new Set();
  const collectStrings = (value) => {
    if (typeof value === 'string') {
      const extension = path.extname(value).toLowerCase();
      if (referencedAssetExtensions.has(extension)) references.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(collectStrings);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collectStrings);
    }
  };
  collectStrings(manifest);
  for (const relativePath of references) {
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolutePath)) {
      fail(`Manifest reference is missing or escapes the repository: ${relativePath}`);
    } else {
      checked.push(`asset ${relativePath}`);
    }
  }
}

for (const htmlFile of ['popup.html', 'offscreen.html']) {
  const html = read(htmlFile);
  if (!html) continue;
  const references = html.matchAll(/(?:src|href)="([^"]+)"/g);
  for (const match of references) {
    const relativePath = match[1];
    if (/^(?:https?:|data:|#)/.test(relativePath)) continue;
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolutePath)) {
      fail(`${htmlFile} reference is missing or escapes the repository: ${relativePath}`);
    } else {
      checked.push(`asset ${relativePath}`);
    }
  }
}

for (const relativePath of requiredDocs) {
  const content = read(relativePath);
  if (content && !content.trim()) fail(`${relativePath} is empty`);
}

const assetProvenance = read('ASSET_PROVENANCE.md');
if (assetProvenance) {
  if (!assetProvenance.includes('Ownership confirmed: 2026-08-16.')) {
    fail('ASSET_PROVENANCE.md must record the owner confirmation date');
  }
  if (assetProvenance.includes('Do not publish the repository until')) {
    fail('ASSET_PROVENANCE.md still contains an unresolved publication blocker');
  }
  const rows = assetProvenance.matchAll(/\| `([^`]+)` \| `([a-f0-9]{64})` \|/g);
  let assetCount = 0;
  for (const [, relativePath, expectedHash] of rows) {
    assetCount++;
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolutePath)) {
      fail(`Provenance asset is missing or escapes the repository: ${relativePath}`);
      continue;
    }
    const actualHash = createHash('sha256')
      .update(fs.readFileSync(absolutePath))
      .digest('hex');
    if (actualHash !== expectedHash) {
      fail(`Asset hash changed without a provenance update: ${relativePath}`);
    } else {
      checked.push(`provenance ${relativePath}`);
    }
  }
  if (assetCount === 0) fail('ASSET_PROVENANCE.md contains no hashed asset inventory');
}

for (const absolutePath of walk(root)) {
  const relativePath = path.relative(root, absolutePath);
  if (relativePath.startsWith('.git') || relativePath.startsWith('node_modules')) continue;
  if (!sourceExtensions.has(path.extname(relativePath).toLowerCase())) continue;
  const result = spawnSync(process.execPath, ['--check', absolutePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`JavaScript syntax check failed for ${relativePath}\n${result.stderr.trim()}`);
  } else {
    checked.push(`syntax ${relativePath}`);
  }
}

if (failures.length) {
  console.error('Release validation failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Release validation passed: ${checked.length} references/checks verified.`);
