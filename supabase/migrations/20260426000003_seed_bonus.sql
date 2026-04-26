-- ============================================================================
-- Aurel Academy — Plateforme étudiant — Phase 1
-- Migration 003 : seed des 7 ressources bonus (ordre canonique, NON NÉGOCIABLE)
-- ============================================================================

INSERT INTO bonus_resources (name, description, file_type, order_index, is_published) VALUES
(
  'Glossaire 150 termes médicaux',
  '150 termes essentiels en Pflegeheim, trilingue Allemand/Français/Darija, organisés en 6 catégories : Körperteile (30 parties du corps), Krankheiten (30 pathologies), Medikamente (20 médicaments), Pflegehandlungen (30 actes de soins), Hilfsmittel (23 équipements), Übergabe (17 termes transmissions). Format PDF imprimable A4, 18-20 pages. Inclut méthode de mémorisation 15 jours.',
  'docx',
  1,
  TRUE
),
(
  'CV Template Krankenpfleger',
  'Template CV format allemand professionnel pour infirmier diplômé (DEI). Structure standard Lebenslauf : Profil, Berufserfahrung, Ausbildung, Anerkennung, Sprachen. Vocabulaire pro pré-rempli en allemand. Format Word éditable, personnalisable en 30 minutes. Sans branding pour usage 100% personnel. Compatible ATS allemands.',
  'docx',
  2,
  TRUE
),
(
  'CV Template Pflegehelfer',
  'Template CV format aide-soignant adapté aux profils ATS, DEMA, ou Bac santé. Mise en avant de la pratique terrain. Section dédiée à la perspective Anerkennung future. Format épuré 1 page maximum. Personnalisable en 30 minutes. Format Word éditable.',
  'docx',
  3,
  TRUE
),
(
  'Anschreiben Krankenpfleger',
  'Lettre de motivation infirmier en allemand, 5 paragraphes structurés : accroche, expérience, pourquoi Allemagne, niveau de langue, perspective Anerkennung. Plus important que le CV en Allemagne. 15 minutes par candidature pour personnalisation. Personnalisable pour chaque Pflegeheim cible.',
  'docx',
  4,
  TRUE
),
(
  'Anschreiben Pflegehelfer',
  'Lettre de motivation aide-soignant en allemand. Format adapté au profil aide-soignant. Met en avant empathie et pratique terrain. Mention de la perspective Anerkennung future. Phrases prêtes à personnaliser pour chaque candidature.',
  'docx',
  5,
  TRUE
),
(
  'Guide Anerkennung Trilingue',
  'Guide complet 23 pages trilingue Allemand/Français/Darija pour réussir ton dossier Anerkennung. 9 sections détaillées : 4 portails officiels gouvernementaux (anerkennung-in-deutschland.de, make-it-in-germany.com, zsba.de, netzwerk-iq.de), checklist des 9 documents obligatoires, procédure étape par étape, coûts réels (800-2000€), 7 erreurs fatales à éviter, 28 termes vocab table, 8 questions fréquentes.',
  'docx',
  6,
  TRUE
),
(
  'Méthode Prospection Pflegeheim',
  'Méthode complète pour décrocher un poste : 30 chaînes employeurs pérennes (Korian, Alloheim, Pro Seniore, Vivantes, Orpea, Asklepios, Helios, Sana, MediClin, DRK, Caritas, Diakonie, AWO, Johanniter, Malteser, Kursana, etc.), 8 jobboards principaux (Indeed.de, Stepstone, Pflegestellenbörse, Pflegejob, etc.), méthode 5 étapes pour obtenir 5-10 entretiens en 6 semaines, templates emails de prospection prêts à copier, checklist candidature gagnante en 12 points, 5 erreurs qui tuent une candidature.',
  'docx',
  7,
  TRUE
)
ON CONFLICT (order_index) DO NOTHING;

-- Sanity check : exactement 7 bonus après seed.
DO $$
DECLARE
  cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM bonus_resources;
  IF cnt <> 7 THEN
    RAISE EXCEPTION 'Seed bonus : nombre de bonus incorrect (%). Attendu : 7.', cnt;
  END IF;
END $$;
