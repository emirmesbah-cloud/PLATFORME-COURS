// One-shot script — configure les email templates Auth en FR + branding Aurel
// Usage : node setup-email-templates.js
//   Requiert PAT en arg ou variable env SUPABASE_PAT.
'use strict';

const PAT = process.env.SUPABASE_PAT || process.argv[2];
const projectRef = 'dvrqtqghgaxhhgkoihcj';

if (!PAT) {
  console.error('Manque le PAT (sbp_...) en variable env SUPABASE_PAT ou en 1er argument');
  process.exit(1);
}

function buildHtml(opts) {
  const { heading, intro, action, buttonLabel, fallbackText, ctaUrlVar } = opts;
  return [
    '<!DOCTYPE html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="UTF-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    '<title>' + heading + '</title>',
    '</head>',
    '<body style="margin:0;padding:0;background:#FFF8F1;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#14171F;-webkit-font-smoothing:antialiased">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFF8F1;padding:32px 16px">',
    '  <tr><td align="center">',
    '    <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="background:#FFFFFF;border:1px solid #E8E0D0;border-radius:16px;max-width:560px;width:100%;overflow:hidden">',
    '      <tr><td style="padding:32px 32px 16px 32px;text-align:center;border-bottom:1px solid #F0EAE0">',
    '        <div style="display:inline-block;width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#F97316 0%,#EA580C 100%);line-height:48px;text-align:center;color:#fff;font-weight:800;font-size:22px;letter-spacing:-0.02em">A</div>',
    '        <div style="margin-top:10px;font-weight:800;font-size:18px;letter-spacing:-0.01em">Aurel <span style="font-style:italic;color:#F97316">Academy</span></div>',
    '      </td></tr>',
    '      <tr><td style="padding:32px 32px 8px 32px">',
    '        <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:800;letter-spacing:-0.01em;color:#14171F;line-height:1.3">' + heading + '</h1>',
    '        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#3A3F4D">' + intro + '</p>',
    '        <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#3A3F4D">' + action + '</p>',
    '      </td></tr>',
    '      <tr><td style="padding:0 32px 24px 32px;text-align:center">',
    '        <a href="' + ctaUrlVar + '" style="display:inline-block;background:#F97316;color:#FFFFFF;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.01em;box-shadow:0 6px 16px rgba(249,115,22,0.30)">' + buttonLabel + '</a>',
    '      </td></tr>',
    '      <tr><td style="padding:0 32px 32px 32px">',
    '        <p style="margin:0 0 8px 0;font-size:13px;color:#6B7280">' + fallbackText + '</p>',
    '        <p style="margin:0;font-size:12px;color:#9CA3AF;word-break:break-all"><a href="' + ctaUrlVar + '" style="color:#9CA3AF;text-decoration:underline">' + ctaUrlVar + '</a></p>',
    '      </td></tr>',
    '      <tr><td style="padding:20px 32px;background:#FFF8F1;border-top:1px solid #F0EAE0;text-align:center">',
    '        <p style="margin:0;font-size:12px;color:#9CA3AF">Si tu n\'es pas à l\'origine de cette demande, ignore simplement cet email.</p>',
    '        <p style="margin:8px 0 0 0;font-size:12px;color:#9CA3AF">© Aurel Academy — École d\'allemand. <a href="mailto:contact@aurel-academy.com" style="color:#9CA3AF">contact@aurel-academy.com</a></p>',
    '      </td></tr>',
    '    </table>',
    '  </td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

const templates = {
  mailer_subjects_confirmation: 'Confirme ton email — Aurel Academy',
  mailer_templates_confirmation_content: buildHtml({
    heading: 'Bienvenue 👋',
    intro: "Merci de t'être inscrit·e à Aurel Academy. Pour activer ton compte, on doit juste vérifier que ton email t'appartient.",
    action: 'Clique sur le bouton ci-dessous pour confirmer :',
    buttonLabel: 'Confirmer mon email',
    fallbackText: "Si le bouton ne fonctionne pas, copie-colle ce lien dans ton navigateur :",
    ctaUrlVar: '{{ .ConfirmationURL }}',
  }),

  mailer_subjects_recovery: 'Réinitialise ton mot de passe — Aurel Academy',
  mailer_templates_recovery_content: buildHtml({
    heading: 'Réinitialise ton mot de passe',
    intro: 'Tu as demandé à réinitialiser le mot de passe de ton compte Aurel Academy.',
    action: 'Clique sur le bouton ci-dessous pour choisir un nouveau mot de passe :',
    buttonLabel: 'Choisir un nouveau mot de passe',
    fallbackText: 'Si le bouton ne fonctionne pas, copie-colle ce lien dans ton navigateur :',
    ctaUrlVar: '{{ .ConfirmationURL }}',
  }),

  mailer_subjects_magic_link: 'Connecte-toi à Aurel Academy',
  mailer_templates_magic_link_content: buildHtml({
    heading: 'Connecte-toi en un clic',
    intro: "Tu as demandé un lien de connexion direct à Aurel Academy.",
    action: 'Clique sur le bouton ci-dessous pour accéder à ton espace :',
    buttonLabel: 'Me connecter',
    fallbackText: 'Si le bouton ne fonctionne pas, copie-colle ce lien dans ton navigateur :',
    ctaUrlVar: '{{ .ConfirmationURL }}',
  }),

  mailer_subjects_email_change: 'Confirme ton nouvel email — Aurel Academy',
  mailer_templates_email_change_content: buildHtml({
    heading: 'Confirme ton nouvel email',
    intro: "Tu as demandé à changer l'email associé à ton compte Aurel Academy.",
    action: 'Clique sur le bouton ci-dessous pour confirmer ce nouvel email :',
    buttonLabel: 'Confirmer le nouvel email',
    fallbackText: 'Si le bouton ne fonctionne pas, copie-colle ce lien dans ton navigateur :',
    ctaUrlVar: '{{ .ConfirmationURL }}',
  }),

  mailer_subjects_invite: 'Invitation à rejoindre Aurel Academy',
  mailer_templates_invite_content: buildHtml({
    heading: "Tu es invité·e sur Aurel Academy",
    intro: "Aurel t'invite à rejoindre la plateforme.",
    action: 'Clique sur le bouton ci-dessous pour activer ton compte :',
    buttonLabel: "Accepter l'invitation",
    fallbackText: 'Si le bouton ne fonctionne pas, copie-colle ce lien dans ton navigateur :',
    ctaUrlVar: '{{ .ConfirmationURL }}',
  }),

  mailer_subjects_reauthentication: 'Vérifie ton identité — Aurel Academy',
};

(async () => {
  console.log('→ Update email templates Auth (FR + branding Aurel)...');
  const r = await fetch('https://api.supabase.com/v1/projects/' + projectRef + '/config/auth', {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + PAT, 'Content-Type': 'application/json' },
    body: JSON.stringify(templates),
  });
  console.log('  HTTP', r.status);
  if (!r.ok) {
    console.log('  ❌', await r.text());
    return;
  }
  console.log('  ✅ Templates appliqués');
  console.log('');

  const after = await fetch('https://api.supabase.com/v1/projects/' + projectRef + '/config/auth', {
    headers: { 'Authorization': 'Bearer ' + PAT },
  }).then(x => x.json());
  console.log('→ Vérification :');
  console.log('  Subject confirm:  ' + (after.mailer_subjects_confirmation || '(vide)'));
  console.log('  Subject recovery: ' + (after.mailer_subjects_recovery || '(vide)'));
  console.log('  Subject magic:    ' + (after.mailer_subjects_magic_link || '(vide)'));
  console.log('  Subject change:   ' + (after.mailer_subjects_email_change || '(vide)'));
  console.log('  Subject invite:   ' + (after.mailer_subjects_invite || '(vide)'));
  console.log('  Recovery HTML:    ' + (after.mailer_templates_recovery_content ? '✅ ' + after.mailer_templates_recovery_content.length + ' chars' : '❌'));
})();
