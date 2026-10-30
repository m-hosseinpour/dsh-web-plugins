#!/usr/bin/env node
/**
 * Structural checks for every plugin in plugins/. DSH loads a bundle through
 * three names that must agree — the package name, the row inserted by
 * cordis.patch.yml, and the id the Client module registers with — so a typo in
 * one of them only shows up as a dead plugin in the running app. Everything
 * here is checked from the files alone, with no Harness install required.
 *
 * Run from anywhere: `node scripts/validate.mjs`.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');
const failures = [];

function fail(where, message) {
  failures.push(`${where}: ${message}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path, where) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    fail(where, `missing ${path.slice(root.length + 1)}`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(where, `invalid JSON in ${path.slice(root.length + 1)}: ${error.message}`);
    return null;
  }
}

const rootReadme = await readFile(join(root, 'README.md'), 'utf8');
const entries = await readdir(pluginsDir, { withFileTypes: true });
const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

if (dirs.length === 0) {
  fail('plugins', 'no plugin directories found');
}

for (const dir of dirs) {
  const where = `plugins/${dir}`;
  const base = join(pluginsDir, dir);
  const pkg = await readJson(join(base, 'package.json'), where);
  if (!pkg) continue;

  for (const field of ['name', 'version', 'description', 'license', 'exports', 'files']) {
    if (!pkg[field] || (typeof pkg[field] === 'string' && !pkg[field].trim())) {
      fail(where, `package.json is missing "${field}"`);
    }
  }
  if (pkg.license !== 'MIT') fail(where, `license should be MIT, found ${pkg.license}`);
  if (!pkg.engines?.dsh) fail(where, 'package.json has no "engines.dsh" range');
  if (pkg.private !== true) fail(where, 'package.json should stay "private": true (these are not npm packages)');

  const patchPath = pkg.dsh?.bundle?.patch;
  if (patchPath !== './cordis.patch.yml') {
    fail(where, `expected dsh.bundle.patch "./cordis.patch.yml", found ${patchPath}`);
  }
  if (pkg.dsh?.client?.platform !== 'web') {
    fail(where, `expected dsh.client.platform "web", found ${pkg.dsh?.client?.platform}`);
  }

  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'locale/en.json', 'locale/fa.json']) {
    if (!(await exists(join(base, required)))) fail(where, `missing ${required}`);
  }

  // The package, the patch row and the Client module must all use the same name.
  const patch = await readFile(join(base, 'cordis.patch.yml'), 'utf8').catch(() => '');
  const rowIds = [...patch.matchAll(/^\s{4}- id: (.+)$/gm)].map((match) => match[1].trim());
  const rowNames = [...patch.matchAll(/^\s{6}name: ['"]?([^'"\n]+?)['"]?$/gm)].map((match) => match[1].trim());
  if (rowIds.length !== 1) fail(where, `cordis.patch.yml should insert exactly one row, found ${rowIds.length}`);
  if (rowIds[0] !== dir) fail(where, `patch row id "${rowIds[0]}" should match the directory name "${dir}"`);
  if (!rowNames.includes(pkg.name)) fail(where, `cordis.patch.yml row name should be "${pkg.name}", found ${rowNames.join(', ') || 'none'}`);

  const client = await readFile(join(base, 'client.js'), 'utf8').catch(() => '');
  const clientId = client.match(/__ModuleLoader__\.load\(\{[\s\S]*?\bid:\s*'([^']+)'/)?.[1];
  if (clientId !== pkg.name) {
    fail(where, `client.js registers as "${clientId ?? 'nothing'}", expected "${pkg.name}"`);
  }

  for (const locale of ['en', 'fa']) {
    const text = await readFile(join(base, 'locale', `${locale}.json`), 'utf8').catch(() => null);
    if (text === null) continue;
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      fail(where, `locale/${locale}.json is invalid JSON: ${error.message}`);
      continue;
    }
    if (!data.meta?.title || !data.meta?.description) {
      fail(where, `locale/${locale}.json needs meta.title and meta.description`);
    }
  }

  const readme = await readFile(join(base, 'README.md'), 'utf8').catch(() => '');
  for (const [, image] of readme.matchAll(/!\[[^\]]*\]\((docs\/[^)\s]+)\)/g)) {
    if (!(await exists(join(base, image)))) fail(where, `README references missing ${image}`);
  }

  const listed = (pkg.files ?? []).filter((entry) => !entry.includes('*'));
  for (const entry of listed) {
    if (!(await exists(join(base, entry)))) fail(where, `package.json "files" lists missing ${entry}`);
  }

  if (!rootReadme.includes(`plugins/${dir}`)) {
    fail('README.md', `does not link the plugin "plugins/${dir}"`);
  }
}

if (failures.length > 0) {
  console.error(`Validation failed with ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Validated ${dirs.length} plugin(s): ${dirs.join(', ')}.`);
