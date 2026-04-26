-- ============================================================================
-- Aurel Academy — Plateforme étudiant — Phase 1
-- Migration 002 : seed des 18 leçons (ordre canonique, NON NÉGOCIABLE)
-- Source de vérité : PPTX + scripts FULL DOCX validés.
-- Ne pas réordonner. Ne pas renommer. Ne pas modifier les durées.
-- Total : 8+13+15+12+13+15+15+15+15+13+10+10+16+17+16+16+15+5 = 239 minutes (~4h)
-- ============================================================================

INSERT INTO lessons (lesson_number, title, subtitle, duration_minutes, module_parent, phase, order_index, is_published) VALUES
(1,  'Willkommen — Bienvenue chez Aurel Academy',                   'Ton premier pas vers l''Allemagne',                              8,  'Module 00 — Willkommen',                       'INTRODUCTION',  1,  FALSE),
(2,  'Le marché Pflege — Chiffres et opportunités',                 'Chiffres et opportunités',                                       13, 'Module A — Réalité du secteur Pflege',         'MARCHÉ',        2,  FALSE),
(3,  'Les 3 types de postes Pflege',                                'Choisir le bon profil selon ton diplôme algérien',               15, 'Module A — Réalité du secteur Pflege',         'MARCHÉ',        3,  FALSE),
(4,  'Vokabular — Anatomie & Pathologies (60 termes)',              'Catégories 1 et 2 du glossaire',                                 12, 'Module 01 — Vokabular médical essentiel',      'VOCABULAIRE',   4,  FALSE),
(5,  'Vokabular — Médicaments, Soins & Équipements (90 termes)',    'Catégories 3, 4, 5, 6 du glossaire',                             13, 'Module 01 — Vokabular médical essentiel',      'VOCABULAIRE',   5,  FALSE),
(6,  'Communication avec les patients',                             'Phrases-clés en situation',                                      15, 'Module 02 — Patientendialoge',                 'COMMUNICATION', 6,  FALSE),
(7,  'Pflegeheim Workflow — La journée type',                       'Comment s''organise une journée de soins',                       15, 'Module 03 — Pflegeheim Workflow',              'COMMUNICATION', 7,  FALSE),
(8,  'Übergabe — Le moment critique',                               'Maîtriser la transmission entre équipes',                        15, 'Module 03 — Pflegeheim Workflow',              'COMMUNICATION', 8,  FALSE),
(9,  'Pflegebericht — Rédiger un rapport de soin',                  'Documentation légalement conforme',                              15, 'Module D — Pflegedokumentation',               'DOCUMENTATION', 9,  FALSE),
(10, 'Abréviations & Codes du Pflegeheim',                          'Le langage caché de la documentation',                           13, 'Module D — Pflegedokumentation',               'DOCUMENTATION', 10, FALSE),
(11, 'Patients démence — Comment les accompagner',                  'Communication adaptée et respect',                               10, 'Module 05 — Patientenfälle complexes',         'PATIENTS',      11, FALSE),
(12, 'Urgences & Situations critiques',                             'Réagir vite et bien',                                            10, 'Module 05 — Patientenfälle complexes',         'PATIENTS',      12, FALSE),
(13, 'Simulation entretien #1 — Téléphonique recruteur',            'Réussir le premier filtre',                                      16, 'Module C — Simulation entretien',              'ENTRETIEN',     13, FALSE),
(14, 'Simulation entretien #2 — Journée type & cas patient',        'Démontrer que tu sais vraiment travailler',                      17, 'Module C — Simulation entretien',              'ENTRETIEN',     14, FALSE),
(15, 'Simulation #3 — Conflits & situations délicates',             'Maîtriser les questions piège',                                  16, 'Module C — Simulation entretien',              'ENTRETIEN',     15, FALSE),
(16, 'Anerkennung — Constituer ton dossier',                        'Les 9 documents obligatoires',                                   16, 'Module B — Anerkennung',                       'ANERKENNUNG',   16, FALSE),
(17, 'Anerkennung — Trouver la bonne Behörde',                      'Choisir et contacter ton Bundesland',                            15, 'Module B — Anerkennung',                       'ANERKENNUNG',   17, FALSE),
(18, 'Conclusion — Plan d''action 3-6-12 mois',                     'Transformer la formation en contrat signé',                      5,  'Module 06 — Conclusion & Plan d''action',      'CONCLUSION',    18, FALSE)
ON CONFLICT (lesson_number) DO NOTHING;

-- Sanity check : on s'assure d'avoir exactement 18 leçons après ce seed.
DO $$
DECLARE
  cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt FROM lessons;
  IF cnt <> 18 THEN
    RAISE EXCEPTION 'Seed lessons : nombre de leçons incorrect (%). Attendu : 18.', cnt;
  END IF;
END $$;
