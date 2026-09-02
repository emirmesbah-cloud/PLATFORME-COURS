// Aurel Academy — admin-managed closer accounts.
//
// Actions:
//   provision         Admin only. Creates the pre-approved closer account with
//                     a unique random secret, links staff/profile, and sends
//                     a one-time password setup link.
//   password-changed  Authenticated closer. Sends an immediate security notice.
//
// There is deliberately no public self-registration or "first connection"
// flow. A closer can sign in only after an admin has created their staff entry.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { reportError } from '../_shared/sentry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = 'https://app.aurel-academy.com';
const ALLOWED_ORIGINS = new Set([APP_URL, 'http://localhost:5173', 'http://localhost:4173']);

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : APP_URL,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function randomBootstrapPassword(): string {
  // Never shared with the closer. It only makes the account unusable until the
  // one-time recovery link has been opened and a personal password is chosen.
  return `${crypto.randomUUID()}-${crypto.randomUUID()}-Aa1!`;
}

async function sendEmail(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      await reportError(new Error(`send-email returned ${response.status}`), {
        function: 'closer-access', extra: { step: 'send_email', status: response.status },
      });
    }
    return response.ok;
  } catch (error) {
    await reportError(error, { function: 'closer-access', extra: { step: 'send_email' } });
    return false;
  }
}

async function sendAccessEmail(
  admin: ReturnType<typeof createClient>,
  userId: string,
  email: string,
  firstNameRaw: string,
): Promise<boolean> {
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: `${APP_URL}/reset-password` },
  });
  const actionLink = linkData?.properties?.action_link;
  if (linkError || !actionLink) {
    await reportError(linkError ?? new Error('Recovery link missing'), {
      function: 'closer-access', extra: { step: 'generate_access_link', user_id: userId },
    });
    return false;
  }

  const firstName = esc(firstNameRaw);
  const safeLink = esc(actionLink);
  return sendEmail({
    email_type: 'custom',
    to: email,
    user_id: userId,
    subject: 'Bienvenue dans ton espace Closer Aurel Academy',
    html: `<p>Bonjour ${firstName},</p><p>Ton accès Closer Aurel Academy a été créé par un administrateur.</p><p><a href="${safeLink}">Choisir mon mot de passe et activer mon accès</a></p><p>Ce lien est personnel et à usage unique. Ne le partage pas.</p><p>Connexion après activation : <a href="${APP_URL}/closer">${APP_URL}/closer</a></p>`,
    text: `Bonjour ${firstNameRaw},\n\nTon accès Closer Aurel Academy a été créé. Choisis ton mot de passe avec ce lien personnel à usage unique :\n${actionLink}\n\nConnexion après activation : ${APP_URL}/closer`,
  });
}

serve(async (req) => {
  const headers = cors(req.headers.get('origin'));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  const caller = callerData?.user;
  if (callerError || !caller) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);

  const action = String(payload.action ?? '');
  if (action === 'password-changed') {
    const { data: profile } = await admin
      .from('profiles')
      .select('email, first_name, staff_role')
      .eq('id', caller.id)
      .maybeSingle();
    if (!profile || profile.staff_role !== 'closer') {
      return json({ ok: true, email_sent: false });
    }
    const firstName = esc(profile.first_name || '');
    const sent = await sendEmail({
      email_type: 'custom',
      to: profile.email,
      user_id: caller.id,
      subject: 'Ton mot de passe Aurel Academy a été modifié',
      html: `<p>Bonjour ${firstName},</p><p>Le mot de passe de ton espace Closer Aurel Academy vient d’être modifié.</p><p>Si tu n’es pas à l’origine de ce changement, contacte immédiatement un administrateur.</p><p><a href="${APP_URL}/closer">Ouvrir l’espace Closer</a></p>`,
      text: `Bonjour ${profile.first_name || ''},\n\nLe mot de passe de ton espace Closer Aurel Academy vient d’être modifié.\nSi tu n’es pas à l’origine de ce changement, contacte immédiatement un administrateur.\n\n${APP_URL}/closer`,
    });
    return json({ ok: true, email_sent: sent });
  }

  if (action !== 'provision') return json({ ok: false, error: 'UNKNOWN_ACTION' }, 400);

  const { data: callerProfile } = await admin.from('profiles').select('is_admin').eq('id', caller.id).maybeSingle();
  if (!callerProfile?.is_admin) return json({ ok: false, error: 'FORBIDDEN' }, 403);

  const email = String(payload.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'EMAIL_INVALID' }, 422);
  }

  const { data: staff, error: staffError } = await admin
    .from('staff_members')
    .select('id, first_name, last_name, whatsapp, is_active, permissions, auth_user_id')
    .ilike('email', email)
    .maybeSingle();
  if (staffError || !staff || staff.is_active !== true) {
    return json({ ok: false, error: 'CLOSER_NOT_APPROVED' }, 409);
  }

  if (staff.auth_user_id) {
    if (payload.send_access_email !== true) {
      return json({ ok: true, created: false, email_sent: false });
    }
    const sent = await sendAccessEmail(admin, staff.auth_user_id, email, staff.first_name || '');
    return json({ ok: true, created: false, email_sent: sent });
  }

  const { data: existingProfile } = await admin.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (existingProfile?.id) {
    await admin.from('staff_members').update({ auth_user_id: existingProfile.id, updated_at: new Date().toISOString() }).eq('id', staff.id);
    const sent = payload.send_access_email === true
      ? await sendAccessEmail(admin, existingProfile.id, email, staff.first_name || '')
      : false;
    return json({ ok: true, created: false, email_sent: sent });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: randomBootstrapPassword(),
    email_confirm: true,
    user_metadata: {
      first_name: staff.first_name ?? '',
      last_name: staff.last_name ?? '',
      whatsapp: staff.whatsapp ?? '',
      staff_role: 'closer',
    },
  });
  if (createError || !created?.user) {
    await reportError(createError ?? new Error('createUser returned no user'), {
      function: 'closer-access', extra: { step: 'create_user' },
    });
    return json({ ok: false, error: 'ACCOUNT_CREATE_FAILED' }, 500);
  }

  const uid = created.user.id;
  const { error: profileError } = await admin.from('profiles').insert({
    id: uid,
    email,
    first_name: staff.first_name ?? '',
    last_name: staff.last_name ?? '',
    whatsapp: staff.whatsapp ?? '',
    tier: 'accompagne',
    staff_role: 'closer',
    staff_permissions: staff.permissions ?? ['prospects'],
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(uid).catch(() => {});
    await reportError(profileError, { function: 'closer-access', extra: { step: 'profile_insert' } });
    return json({ ok: false, error: 'PROFILE_CREATE_FAILED' }, 500);
  }

  await admin.from('staff_members').update({ auth_user_id: uid, updated_at: new Date().toISOString() }).eq('id', staff.id);

  const sent = await sendAccessEmail(admin, uid, email, staff.first_name || '');

  return json({ ok: true, created: true, email_sent: sent });
});
