// ============================================================================
// Aurel Academy — Templates HTML pour les 5 emails transactionnels
// Utilisés par send-email et check-inactive-users.
// Style inline (les clients mail ne comprennent pas tous les CSS externes).
// ============================================================================

export interface TemplateVars {
  first_name?: string;
  app_url?: string;          // ex : https://app.aurel-academy.com
  whatsapp_url?: string;     // ex : https://wa.me/213555290826
  next_lesson_number?: number;
  next_lesson_title?: string;
  percentage_complete?: number;
  certificate_number?: string;
  feedback_url?: string;
  unsubscribe_url?: string;
}

const APP_URL_DEFAULT      = 'https://app.aurel-academy.com';
const WHATSAPP_URL_DEFAULT = 'https://wa.me/213555290826';

const ORANGE = '#F97316';
const TEAL   = '#0D7377';
const INK    = '#1A1A1A';

// SHERLOCK R3 fix : `vars.first_name` etc. flowent directement dans le HTML.
// Un user qui s'inscrit avec `first_name='</p><a href="https://evil">click</a>'`
// peut injecter du HTML dans son propre email (self-phish + reputation damage).
// On escape tout ce qui vient de vars.* avant interpolation.
//
// `esc()` accepte string|number|undefined → HTML-safe string.
// Les URLs sont passées telles quelles (déjà validées côté caller, ou
// env-controlled).
function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell(content: string, vars: TemplateVars = {}): string {
  // SHERLOCK R3 / GDPR : `unsubscribe_url` est passé par check-inactive-users
  // (et tout futur sender d'emails marketing) avec un token unique par user.
  // Fallback /profil pour les emails transactionnels (welcome, certificat —
  // pas de droit de désinscription pour ces types). On ESCAPE l'URL au cas
  // où elle viendrait d'un input non sanitized.
  const unsub = esc(vars.unsubscribe_url ?? `${vars.app_url ?? APP_URL_DEFAULT}/profil`);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aurel Academy</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:Calibri,Arial,sans-serif;color:${INK};line-height:1.5;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8FAFC;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;">
        <tr><td style="background:#0A1628;padding:28px 32px;text-align:center;">
          <table cellpadding="0" cellspacing="0" border="0" align="center"><tr>
            <td style="background:${ORANGE};border-radius:24px;width:48px;height:48px;color:#FFFFFF;font-family:Georgia,serif;font-style:italic;font-size:30px;font-weight:bold;text-align:center;line-height:48px;">A</td>
            <td style="color:#FFFFFF;font-weight:600;font-size:18px;letter-spacing:2px;padding-left:14px;">AUREL <span style="font-family:Georgia,serif;font-style:italic;font-weight:normal;letter-spacing:0;">Academy</span></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:32px;color:${INK};font-size:15px;">${content}</td></tr>
        <tr><td style="background:#F8FAFC;padding:18px 32px;text-align:center;color:#94A3B8;font-size:11px;border-top:1px solid #E2E8F0;">
          Aurel Academy · <a href="${WHATSAPP_URL_DEFAULT}" style="color:#94A3B8;">WhatsApp +213 555 290 826</a> · <a href="${unsub}" style="color:#94A3B8;">Se désinscrire</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function btn(href: string, text: string, color: 'orange' | 'teal' = 'orange'): string {
  const bg = color === 'teal' ? TEAL : ORANGE;
  // SHERLOCK R13 — B7: HTML-escape and protocol-restrict href so call sites
  // that pass user-controlled URLs (or simply a typo) can't inject
  // `javascript:` / `data:` / `vbscript:` into the email body. Only http(s)
  // is accepted; anything else collapses to a safe '#'.
  const safeHref = /^https?:\/\//i.test(href) ? esc(href) : '#';
  return `<table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:24px auto;">
<tr><td style="background:${bg};border-radius:8px;">
<a href="${safeHref}" style="display:inline-block;padding:14px 28px;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:15px;">${esc(text)}</a>
</td></tr></table>`;
}

// ─── Template 1 : Welcome ───────────────────────────────────────────────────
export function welcomeEmail(vars: TemplateVars): { subject: string; html: string; text: string } {
  const name = vars.first_name ?? 'à toi';
  const url  = vars.app_url ?? APP_URL_DEFAULT;
  const wa   = vars.whatsapp_url ?? WHATSAPP_URL_DEFAULT;
  const subject = '🎓 Bienvenue chez Aurel Academy — tes 18 leçons t\'attendent';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:24px;color:${INK};">Bienvenue ${esc(name)} !</h1>
    <p style="margin:0 0 16px;">Ton accès à la formation <strong>Deutsch für Pflegekräfte</strong> est activé. Tu peux dès maintenant attaquer tes 18 leçons et débloquer tes 7 ressources premium :</p>
    <ul style="padding-left:20px;color:#475569;font-size:14px;">
      <li>📚 18 leçons vidéo (~4h30)</li>
      <li>📖 Glossaire 150 termes médicaux trilingue</li>
      <li>📄 4 templates CV + lettres de motivation Allemagne</li>
      <li>🎯 Guide Anerkennung + Méthode prospection 30 chaînes</li>
    </ul>
    ${btn(url + '/dashboard', '🚀 Accéder à ma formation')}
    <p style="margin:24px 0 0;color:#475569;font-size:13px;">Une question ? Réponds à cet email ou écris-moi sur <a href="${esc(wa)}" style="color:${ORANGE};">WhatsApp</a>.</p>
    <p style="margin:6px 0 0;color:#1A1A1A;font-style:italic;">— Aurel</p>
  `, vars);
  const text = `Bienvenue ${name} ! Ton accès Aurel Academy est activé. ${url}/dashboard`;
  return { subject, html, text };
}

// ─── Template 2 : Rappel inactivité 7 jours ────────────────────────────────
export function reminderInactiveEmail(vars: TemplateVars): { subject: string; html: string; text: string } {
  const name = vars.first_name ?? 'l\'ami';
  const url  = vars.app_url ?? APP_URL_DEFAULT;
  const lessonText = vars.next_lesson_number
    ? `<strong>leçon ${esc(vars.next_lesson_number)}${vars.next_lesson_title ? ` — « ${esc(vars.next_lesson_title)} »` : ''}</strong>`
    : 'tes leçons';
  const subject = `${name}, où en es-tu dans ta formation Pflege ?`;
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:${INK};">Bonjour ${esc(name)},</h1>
    <p>Ça fait <strong>une semaine</strong> qu'on ne t'a pas vu sur la plateforme. Tu en es à <strong>${esc(vars.percentage_complete ?? 0)}%</strong> de ta formation.</p>
    <p>L'Allemagne, la Pflegeheim, le contrat — tout ça commence par te remettre devant ${lessonText}.</p>
    ${btn(url + '/lecons', '👉 Reprendre ma formation')}
    <p style="margin:24px 0 0;color:#475569;font-size:13px;">Pas de pression. Mais 20 minutes par jour suffisent pour finir avant la fin du mois.</p>
    <p style="margin:6px 0 0;color:#1A1A1A;font-style:italic;">— Aurel</p>
  `, vars);
  const text = `${name}, on ne t'a pas vu depuis 7 jours. Reprends ta formation : ${url}/lecons`;
  return { subject, html, text };
}

// ─── Template 3 : Cap des 50% ───────────────────────────────────────────────
export function milestone50Email(vars: TemplateVars): { subject: string; html: string; text: string } {
  const name = vars.first_name ?? 'à toi';
  const url  = vars.app_url ?? APP_URL_DEFAULT;
  const subject = '🔥 Tu as franchi la moitié du chemin';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:24px;color:${ORANGE};">50% atteints, ${esc(name)} 🔥</h1>
    <p>Tu viens de passer la moitié de la formation Deutsch für Pflegekräfte. Mention spéciale, c'est là que la majorité abandonne.</p>
    <p>Maintenant attaque la deuxième moitié — c'est là que les modules Entretien et Anerkennung font la différence.</p>
    <p style="margin:16px 0;color:#475569;font-size:14px;"><strong>Conseil pratique :</strong> exploite tes <strong>7 bonus</strong> en parallèle. Le glossaire 150 termes et le guide Anerkennung sont LE truc qui te démarque en entretien.</p>
    ${btn(url + '/lecons', '👉 Continuer ma formation')}
    ${btn(url + '/bonus', 'Voir mes 7 bonus', 'teal')}
    <p style="margin:24px 0 0;color:#1A1A1A;font-style:italic;">— Aurel</p>
  `, vars);
  const text = `${name}, tu as franchi 50% de ta formation. Continue : ${url}/lecons`;
  return { subject, html, text };
}

// ─── Template 4 : Certificat émis ──────────────────────────────────────────
export function certificateIssuedEmail(vars: TemplateVars): { subject: string; html: string; text: string } {
  const name = vars.first_name ?? 'à toi';
  const url  = vars.app_url ?? APP_URL_DEFAULT;
  const num  = vars.certificate_number ?? '';
  const subject = '🏆 Ton certificat Aurel Academy est prêt';
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:24px;color:${ORANGE};">Félicitations ${esc(name)} 🏆</h1>
    <p>Tu as terminé l'intégralité de la formation <strong>Deutsch für Pflegekräfte</strong>. Tu fais désormais partie des 18 leçons + 7 bonus complets.</p>
    <p style="background:#FFEDD5;padding:14px;border-radius:8px;color:#7A4A1A;font-size:14px;">
      <strong>Numéro de certificat :</strong> <code style="font-family:monospace;">${esc(num)}</code>
    </p>
    ${btn(url + '/certificat', '📄 Télécharger mon certificat')}
    <h3 style="margin:24px 0 6px;color:${INK};font-size:16px;">Et maintenant ?</h3>
    <ol style="padding-left:20px;color:#475569;font-size:14px;line-height:1.7;">
      <li>Imprime ton certificat (utile pour les entretiens en ligne avec recruteurs allemands).</li>
      <li>Active ton dossier Anerkennung dès cette semaine — chaque mois compte.</li>
      <li>Lance ta prospection avec la méthode (30 chaînes employeurs).</li>
      <li><strong>Donne ton avis</strong> — ça aide les futurs apprenants à choisir Aurel Academy.</li>
    </ol>
    ${btn(url + '/feedback', '💬 Donner mon avis', 'teal')}
    <p style="margin:24px 0 0;color:#1A1A1A;font-style:italic;">— Aurel</p>
  `, vars);
  const text = `Félicitations ${name} ! Ton certificat ${num} est prêt : ${url}/certificat`;
  return { subject, html, text };
}

// ─── Template 5 : Demande feedback ─────────────────────────────────────────
export function feedbackRequestEmail(vars: TemplateVars): { subject: string; html: string; text: string } {
  const name = vars.first_name ?? 'à toi';
  const url  = vars.app_url ?? APP_URL_DEFAULT;
  const subject = `Une dernière chose ${name} avant de partir conquérir l'Allemagne 🇩🇪`;
  const html = shell(`
    <h1 style="margin:0 0 12px;font-size:22px;color:${INK};">Une faveur, ${esc(name)} ?</h1>
    <p>Tu as terminé la formation. Si tu as 2 minutes, ton retour est précieux pour deux raisons :</p>
    <ol style="padding-left:20px;color:#475569;font-size:14px;line-height:1.7;">
      <li><strong>Pour les futurs apprenants algériens</strong> qui hésitent à se lancer — ton témoignage les rassure.</li>
      <li><strong>Pour moi</strong> — pour améliorer la formation V2 et rester aligné sur les vrais besoins terrain.</li>
    </ol>
    ${btn(url + '/feedback', '💬 Donner mon avis (2 min)', 'teal')}
    <p style="margin:24px 0 0;color:#475569;font-size:13px;">Tu peux choisir de garder ton avis privé ou de le rendre public sur la landing — comme tu préfères.</p>
    <p style="margin:6px 0 0;color:#1A1A1A;font-style:italic;">— Aurel</p>
  `, vars);
  const text = `${name}, ton avis sur Aurel Academy ? ${url}/feedback`;
  return { subject, html, text };
}

// ─── Selector ──────────────────────────────────────────────────────────────
export function buildEmail(type: string, vars: TemplateVars) {
  switch (type) {
    case 'welcome':            return welcomeEmail(vars);
    case 'reminder_inactive':  return reminderInactiveEmail(vars);
    case 'milestone_50':       return milestone50Email(vars);
    case 'certificate_issued': return certificateIssuedEmail(vars);
    case 'feedback_request':   return feedbackRequestEmail(vars);
    default: return null;
  }
}
