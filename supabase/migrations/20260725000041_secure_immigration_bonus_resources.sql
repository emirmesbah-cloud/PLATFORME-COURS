-- Publish the Immigration PDFs through the existing private bonus bucket.
BEGIN;

DROP POLICY IF EXISTS "bonus-resources read for authenticated" ON storage.objects;
CREATE POLICY "bonus-resources read for authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bonus-resources'
    AND (
      public.is_admin(auth.uid())
      OR (
        public.has_course('immigration')
        AND name LIKE 'immigration/%'
      )
      OR (
        public.has_course('pflege')
        AND name NOT LIKE 'immigration/%'
      )
    )
  );

INSERT INTO public.bonus_resources (
  name,
  description,
  file_url,
  file_type,
  order_index,
  is_published,
  course
) VALUES
  (
    'B1 — Tous les modèles',
    'CV, lettres et emails prêts à remplir.',
    'immigration/B1-tous-les-modeles.pdf',
    'pdf',
    101,
    TRUE,
    'immigration'
  ),
  (
    'B2 — Liens, portails & contacts',
    'Tous les sites officiels et numéros utiles.',
    'immigration/B2-liens-portails-contacts.pdf',
    'pdf',
    102,
    TRUE,
    'immigration'
  ),
  (
    'B3 — Communauté',
    'Accès au groupe privé et aux ressources.',
    'immigration/B3-communaute.pdf',
    'pdf',
    103,
    TRUE,
    'immigration'
  ),
  (
    'B4 — Mises à jour',
    'Les changements de lois et de seuils.',
    'immigration/B4-mises-a-jour.pdf',
    'pdf',
    104,
    TRUE,
    'immigration'
  ),
  (
    'Exemple — CV Lebenslauf',
    'Modèle de CV à l’allemande.',
    'immigration/exemple-CV-Lebenslauf.pdf',
    'pdf',
    105,
    TRUE,
    'immigration'
  ),
  (
    'Exemple — Lettre Anschreiben',
    'Lettre de motivation modèle.',
    'immigration/exemple-lettre-Anschreiben.pdf',
    'pdf',
    106,
    TRUE,
    'immigration'
  ),
  (
    'Exemple — Emails en allemand',
    'Modèles d’emails aux employeurs.',
    'immigration/exemple-emails-allemand.pdf',
    'pdf',
    107,
    TRUE,
    'immigration'
  )
ON CONFLICT (order_index) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_url = EXCLUDED.file_url,
  file_type = EXCLUDED.file_type,
  is_published = EXCLUDED.is_published,
  course = EXCLUDED.course;

NOTIFY pgrst, 'reload schema';
COMMIT;
