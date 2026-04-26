#!/usr/bin/env node
// ============================================================================
// Aurel Academy — Génération de codes d'activation
//
// Usage :
//   node scripts/generate-codes.js --tier=autonome --count=10
//   node scripts/generate-codes.js --tier=accompagne --count=5 --notes="Promo lancement"
//
// Format des codes :
//   - Autonome   : AU-XXXX  (4 chiffres random, ex : AU-7831)
//   - Accompagné : AC-XXXX
//
// Variables d'environnement requises (fichier .env à la racine de scripts/) :
//   SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=eyJ...
//
// Sortie : codes écrits en console (à copier/coller dans WhatsApp)
//          + insertion dans la table activation_codes via service_role.
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ----------------------------------------------------------------------------
// Chargement minimaliste de .env (pas de dépendance dotenv pour rester simple)
// ----------------------------------------------------------------------------
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) return;
    const key = m[1];
    let value = m[2];
    // Strip optional surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  });
}
loadEnv();

// ----------------------------------------------------------------------------
// CLI args (--key=value)
// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([a-zA-Z0-9_-]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const args  = parseArgs(process.argv);
const tier  = (args.tier || '').toLowerCase();
const count = parseInt(args.count || '0', 10);
const notes = args.notes || null;

if (!['autonome', 'accompagne'].includes(tier)) {
  console.error('ERR : --tier doit être "autonome" ou "accompagne".');
  process.exit(1);
}
if (!Number.isInteger(count) || count <= 0 || count > 500) {
  console.error('ERR : --count doit être un entier entre 1 et 500.');
  process.exit(1);
}

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERR : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis');
  console.error('       (variables d\'env ou fichier scripts/.env).');
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Génération de codes uniques
// ----------------------------------------------------------------------------
const PREFIX = tier === 'autonome' ? 'AU' : 'AC';

function genCode() {
  // 4 chiffres random — 10000 combinaisons par préfixe.
  // Pour scaler au-delà, augmenter à 5+ chiffres.
  const n = Math.floor(1000 + Math.random() * 9000);
  return PREFIX + '-' + n;
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const generated = new Set();
  const rows = [];
  let attempts = 0;
  const MAX_ATTEMPTS = count * 20;

  while (rows.length < count && attempts < MAX_ATTEMPTS) {
    attempts++;
    const code = genCode();
    if (generated.has(code)) continue;

    // Vérification d'existence en DB (collision avec un code déjà généré
    // dans un précédent batch). Si collision, on retente.
    const { data, error } = await supabase
      .from('activation_codes')
      .select('id')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      console.error('ERR DB lookup :', error.message);
      process.exit(1);
    }
    if (data) continue; // collision, on retente

    generated.add(code);
    rows.push({ code, tier, notes });
  }

  if (rows.length < count) {
    console.error('ERR : impossible de générer ' + count + ' codes uniques après '
      + attempts + ' tentatives. L\'espace de codes ' + PREFIX + '-XXXX est saturé.');
    process.exit(1);
  }

  const { error: insertErr } = await supabase
    .from('activation_codes')
    .insert(rows);

  if (insertErr) {
    console.error('ERR INSERT :', insertErr.message);
    process.exit(1);
  }

  // ----------------------------------------------------------------------
  // Affichage formaté pour copier/coller dans WhatsApp
  // ----------------------------------------------------------------------
  const tierLabel = tier === 'autonome' ? 'Autonome (12 900 DA)' : 'Accompagné (42 800 DA)';
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ' + count + ' code(s) ' + tierLabel + ' généré(s)');
  if (notes) console.log('  Notes : ' + notes);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  rows.forEach((r) => console.log('  ' + r.code));
  console.log('');
  console.log('Activation : https://app.aurel-academy.com/activate');
  console.log('');
}

main().catch((err) => {
  console.error('UNCAUGHT :', err);
  process.exit(1);
});
