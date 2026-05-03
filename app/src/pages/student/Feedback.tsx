import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Star, Loader2, Heart, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { fetchOwnFeedback, submitFeedback, queryKeys } from '@/lib/queries';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

export function StudentFeedback() {
  const { user, profile } = useAuth();
  const uid = user?.id ?? '';
  const toast = useToast();
  const navigate = useNavigate();

  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [testimonial, setTestimonial] = useState('');
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [isPublic, setIsPublic] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // SHERLOCK FIX : ref pour bloquer le double-submit. setSubmitting(true) est
  // async côté React (microtask boundary), donc un double-Enter rapide
  // pouvait passer DEUX submitFeedback INSERTs avant que le bouton ne se
  // disable. Le ref est synchrone et bloque immédiatement.
  const submittingRef = useRef(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: queryKeys.feedback(uid),
    queryFn: () => fetchOwnFeedback(uid),
    enabled: !!uid,
  });

  if (isLoading) return <Spinner label="Chargement..." />;

  if (existing) {
    return (
      <div className="max-w-xl mx-auto text-center space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
          <CheckCircle2 className="h-9 w-9 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-aurel-ink">Merci pour ton retour, {profile?.first_name} !</h1>
        <p className="text-slate-600">
          Tu as déjà laissé un avis sur Aurel Academy. Note attribuée :{' '}
          <span className="font-bold text-aurel-orange">{existing.rating}/5</span>
        </p>
        {existing.testimonial && (
          <blockquote className="card-padded italic text-slate-700 border-l-4 border-aurel-orange">
            « {existing.testimonial} »
          </blockquote>
        )}
        <button onClick={() => navigate('/dashboard')} className="btn-primary">
          Retour au dashboard
        </button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return; // double-submit guard
    if (!uid) return;
    if (rating === 0) {
      toast.error('Sélectionne une note de 1 à 5 étoiles.', 'Note requise');
      return;
    }
    if (recommend === null) {
      toast.error('Réponds à la question "Recommanderais-tu Aurel Academy ?".', 'Champ manquant');
      return;
    }
    if (isPublic === null) {
      toast.error('Réponds à la question sur la publication publique.', 'Champ manquant');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await submitFeedback({
        userId: uid,
        rating,
        testimonial: testimonial.trim() || null,
        wouldRecommend: recommend,
        isPublic,
      });
      toast.success('Ton avis a bien été envoyé. Aurel le lira personnellement.', 'Merci !');
      navigate('/dashboard');
    } catch (err) {
      toast.error('Impossible d\'envoyer ton avis. Réessaie.', 'Erreur');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-aurel-orange">
          <Heart className="h-5 w-5" />
          <span className="text-sm font-semibold uppercase tracking-wide">Ton avis compte</span>
        </div>
        <h1 className="text-3xl font-bold text-aurel-ink md:text-4xl">
          Aide les futurs apprenants à choisir Aurel Academy
        </h1>
        <p className="mt-2 text-slate-600">
          Ton retour aide à améliorer la formation et donne confiance aux prochains étudiants.
          Ça prend 2 minutes.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 1. Note */}
        <section className="card-padded">
          <label className="mb-3 block text-base font-semibold text-aurel-ink">
            1. Quelle note donnerais-tu globalement à Aurel Academy ?
          </label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                type="button"
                key={n}
                onMouseEnter={() => setHoverRating(n)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(n)}
                className="p-1"
              >
                <Star
                  className={cn(
                    'h-9 w-9 transition',
                    (hoverRating || rating) >= n ? 'fill-aurel-orange text-aurel-orange' : 'text-slate-300'
                  )}
                />
              </button>
            ))}
            <span className="ml-3 self-center text-sm text-slate-500">
              {rating > 0 ? `${rating}/5` : 'Clique sur les étoiles'}
            </span>
          </div>
        </section>

        {/* 2. Témoignage */}
        <section className="card-padded">
          <label htmlFor="testimonial" className="mb-2 block text-base font-semibold text-aurel-ink">
            2. Raconte ton expérience (optionnel mais apprécié)
          </label>
          <p className="mb-3 text-sm text-slate-500">
            Qu'est-ce que cette formation t'a apporté ? Quelle leçon ou bonus a fait la différence ?
          </p>
          <textarea
            id="testimonial"
            className="input min-h-[140px] resize-y"
            value={testimonial}
            onChange={(e) => setTestimonial(e.target.value)}
            placeholder="Ex : Avant cette formation, je ne savais même pas par où commencer..."
            maxLength={1500}
          />
          <p className="mt-1 text-right text-xs text-slate-400">{testimonial.length}/1500</p>
        </section>

        {/* 3. Recommandation */}
        <section className="card-padded">
          <p className="mb-3 text-base font-semibold text-aurel-ink">
            3. Recommanderais-tu Aurel Academy à un autre infirmier algérien ?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRecommend(true)}
              className={cn(
                'rounded-lg border px-4 py-3 font-semibold transition',
                recommend === true ? 'border-aurel-teal bg-teal-50 text-aurel-teal' : 'border-slate-300 hover:bg-slate-50'
              )}
            >
              👍 Oui, sans hésiter
            </button>
            <button
              type="button"
              onClick={() => setRecommend(false)}
              className={cn(
                'rounded-lg border px-4 py-3 font-semibold transition',
                recommend === false ? 'border-red-400 bg-red-50 text-red-600' : 'border-slate-300 hover:bg-slate-50'
              )}
            >
              👎 Non
            </button>
          </div>
        </section>

        {/* 4. Public */}
        <section className="card-padded">
          <p className="mb-3 text-base font-semibold text-aurel-ink">
            4. Acceptes-tu qu'on publie ton témoignage publiquement ?
          </p>
          <p className="mb-3 text-sm text-slate-500">
            Si oui, ton prénom + ton témoignage apparaîtront sur la landing page (sans email ni numéro).
            Sinon, on garde ton retour en interne.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIsPublic(true)}
              className={cn(
                'rounded-lg border px-4 py-3 font-semibold transition',
                isPublic === true ? 'border-aurel-teal bg-teal-50 text-aurel-teal' : 'border-slate-300 hover:bg-slate-50'
              )}
            >
              ✅ Oui, publication OK
            </button>
            <button
              type="button"
              onClick={() => setIsPublic(false)}
              className={cn(
                'rounded-lg border px-4 py-3 font-semibold transition',
                isPublic === false ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-slate-300 hover:bg-slate-50'
              )}
            >
              🔒 Non, garde-le interne
            </button>
          </div>
        </section>

        <button type="submit" disabled={submitting} className="btn-primary btn-lg btn-block">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Envoyer mon avis
        </button>
      </form>
    </div>
  );
}
