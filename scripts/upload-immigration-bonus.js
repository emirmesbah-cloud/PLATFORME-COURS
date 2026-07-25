'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

function readEnv(filePath) {
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function main() {
  const env = readEnv(path.join(__dirname, '.env'));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const sourceDir = path.resolve(
    __dirname,
    '..',
    'app',
    'public',
    'content',
    'immigration',
    'bonus',
  );
  const files = fs.readdirSync(sourceDir)
    .filter((name) => name.toLowerCase().endsWith('.pdf'))
    .sort();
  if (files.length !== 7) {
    throw new Error(`Expected 7 Immigration PDFs, found ${files.length}.`);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const uploaded = [];

  for (const file of files) {
    const bytes = fs.readFileSync(path.join(sourceDir, file));
    const objectPath = `immigration/${file}`;
    const { error } = await supabase.storage
      .from('bonus-resources')
      .upload(objectPath, bytes, {
        upsert: true,
        contentType: 'application/pdf',
        cacheControl: '3600',
      });
    if (error) throw new Error(`${objectPath}: ${error.message}`);
    uploaded.push(objectPath);
  }

  console.log(JSON.stringify({ ok: true, uploaded }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
