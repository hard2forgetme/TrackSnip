import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const outputDirectory = path.join(root, 'release');
const archivePath = path.join(outputDirectory, `tracksnip-v${manifest.version}.zip`);
const stagingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracksnip-release-'));
const excludedDirectories = new Set(['.git', '.github', 'node_modules', 'release', 'scripts', 'tests']);
const excludedFiles = new Set(['.gitignore', 'package.json', 'package-lock.json']);

function copyTree(sourceDirectory, destinationDirectory) {
  fs.mkdirSync(destinationDirectory, { recursive: true });
  const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    if (entry.isFile() && excludedFiles.has(entry.name)) continue;
    const sourcePath = path.join(sourceDirectory, entry.name);
    const destinationPath = path.join(destinationDirectory, entry.name);
    if (entry.isDirectory()) copyTree(sourcePath, destinationPath);
    else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
      fs.utimesSync(destinationPath, new Date(0), new Date(0));
    }
  }
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });
copyTree(root, stagingDirectory);
fs.rmSync(archivePath, { force: true });

const releaseFiles = [];
function collectFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(absolutePath);
    else if (entry.isFile()) releaseFiles.push(path.relative(stagingDirectory, absolutePath));
  }
}
collectFiles(stagingDirectory);
releaseFiles.sort();

execFileSync('zip', ['-q', '-X', archivePath, ...releaseFiles], {
  cwd: stagingDirectory,
  stdio: 'inherit',
});

fs.rmSync(stagingDirectory, { recursive: true, force: true });
console.log(`Created ${path.relative(root, archivePath)}`);
