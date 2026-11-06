// Runs the service/lib unit tests under plain `node --test` WITHOUT jest-expo
// (still a known gap — see the headers of src/services/__tests__/*.test.ts).
// Node's bare ESM loader can't run those tests directly: they use TypeScript
// parameter properties (`constructor(public readonly x)`), and the sources use
// extensionless / directory imports ('./rbac') that only Metro resolves.
//
// This script: transpiles every .ts under src/ with the TypeScript compiler
// API into a temp dir (module ESNext), rewrites relative import specifiers
// to real `.js` / `/index.js` paths, marks the dir as ESM, and runs
// `node --test` over the transpiled *.test.js files. Only for files whose
// imports stay inside src/ (no expo/react-native) — true for models, lib,
// repository/types, services and their tests.
//
//   node scripts/run-ts-tests.mjs                 # every test file
//   node scripts/run-ts-tests.mjs PurchaseService # only files matching a substring

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-ts-tests-'));
const filter = process.argv[2];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// Native-runtime packages (firebase messaging, expo-*) can't load under plain
// node. Any bare specifier a transpiled file imports gets redirected to a
// generated stub that exports each imported name as a harmless no-op, so
// service code that merely *references* them (NotificationService) still
// loads. Tests never exercise those paths; a test that did would fail loudly
// on the stub's return value instead of silently doing nothing.
const stubExports = new Map(); // bare specifier -> Set<named import>
function stubPathFor(spec) {
  return `__stubs__/${spec.replace(/[^a-zA-Z0-9]/g, '_')}.js`;
}

function rewriteSpecifiers(code, fromFile, outFile) {
  const dir = path.dirname(fromFile);
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*(['"])([^.'"][^'"]*)\2/g, (m, names, q, spec) => {
    if (spec.startsWith('node:')) return m;
    const set = stubExports.get(spec) ?? new Set();
    for (const n of names.split(',')) {
      const name = n.trim().split(/\s+as\s+/)[0].trim();
      if (name) set.add(name);
    }
    stubExports.set(spec, set);
    const rel = path.relative(path.dirname(outFile), path.join(outDir, stubPathFor(spec))).split(path.sep).join('/');
    return `import {${names}} from ${q}${rel.startsWith('.') ? rel : './' + rel}${q}`;
  });
  return code.replace(/(from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]*)\2/g, (m, pre, q, spec) => {
    const abs = path.resolve(dir, spec);
    let resolved;
    if (spec.endsWith('.ts')) resolved = spec.replace(/\.ts$/, '.js');
    else if (fs.existsSync(abs + '.ts')) resolved = spec + '.js';
    else if (fs.existsSync(path.join(abs, 'index.ts'))) resolved = spec.replace(/\/$/, '') + '/index.js';
    else return m;
    return `${pre}${q}${resolved}${q}`;
  });
}

// The app's own sources under src/ that these tests can reach (skip anything
// that needs a native runtime).
const SKIP_DIRS = ['app', 'components', 'design-system', 'design-systems', 'features', 'hooks', 'constants', 'db', path.join('repository', 'sqlite')];
const files = walk(srcDir).filter((f) => !SKIP_DIRS.some((d) => f.startsWith(path.join(srcDir, d) + path.sep)));

for (const file of files) {
  const rel = path.relative(srcDir, file);
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
    fileName: file,
  });
  const dest = path.join(outDir, rel.replace(/\.ts$/, '.js'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, rewriteSpecifiers(outputText, file, dest));
}
for (const [spec, names] of stubExports) {
  const stubFile = path.join(outDir, stubPathFor(spec));
  fs.mkdirSync(path.dirname(stubFile), { recursive: true });
  fs.writeFileSync(stubFile, [...names].map((n) => `export const ${n} = () => ({});`).join('\n') + '\n');
}
fs.writeFileSync(path.join(outDir, 'package.json'), '{"type":"module"}');

const tests = walk(srcDir)
  .filter((f) => f.endsWith('.test.ts') && (!filter || f.includes(filter)))
  .map((f) => path.join(outDir, path.relative(srcDir, f).replace(/\.ts$/, '.js')));

if (tests.length === 0) {
  console.error('No matching test files.');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (!process.env.KEEP_TEST_BUILD) fs.rmSync(outDir, { recursive: true, force: true });
else console.log("kept:", outDir);
process.exit(result.status ?? 1);
