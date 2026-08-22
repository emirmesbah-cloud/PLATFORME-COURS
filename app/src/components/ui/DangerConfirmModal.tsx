import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

/**
 * Type-to-confirm dialog for irreversible mass actions (e.g. "Tout supprimer").
 * The confirm button stays disabled until the admin types the exact word, so a
 * stray click can never wipe a whole list.
 */
export function DangerConfirmModal({
  open, onClose, onConfirm, title, description, count, confirmWord = 'SUPPRIMER',
  confirmLabel = 'Supprimer définitivement', busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  count: number;
  confirmWord?: string;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => { if (!open) setTyped(''); }, [open]);

  const matches = typed.trim().toUpperCase() === confirmWord.toUpperCase();

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={title} maxWidth="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-card-sm border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
          <div>{description}</div>
        </div>
        <p className="text-sm text-zinc-700">
          Cette action est <strong>irréversible</strong> et concerne <strong>{count}</strong> élément(s).
        </p>
        <div>
          <label className="label" htmlFor="danger-confirm-input">
            Tape <span className="font-mono font-bold text-red-600">{confirmWord}</span> pour confirmer
          </label>
          <input
            id="danger-confirm-input"
            className="input font-mono"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmWord}
            disabled={busy}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>Annuler</button>
          <button
            type="button"
            className="btn-primary bg-red-600 hover:bg-red-700"
            disabled={!matches || busy || count === 0}
            onClick={onConfirm}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
