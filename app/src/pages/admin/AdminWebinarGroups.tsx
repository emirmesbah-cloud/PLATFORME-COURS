import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink, Loader2, MessageCircle, Plus, RotateCw, Save, ShieldCheck, LifeBuoy, Trash2, Pencil, Check, X,
} from 'lucide-react';
import {
  fetchWebinarGroups, fetchRotationOverview, queryKeys, updateWebinarGroup,
  rpcAddRotationLinks, rpcStartNewRotationLot, rpcSetEmergencyLink, rpcRemoveRotationLink, rpcRenameRotationLink,
} from '@/lib/queries';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { ProgressBar } from '@/components/ui/Progress';
import { formatDateTime } from '@/lib/utils';
import type {
  WebinarGroup, WebinarGroupSlug, RotationFunnel, RotationLink,
} from '@/lib/types';

const GROUP_CAP = 1000;

const GROUP_META: Record<WebinarGroupSlug, { title: string; pageUrl: string; description: string }> = {
  immigration: {
    title: 'Webinar Immigration',
    pageUrl: 'https://aurel-academy.com/webinar/',
    description: 'Rotation des groupes WhatsApp du webinar Immigration Allemagne.',
  },
  pflege: {
    title: 'Webinar Pflege',
    pageUrl: 'https://aurel-academy.com/pflege/webinar/',
    description: "Lien utilisé après l'inscription au webinar Pflege.",
  },
  tiktok: {
    title: 'Campagne TikTok',
    pageUrl: 'https://aurel-academy.com/webinartk/',
    description: 'Rotation des groupes WhatsApp de la landing page TikTok.',
  },
};

// Accepts EITHER a bare group code ("just paste the code") OR a full invite
// link. For a link we take the LAST path segment, so both the current
// chat.whatsapp.com/<code> and the legacy chat.whatsapp.com/invite/<code> forms
// work. Returns the validated code, or null.
function parseWhatsAppGroupCode(value: string): string | null {
  const raw = value.trim();
  const CODE = /^[A-Za-z0-9_-]{10,100}$/;

  if (CODE.test(raw)) return raw; // bare code pasted directly

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'chat.whatsapp.com') return null;
    const segs = url.pathname.split('/').filter(Boolean);
    const code = segs[segs.length - 1] ?? '';
    return CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

// Split a textarea/input into codes, validating each. Accepts one per line, or
// comma/space separated. Returns validated codes (deduped) + the raw tokens that
// failed to parse, so the UI can tell the admin exactly what to fix.
function parseCodeList(raw: string): { codes: string[]; invalid: string[] } {
  const tokens = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const codes: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    const c = parseWhatsAppGroupCode(t);
    if (c) codes.push(c);
    else invalid.push(t);
  }
  return { codes: Array.from(new Set(codes)), invalid };
}

export function AdminWebinarGroups() {
  const groupsQ = useQuery({
    queryKey: queryKeys.adminWebinarGroups,
    queryFn: fetchWebinarGroups,
  });

  const pflege = (groupsQ.data ?? []).find((g) => g.slug === 'pflege');

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <MessageCircle className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Webinars</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink">Groupes WhatsApp</h1>
        <p className="mt-1 max-w-3xl text-slate-600">
          Immigration et TikTok répartissent les inscrits sur plusieurs groupes (rotation). Pflege utilise un seul lien.
        </p>
      </header>

      <div className="flex items-start gap-3 rounded-card border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-none" />
        <p>Cette page est réservée aux administrateurs. Chaque modification est enregistrée dans le journal d'audit.</p>
      </div>

      {groupsQ.isLoading && (
        <div className="card-padded flex items-center gap-3 text-sm text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-aurel-orange" /> Chargement des groupes…
        </div>
      )}

      {groupsQ.isError && (
        <div className="card-padded border-red-200 bg-red-50">
          <p className="font-semibold text-red-800">Impossible de charger les groupes.</p>
          <p className="mt-1 text-sm text-red-700">Vérifie la connexion puis réessaie.</p>
          <button type="button" className="btn-outline mt-4" onClick={() => groupsQ.refetch()}>Réessayer</button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <RotationManager funnel="immigration" />
        <RotationManager funnel="tiktok" />
        {pflege && <GroupCard group={pflege} />}
      </div>
    </div>
  );
}

// ── PFLEGE : single-link editor, unchanged ──────────────────────────────────
function GroupCard({ group }: { group: WebinarGroup }) {
  const qc = useQueryClient();
  const toast = useToast();
  const meta = GROUP_META[group.slug];
  const currentUrl = `https://chat.whatsapp.com/${group.whatsapp_group_code}`;
  const [input, setInput] = useState(currentUrl);
  const [saving, setSaving] = useState(false);
  const parsedCode = parseWhatsAppGroupCode(input);
  const changed = parsedCode !== null && parsedCode !== group.whatsapp_group_code;

  useEffect(() => setInput(currentUrl), [currentUrl]);

  async function save() {
    if (!parsedCode) {
      toast.error('Colle le lien WhatsApp (https://chat.whatsapp.com/…) ou directement le code du groupe.', 'Lien invalide');
      return;
    }
    if (!changed || saving) return;

    setSaving(true);
    try {
      await updateWebinarGroup(group.slug, parsedCode);
      await qc.invalidateQueries({ queryKey: queryKeys.adminWebinarGroups });
      toast.success(`Le groupe ${meta.title} a été mis à jour.`, 'Lien enregistré');
    } catch {
      toast.error("La modification n'a pas été enregistrée. Réessaie.", 'Erreur');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card-padded space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">{meta.title}</h2>
          <p className="mt-1 text-sm text-zinc-600">{meta.description}</p>
        </div>
        <span className="badge-green"><span className="dot" /> Actif</span>
      </div>

      <div>
        <label className="label" htmlFor={`group-${group.slug}`}>Nouveau lien du groupe WhatsApp</label>
        <input
          id={`group-${group.slug}`}
          className="input font-mono"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="https://chat.whatsapp.com/… ou le code du groupe"
        />
        {input.trim() && !parsedCode && (
          <p className="field-error">Colle un lien WhatsApp valide, ou directement le code du groupe.</p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-primary flex-1" disabled={!changed || saving} onClick={save}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Enregistrement…' : 'Enregistrer le nouveau lien'}
        </button>
        <a className="btn-outline" href={meta.pageUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> Voir la page
        </a>
      </div>

      <div className="border-t border-zinc-100 pt-4 text-xs text-zinc-500">
        Dernière mise à jour : {formatDateTime(group.updated_at)}
      </div>
    </section>
  );
}

// ── IMMIGRATION / TIKTOK : rotation manager ─────────────────────────────────
function StatusBadge({ status }: { status: RotationLink['status'] }) {
  if (status === 'full') return <span className="badge-red">Plein</span>;
  if (status === 'retired') return <span className="badge-slate">Retiré</span>;
  return <span className="badge-green"><span className="dot" /> Actif</span>;
}

function LinkRow({
  link, onRemove, removing, onRename, renaming,
}: {
  link: RotationLink;
  onRemove: (link: RotationLink) => void;
  removing: boolean;
  onRename: (link: RotationLink, label: string) => void;
  renaming: boolean;
}) {
  const muted = link.status !== 'active';
  const color = link.status === 'full' ? 'green' : 'orange';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(link.label ?? '');
  useEffect(() => { setDraft(link.label ?? ''); }, [link.label]);

  function saveName() {
    if (renaming) return;
    if ((draft.trim() || '') === (link.label ?? '')) { setEditing(false); return; }
    onRename(link, draft.trim());
    setEditing(false);
  }

  return (
    <div className={`rounded-lg border border-zinc-100 p-3 ${muted ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex-none rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-500">
            #{link.position}
          </span>
          {editing ? (
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <input
                autoFocus
                className="input h-8 py-1 text-sm"
                value={draft}
                maxLength={80}
                placeholder="Nom du groupe"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setDraft(link.label ?? ''); setEditing(false); } }}
                disabled={renaming}
              />
              <button type="button" className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-50" onClick={saveName} disabled={renaming} aria-label="Enregistrer le nom">
                {renaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
              <button type="button" className="rounded p-1 text-zinc-400 hover:bg-zinc-100" onClick={() => { setDraft(link.label ?? ''); setEditing(false); }} disabled={renaming} aria-label="Annuler">
                <X className="h-4 w-4" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="group flex min-w-0 items-center gap-1 text-left"
              onClick={() => setEditing(true)}
              title="Renommer ce groupe"
            >
              <span className={`truncate text-sm font-semibold ${link.label ? 'text-zinc-800' : 'italic text-zinc-400'}`}>
                {link.label || 'Sans nom'}
              </span>
              <Pencil className="h-3 w-3 flex-none text-zinc-300 group-hover:text-zinc-500" />
            </button>
          )}
        </div>
        <div className="flex flex-none items-center gap-2">
          <StatusBadge status={link.status} />
          <button
            type="button"
            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            onClick={() => onRemove(link)}
            disabled={removing}
            title="Supprimer ce lien"
            aria-label={`Supprimer le lien #${link.position}`}
          >
            {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <code className="mt-1.5 block truncate font-mono text-xs text-zinc-400">{link.whatsapp_code}</code>
      <div className="mt-2 flex items-center gap-3">
        <ProgressBar
          value={link.unique_ip_count}
          max={GROUP_CAP}
          color={color}
          className="flex-1"
          label={`Membres du groupe #${link.position}`}
        />
        <span className="flex-none text-xs tabular-nums text-zinc-500">
          {link.unique_ip_count} / {GROUP_CAP}
        </span>
      </div>
    </div>
  );
}

function RotationManager({ funnel }: { funnel: RotationFunnel }) {
  const qc = useQueryClient();
  const toast = useToast();
  const meta = GROUP_META[funnel];

  const overviewQ = useQuery({
    queryKey: queryKeys.adminRotation(funnel),
    queryFn: () => fetchRotationOverview(funnel),
  });

  const [appendInput, setAppendInput] = useState('');
  const [newLotInput, setNewLotInput] = useState('');
  const [emergencyInput, setEmergencyInput] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [busy, setBusy] = useState<null | 'append' | 'lot' | 'emergency'>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RotationLink | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const state = overviewQ.data?.state ?? null;
  const links = overviewQ.data?.links ?? [];

  // Prefill the emergency field from the stored code (as a full link, like the
  // Pflege editor). Only when the query lands, never clobbering a live edit.
  useEffect(() => {
    setEmergencyInput(state?.emergency_code ? `https://chat.whatsapp.com/${state.emergency_code}` : '');
  }, [state?.emergency_code]);

  const currentLot = state?.current_lot ?? 1;
  const activeLinks = useMemo(() => links.filter((l) => l.status === 'active'), [links]);
  const currentLotLinks = useMemo(
    () => links.filter((l) => l.lot_number === currentLot && l.status !== 'retired'),
    [links, currentLot],
  );
  const retiredLinks = useMemo(() => links.filter((l) => l.status === 'retired'), [links]);
  const fullCount = currentLotLinks.filter((l) => l.status === 'full').length;

  const appendParsed = parseCodeList(appendInput);
  const newLotParsed = parseCodeList(newLotInput);
  const emergencyParsed = parseWhatsAppGroupCode(emergencyInput);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: queryKeys.adminRotation(funnel) });
  }

  async function doAppend() {
    if (busy) return;
    if (appendParsed.codes.length === 0) {
      toast.error('Colle au moins un lien WhatsApp valide.', 'Rien à ajouter');
      return;
    }
    setBusy('append');
    try {
      const res = await rpcAddRotationLinks(funnel, appendParsed.codes);
      setAppendInput('');
      await refresh();
      toast.success(`${res.added} lien(s) ajouté(s) au lot ${res.lot}.`, 'Lot mis à jour');
    } catch {
      toast.error("Les liens n'ont pas été ajoutés. Réessaie.", 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  async function doStartNewLot() {
    if (busy) return;
    if (newLotParsed.codes.length === 0) {
      toast.error('Colle au moins un lien WhatsApp valide pour le nouveau lot.', 'Nouveau lot vide');
      return;
    }
    setBusy('lot');
    try {
      const res = await rpcStartNewRotationLot(funnel, newLotParsed.codes);
      setNewLotInput('');
      setConfirmOpen(false);
      await refresh();
      toast.success(`Lot ${res.lot} activé avec ${res.added} lien(s). L'ancien lot est retiré.`, 'Nouveau lot activé');
    } catch {
      toast.error("Le nouveau lot n'a pas été activé. Réessaie.", 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  async function doRemove(link: RotationLink) {
    if (removingId) return;
    setRemovingId(link.id);
    try {
      const res = await rpcRemoveRotationLink(link.id);
      setRemoveTarget(null);
      await refresh();
      toast.success(res.deleted ? 'Lien supprimé.' : 'Lien retiré de la rotation.', 'Fait');
    } catch {
      toast.error("Le lien n'a pas pu être supprimé. Réessaie.", 'Erreur');
    } finally {
      setRemovingId(null);
    }
  }

  async function doRename(link: RotationLink, label: string) {
    if (renamingId) return;
    setRenamingId(link.id);
    try {
      await rpcRenameRotationLink(link.id, label);
      await refresh();
    } catch {
      toast.error("Le nom n'a pas pu être enregistré. Réessaie.", 'Erreur');
    } finally {
      setRenamingId(null);
    }
  }

  // A link nobody has been sent to yet is a plain mistake → remove it straight
  // away. A link that already has members opens a confirm (it gets retired, its
  // members keep their link).
  function requestRemove(link: RotationLink) {
    if (link.unique_ip_count === 0) void doRemove(link);
    else setRemoveTarget(link);
  }

  async function doSaveEmergency() {
    if (busy) return;
    const raw = emergencyInput.trim();
    if (raw && !emergencyParsed) {
      toast.error('Colle un lien WhatsApp valide, ou laisse vide pour retirer le lien de secours.', 'Lien invalide');
      return;
    }
    setBusy('emergency');
    try {
      await rpcSetEmergencyLink(funnel, raw ? (emergencyParsed as string) : '');
      await refresh();
      toast.success(raw ? 'Lien de secours enregistré.' : 'Lien de secours retiré.', 'Secours mis à jour');
    } catch {
      toast.error("Le lien de secours n'a pas été enregistré. Réessaie.", 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card-padded space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">{meta.title}</h2>
          <p className="mt-1 text-sm text-zinc-600">{meta.description}</p>
        </div>
        <a className="btn-outline" href={meta.pageUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> Page
        </a>
      </div>

      {/* Live status */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-zinc-50 p-3">
          <div className="text-2xl font-bold text-zinc-900">{activeLinks.length}</div>
          <div className="text-xs text-zinc-500">Liens actifs</div>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <div className="text-2xl font-bold text-zinc-900">{fullCount}</div>
          <div className="text-xs text-zinc-500">Pleins (lot actif)</div>
        </div>
        <div className="rounded-lg bg-zinc-50 p-3">
          <div className="text-2xl font-bold text-zinc-900">{currentLot}</div>
          <div className="text-xs text-zinc-500">Lot en cours</div>
        </div>
      </div>

      {overviewQ.isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-aurel-orange" /> Chargement…
        </div>
      )}
      {overviewQ.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Impossible de charger la rotation.
          <button type="button" className="btn-outline ml-2" onClick={() => overviewQ.refetch()}>Réessayer</button>
        </div>
      )}

      {/* Active lot list */}
      {!overviewQ.isLoading && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-700">Lot actif (lot {currentLot})</h3>
            <button type="button" className="btn-ghost text-zinc-500" onClick={refresh} title="Rafraîchir">
              <RotateCw className="h-4 w-4" />
            </button>
          </div>
          {currentLotLinks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 p-3 text-sm text-zinc-500">
              Aucun lien dans le lot actif. Ajoute des liens ci-dessous.
            </p>
          ) : (
            currentLotLinks.map((link) => (
              <LinkRow
                key={link.id}
                link={link}
                onRemove={requestRemove}
                removing={removingId === link.id}
                onRename={doRename}
                renaming={renamingId === link.id}
              />
            ))
          )}
        </div>
      )}

      {/* Append to active lot */}
      <div className="border-t border-zinc-100 pt-4">
        <label className="label" htmlFor={`append-${funnel}`}>Ajouter au lot actif</label>
        <input
          id={`append-${funnel}`}
          className="input font-mono"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={appendInput}
          onChange={(e) => setAppendInput(e.target.value)}
          placeholder="Un ou plusieurs liens (séparés par un espace / une virgule)"
        />
        {appendParsed.invalid.length > 0 && (
          <p className="field-error">Ignoré(s) : {appendParsed.invalid.join(', ')}</p>
        )}
        <button
          type="button"
          className="btn-outline mt-2 w-full"
          disabled={busy !== null || appendParsed.codes.length === 0}
          onClick={doAppend}
        >
          {busy === 'append' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Ajouter {appendParsed.codes.length > 0 ? `(${appendParsed.codes.length})` : ''}
        </button>
      </div>

      {/* Start a new lot */}
      <div className="border-t border-zinc-100 pt-4">
        <label className="label" htmlFor={`newlot-${funnel}`}>Activer un nouveau lot</label>
        <p className="mb-1 text-xs text-zinc-500">Un lien par ligne. Le lot actuel sera <strong>retiré</strong>.</p>
        <textarea
          id={`newlot-${funnel}`}
          className="input font-mono min-h-[88px]"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={newLotInput}
          onChange={(e) => setNewLotInput(e.target.value)}
          placeholder={'https://chat.whatsapp.com/AAAAAAAAAA\nhttps://chat.whatsapp.com/BBBBBBBBBB'}
        />
        {newLotParsed.invalid.length > 0 && (
          <p className="field-error">Ignoré(s) : {newLotParsed.invalid.join(', ')}</p>
        )}
        <button
          type="button"
          className="btn-danger mt-2 w-full"
          disabled={busy !== null || newLotParsed.codes.length === 0}
          onClick={() => setConfirmOpen(true)}
        >
          <RotateCw className="h-4 w-4" />
          Activer un nouveau lot {newLotParsed.codes.length > 0 ? `(${newLotParsed.codes.length})` : ''}
        </button>
      </div>

      {/* Emergency link */}
      <div className="border-t border-zinc-100 pt-4">
        <label className="label flex items-center gap-1.5" htmlFor={`emergency-${funnel}`}>
          <LifeBuoy className="h-4 w-4 text-aurel-orange" /> Lien de secours (emergency)
        </label>
        <p className="mb-1 text-xs text-zinc-500">Utilisé uniquement si aucun lien n'est disponible. Laisse vide pour le retirer.</p>
        <input
          id={`emergency-${funnel}`}
          className="input font-mono"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={emergencyInput}
          onChange={(e) => setEmergencyInput(e.target.value)}
          placeholder="https://chat.whatsapp.com/… (optionnel)"
        />
        {emergencyInput.trim() && !emergencyParsed && (
          <p className="field-error">Colle un lien WhatsApp valide, ou laisse vide.</p>
        )}
        <button
          type="button"
          className="btn-outline mt-2 w-full"
          disabled={busy !== null}
          onClick={doSaveEmergency}
        >
          {busy === 'emergency' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer le lien de secours
        </button>
      </div>

      {/* Retired lots history */}
      {retiredLinks.length > 0 && (
        <div className="border-t border-zinc-100 pt-4">
          <button
            type="button"
            className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
            onClick={() => setShowRetired((v) => !v)}
          >
            {showRetired ? '▾' : '▸'} Lots précédents (retirés) · {retiredLinks.length}
          </button>
          {showRetired && (
            <div className="mt-2 space-y-2">
              {retiredLinks.map((link) => (
                <div key={link.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-100 p-2 opacity-60">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex-none rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">lot {link.lot_number}</span>
                    <code className="truncate font-mono text-xs text-zinc-700">{link.whatsapp_code}</code>
                  </div>
                  <span className="flex-none text-xs text-zinc-400">{link.unique_ip_count} membres</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirm dialog for new lot */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Activer un nouveau lot ?">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Le lot actuel (lot {currentLot}) sera <strong>entièrement retiré</strong> : tous ses liens, pleins ou non,
            sortent de la rotation. Les nouveaux inscrits iront uniquement vers le nouveau lot.
          </p>
          <p className="text-sm text-slate-600">
            Les personnes déjà dirigées vers un ancien groupe continueront d'y accéder (leur lien reste valable).
          </p>
          <div className="rounded-lg bg-zinc-50 p-3 text-sm">
            <span className="font-semibold text-zinc-800">{newLotParsed.codes.length} lien(s)</span> dans le nouveau lot.
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline" onClick={() => setConfirmOpen(false)} disabled={busy !== null}>
              Annuler
            </button>
            <button type="button" className="btn-danger" onClick={doStartNewLot} disabled={busy !== null}>
              {busy === 'lot' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Confirmer et activer
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm dialog for removing a link that already has members */}
      <Modal open={removeTarget !== null} onClose={() => setRemoveTarget(null)} title="Retirer ce lien ?">
        {removeTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Le groupe #{removeTarget.position} a déjà <strong>{removeTarget.unique_ip_count} membre(s)</strong>.
              Il sera <strong>retiré de la rotation</strong> : plus aucun nouvel inscrit n'y sera envoyé, mais
              les personnes déjà présentes gardent leur lien.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-outline" onClick={() => setRemoveTarget(null)} disabled={removingId !== null}>
                Annuler
              </button>
              <button type="button" className="btn-danger" onClick={() => doRemove(removeTarget)} disabled={removingId !== null}>
                {removingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Retirer de la rotation
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
