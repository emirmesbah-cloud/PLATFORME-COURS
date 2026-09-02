import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(resolve(here, relative), 'utf8');

test('bundle freshness check stays active under a service worker', () => {
  const source = read('../src/lib/version-check.ts');
  assert.match(source, /normalizedVersion\(__BUILD_VERSION__\)/);
  assert.match(source, /serverVersion !== runningVersion/);
  assert.doesNotMatch(source, /navigator\.serviceWorker\.controller\) return/);
  assert.match(source, /registration\.unregister\(\)/);
});

test('PWA navigation uses NetworkFirst rather than a precached app shell', () => {
  const config = read('../vite.config.ts');
  assert.match(config, /handler: 'NetworkFirst'/);
  assert.match(config, /navigateFallback: null/);
});

test('manual Safari recovery route preserves auth storage', () => {
  const recovery = read('../public/api/refresh.js');
  assert.match(recovery, /registration\.unregister\(\)/);
  assert.match(recovery, /window\.caches\.delete/);
  assert.match(recovery, /window\.location\.replace\('\/\?_aurel_refresh='/);
  assert.doesNotMatch(recovery, /localStorage|sessionStorage/);
});
