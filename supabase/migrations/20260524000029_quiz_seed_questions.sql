-- =============================================================================
-- Seed : 85 quiz questions for PDF Leçons 2 → 18 (DB lessons 3 → 19)
-- =============================================================================
-- 5 questions per content lesson × 17 lessons = 85 questions.
-- PDF Leçon 1 (Willkommen, DB lesson 2) and disclaimer (DB lesson 1) have
-- NO quiz on purpose — they're intro / outro material.
--
-- Re-runnable : we wipe existing rows for these lessons before re-inserting.
-- Mapping : PDF Leçon N = DB lesson_number (N + 1).
-- =============================================================================

BEGIN;

-- Wipe any previous seed for DB lessons 3..19 so this migration is idempotent.
DELETE FROM public.quiz_questions
WHERE lesson_id IN (
  SELECT id FROM public.lessons WHERE lesson_number BETWEEN 3 AND 19
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 2 — Marché Pflege  (DB lesson 3)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Quel est le profil avec le salaire net le plus élevé parmi ces 4 ?$$,
  $$Pflegehelfer$$, $$Altenpfleger$$, $$Krankenpfleger$$, $$Pflegefachkraft Spezialist$$,
  3, $$Spezialist (oncologie, soins intensifs, gestion d'équipe) : 2 800 à 3 800 € nets.$$
FROM public.lessons WHERE lesson_number = 3;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$À Munich, sur un brut de 3 800 €, combien reste-t-il net après cotisations + impôts ?$$,
  $$Environ 3 500 €$$, $$Environ 2 470 €$$, $$Environ 1 800 €$$, $$Environ 3 800 € (pas de cotisations)$$,
  1, $$~35 % de retenues = 2 470 € nets.$$
FROM public.lessons WHERE lesson_number = 3;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Pourquoi Niedersachsen peut être plus avantageux que Bayern malgré un salaire plus bas ?$$,
  $$Le climat est meilleur$$, $$Le coût de la vie (notamment loyer) est bien plus bas → pouvoir d'achat supérieur$$, $$La langue allemande y est plus simple$$, $$L'Anerkennung n'est pas requise$$,
  1, $$Loyer ~450 € contre ~800 € à Munich.$$
FROM public.lessons WHERE lesson_number = 3;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Quel Bundesland est recommandé pour ceux dont l'allemand n'est pas encore parfait, grâce à l'usage de l'anglais ?$$,
  $$Bayern$$, $$Hessen (Frankfurt)$$, $$NRW$$, $$Berlin$$,
  1, $$Frankfurt : ville internationale, anglais courant.$$
FROM public.lessons WHERE lesson_number = 3;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Cause principale de la pénurie de Pflegekräfte en Allemagne ?$$,
  $$Les jeunes Allemands émigrent$$, $$Le vieillissement de la population (baby-boomers de 80+ ans)$$, $$Les salaires sont trop bas$$, $$Trop de Pflegeheim ferment$$,
  1, $$Population vieillissante + manque de jeunes Allemands attirés par le métier.$$
FROM public.lessons WHERE lesson_number = 3;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 3 — Les 3 types de postes  (DB lesson 4)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Avec un DEI algérien, à quel poste postuler ?$$,
  $$Pflegehelfer (sans Anerkennung)$$, $$Krankenpfleger (avec Anerkennung)$$, $$Betreuungskraft$$, $$Arzt$$,
  1, $$Le DEI correspond au profil Krankenpfleger, avec Anerkennung obligatoire.$$
FROM public.lessons WHERE lesson_number = 4;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Quel profil peut entrer en Allemagne en 6 à 9 mois au lieu de 12–18 mois ?$$,
  $$Krankenpfleger$$, $$Altenpfleger$$, $$Pflegehelfer (souvent pas d'Anerkennung formelle requise)$$, $$Pflegefachkraft Spezialist$$,
  2, $$Pflegehelfer = porte d'entrée rapide.$$
FROM public.lessons WHERE lesson_number = 4;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Avec un ATS algérien, quel poste viser ?$$,
  $$Krankenpfleger$$, $$Altenpfleger$$, $$Pflegehelfer$$, $$Betreuungskraft$$,
  2, $$ATS suffit pour Pflegehelfer dans la plupart des Bundesländer.$$
FROM public.lessons WHERE lesson_number = 4;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Le rôle de Betreuungskraft (§43b) consiste principalement à :$$,
  $$Faire des soins médicaux invasifs$$, $$Animer / accompagner socialement les résidents (pas de soins médicaux)$$, $$Distribuer les médicaments$$, $$Faire les pansements$$,
  1, $$Rôle social, présence humaine, animation.$$
FROM public.lessons WHERE lesson_number = 4;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Pour devenir Krankenpfleger, qui assume la responsabilité juridique en cas de problème de soin ?$$,
  $$Le médecin uniquement$$, $$Le directeur du Pflegeheim$$, $$Toi, le Krankenpfleger$$, $$La famille du patient$$,
  2, $$C'est un rôle à responsabilité juridique directe.$$
FROM public.lessons WHERE lesson_number = 4;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 4 — Vokabular Anatomie & Pathologies  (DB lesson 5)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Que signifie « die Niere » ?$$,
  $$Le foie$$, $$Le rein$$, $$Le poumon$$, $$La vessie$$,
  1, $$Die Niere = le rein.$$
FROM public.lessons WHERE lesson_number = 5;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Différence entre « der Bauch » et « der Magen » ?$$,
  $$Aucune, synonymes$$, $$Bauch = tout l'abdomen ; Magen = l'organe précis de l'estomac$$, $$Bauch = estomac ; Magen = intestin$$, $$Bauch = bas-ventre ; Magen = haut-ventre$$,
  1, $$Bauch = abdomen, Magen = organe précis.$$
FROM public.lessons WHERE lesson_number = 5;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Quel terme désigne l'escarre — qu'on retrouve dans presque chaque Pflegebericht ?$$,
  $$Der Dekubitus$$, $$Die Demenz$$, $$Der Schmerz$$, $$Die Wunde$$,
  0, $$Dekubitus = escarre.$$
FROM public.lessons WHERE lesson_number = 5;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$« Der Schlaganfall » signifie :$$,
  $$Infarctus du myocarde$$, $$AVC$$, $$Embolie pulmonaire$$, $$Hypertension artérielle$$,
  1, $$Schlaganfall = AVC.$$
FROM public.lessons WHERE lesson_number = 5;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$« Die Lungenentzündung » signifie :$$,
  $$Bronchite$$, $$Pneumonie$$, $$BPCO$$, $$Asthme$$,
  1, $$Lungenentzündung = pneumonie.$$
FROM public.lessons WHERE lesson_number = 5;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 5 — Vokabular Médicaments, Soins & Équipements  (DB lesson 6)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$« Die Spritze » désigne :$$,
  $$La perfusion$$, $$La seringue / l'injection$$, $$Le comprimé$$, $$Le pansement$$,
  1, $$Spritze = seringue / injection.$$
FROM public.lessons WHERE lesson_number = 6;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Quel terme désigne la prévention des escarres ?$$,
  $$Sturzprophylaxe$$, $$Thromboseprophylaxe$$, $$Dekubitusprophylaxe$$, $$Atemtherapie$$,
  2, $$Dekubitusprophylaxe = prévention escarres.$$
FROM public.lessons WHERE lesson_number = 6;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$« Der Rollator » est :$$,
  $$Un fauteuil roulant$$, $$Une canne$$, $$Un déambulateur$$, $$Un lit médicalisé$$,
  2, $$Rollator = déambulateur.$$
FROM public.lessons WHERE lesson_number = 6;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Quel mot désigne la transmission entre équipes ?$$,
  $$Die Pflegevisite$$, $$Die Übergabe$$, $$Die Fallbesprechung$$, $$Die Anordnung$$,
  1, $$Übergabe = transmission entre équipes.$$
FROM public.lessons WHERE lesson_number = 6;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$« Die Lagerung » signifie :$$,
  $$La mobilisation$$, $$Le positionnement (critique pour la prévention des escarres)$$, $$Le transfert lit-fauteuil$$, $$Le repas$$,
  1, $$Lagerung = positionnement.$$
FROM public.lessons WHERE lesson_number = 6;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 6 — Communication avec les patients  (DB lesson 7)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Comment t'adresser à un patient nommé Müller ?$$,
  $$« Du, Müller »$$, $$« Sie, Frau Müller »$$, $$« Hallo Müller »$$, $$Par son prénom$$,
  1, $$Vouvoiement + Frau/Herr + nom obligatoire.$$
FROM public.lessons WHERE lesson_number = 7;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Quelle formule utiliser avant chaque soin ?$$,
  $$« Ich mache jetzt... »$$, $$« Ich möchte... Ist das in Ordnung ? »$$, $$« Bitte halten Sie still »$$, $$« Keine Sorge »$$,
  1, $$Annonce + demande de consentement.$$
FROM public.lessons WHERE lesson_number = 7;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Un patient atteint de démence te dit qu'il doit aller chercher ses enfants à l'école (ils ont 60 ans). Que fais-tu ?$$,
  $$Tu le corriges : « Vos enfants sont adultes »$$, $$Tu valides l'émotion sans corriger la situation$$, $$Tu lui dis qu'on est en 2026$$, $$Tu lui interdis de sortir$$,
  1, $$Règle d'or : ne JAMAIS corriger la réalité.$$
FROM public.lessons WHERE lesson_number = 7;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Comment évalue-t-on l'intensité d'une douleur en allemand ?$$,
  $$« Auf einer Skala von 1 bis 10... »$$, $$« Auf einer Skala von 1 bis 5... »$$, $$« Léger, moyen, fort »$$, $$« Sind Sie OK ? »$$,
  0, $$Échelle universelle 1 à 10.$$
FROM public.lessons WHERE lesson_number = 7;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Phrase pour rassurer un patient anxieux ?$$,
  $$« Beruhigen Sie sich »$$, $$« Kein Problem »$$, $$« Ich bin hier. Sie sind nicht allein. »$$, $$« Auf Wiedersehen »$$,
  2, $$« Je suis là. Vous n'êtes pas seul. »$$
FROM public.lessons WHERE lesson_number = 7;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 7 — Pflegeheim Workflow  (DB lesson 8)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$À quelle heure commence le Frühdienst ?$$,
  $$4h00$$, $$6h00$$, $$8h00$$, $$10h00$$,
  1, $$Frühdienst de 6h à 14h.$$
FROM public.lessons WHERE lesson_number = 8;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Pendant le Frühdienst, à quelle heure a lieu la Pflegevisite avec le médecin ?$$,
  $$6h30$$, $$8h00$$, $$9h30$$, $$13h30$$,
  2, $$Pflegevisite à 9h30.$$
FROM public.lessons WHERE lesson_number = 8;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Que désigne « Kaffee und Kuchen » pendant le Spätdienst ?$$,
  $$Le petit-déjeuner$$, $$Le dîner$$, $$Le goûter — moment social important pour les résidents$$, $$La pause des soignants$$,
  2, $$Moment social important à 16h.$$
FROM public.lessons WHERE lesson_number = 8;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Pendant le Nachtdienst, à quels horaires faire le repositionnement des patients alités ?$$,
  $$Une seule fois à minuit$$, $$À 00h00 et à 04h00$$, $$Toutes les heures$$, $$Jamais, le patient dort$$,
  1, $$Repositionnement à 00h et 04h pour prévenir les escarres.$$
FROM public.lessons WHERE lesson_number = 8;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Pourquoi documenter au fur et à mesure plutôt qu'à la fin du service ?$$,
  $$Pour avoir l'air occupé$$, $$Parce qu'en fin de service tu es fatigué, tu oublies des détails, ton Pflegebericht devient nul$$, $$Parce que c'est obligatoire toutes les heures$$, $$Pour gagner du temps$$,
  1, $$Hygiène pro : 2 min de doc après chaque acte significatif.$$
FROM public.lessons WHERE lesson_number = 8;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 8 — Übergabe  (DB lesson 9)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Que signifie SBAR ?$$,
  $$Situation, Background, Assessment, Recommendation$$, $$Soin, Bilan, Action, Résultat$$, $$Surveillance, Bain, Alimentation, Repos$$, $$Système, Bouton, Alarme, Réponse$$,
  0, $$Format SBAR standard pour la transmission.$$
FROM public.lessons WHERE lesson_number = 9;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$En recevant une Übergabe, que faire si quelque chose t'a frappé sur un patient ?$$,
  $$Interrompre le collègue immédiatement$$, $$Reformuler à la fin de la transmission de ce patient : « Wenn ich richtig verstehe... »$$, $$Attendre la fin de la journée pour demander$$, $$Ne rien dire$$,
  1, $$Reformulation évite 90 % des erreurs.$$
FROM public.lessons WHERE lesson_number = 9;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$En transmission, comment exprimer une incertitude correctement ?$$,
  $$« Ich glaube, dass... »$$, $$« Ich bin nicht sicher, aber... »$$, $$« Vielleicht... »$$, $$« Ich denke mal... »$$,
  1, $$« Ich glaube » = registre amical, à éviter en pro.$$
FROM public.lessons WHERE lesson_number = 9;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Tu as oublié de donner un médicament. Que faire ?$$,
  $$Le cacher, personne ne le saura$$, $$Le donner en retard sans rien dire$$, $$Le signaler en Übergabe — la transparence est culturelle$$, $$Demander à un collègue de le faire à ta place sans documenter$$,
  2, $$Cacher = motif de licenciement immédiat.$$
FROM public.lessons WHERE lesson_number = 9;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Comment t'adresser à un médecin pendant la Pflegevisite ?$$,
  $$« Du » + prénom$$, $$« Sie » + Herr Doktor / Frau Doktor (vouvoiement min. 6 mois)$$, $$« Hallo Chef »$$, $$Par son prénom seul$$,
  1, $$Vouvoiement maintenu même si le médecin propose le tutoiement.$$
FROM public.lessons WHERE lesson_number = 9;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 9 — Pflegebericht  (DB lesson 10)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Que signifie DBME ?$$,
  $$Datum, Beobachtung, Maßnahme, Ergebnis$$, $$Doktor, Bett, Medikament, Essen$$, $$Datum, Bett, Mensch, Ergebnis$$, $$Direkt, Beobachten, Mobilisieren, Evaluieren$$,
  0, $$Date, Observation, Mesure, Résultat.$$
FROM public.lessons WHERE lesson_number = 10;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Tu fais une erreur en écrivant. Comment corriger ?$$,
  $$Effacer avec du correcteur blanc$$, $$Rayer proprement avec un trait, marquer tes initiales, écrire la correction en-dessous$$, $$Réécrire toute la page$$, $$Déchirer la page et recommencer$$,
  1, $$Tout effacement = falsification documentaire.$$
FROM public.lessons WHERE lesson_number = 10;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Peut-on documenter un acte avant de l'avoir réalisé ?$$,
  $$Oui, pour gagner du temps$$, $$Non, jamais — c'est de la falsification$$, $$Oui, si on est sûr de le faire$$, $$Oui, en fin de service$$,
  1, $$Toujours documenter APRÈS, jamais avant.$$
FROM public.lessons WHERE lesson_number = 10;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Comment décrire un patient qui crie et refuse un soin ?$$,
  $$« Frau Müller ist aggressiv »$$, $$« Frau Müller hat geschrien und den Soin verweigert »$$, $$« Frau Müller war böse »$$, $$« Frau Müller hat sich schlecht benommen »$$,
  1, $$Faits, pas interprétations.$$
FROM public.lessons WHERE lesson_number = 10;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Délai maximum pour documenter un incident (chute, agitation aiguë) ?$$,
  $$Dans les 30 minutes après l'incident$$, $$En fin de service$$, $$Le lendemain matin$$, $$Avant la prochaine Pflegevisite$$,
  0, $$Dans les 30 minutes pour se couvrir juridiquement.$$
FROM public.lessons WHERE lesson_number = 10;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 10 — Abréviations & Codes  (DB lesson 11)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Que signifie « b.B. » ?$$,
  $$Bei Bedarf — si nécessaire$$, $$Beim Bett — au lit$$, $$Blutdruck Basis$$, $$Bauch Beobachtung$$,
  0, $$b.B. = bei Bedarf (à la demande).$$
FROM public.lessons WHERE lesson_number = 11;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$« Schmerzmittel 1-0-1 p.o. » se lit :$$,
  $$1 le matin, 0 à midi, 1 le soir — par voie orale$$, $$10 comprimés par jour$$, $$1 sur 10, voie orale$$, $$1 toutes les heures pendant 10h$$,
  0, $$Schéma matin / midi / soir, par voie orale.$$
FROM public.lessons WHERE lesson_number = 11;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$« RR 145/85 » désigne :$$,
  $$Rythme respiratoire$$, $$Tension artérielle (Riva-Rocci) — ici 145/85 mmHg$$, $$Risque de réanimation$$, $$Rythme cardiaque$$,
  1, $$RR vient de Riva-Rocci, inventeur du tensiomètre.$$
FROM public.lessons WHERE lesson_number = 11;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Un patient PG 4 demande typiquement combien de temps par tournée ?$$,
  $$10 minutes$$, $$15 minutes$$, $$30 à 45 minutes$$, $$5 minutes$$,
  2, $$PG 4 = très sévère dépendance.$$
FROM public.lessons WHERE lesson_number = 11;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Que signifie « Insulin 8 IE s.c. » ?$$,
  $$8 mg insuline par voie orale$$, $$8 unités internationales d'insuline en sous-cutané$$, $$8 injections intramusculaires$$, $$Insuline toutes les 8 heures$$,
  1, $$IE = Internationale Einheiten ; s.c. = subkutan.$$
FROM public.lessons WHERE lesson_number = 11;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 11 — Patients démence  (DB lesson 12)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Quelle forme de démence représente 60 à 70 % des cas ?$$,
  $$Démence vasculaire$$, $$Alzheimer$$, $$Démence frontotemporale$$, $$Démence mixte$$,
  1, $$Alzheimer domine.$$
FROM public.lessons WHERE lesson_number = 12;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Caractéristique de la démence vasculaire ?$$,
  $$Évolution progressive et continue$$, $$Évolution par paliers, liée à des AVC répétés souvent silencieux$$, $$Affecte d'abord la personnalité$$, $$Toujours réversible$$,
  1, $$Évolution en paliers, liée à HTA + diabète non traités.$$
FROM public.lessons WHERE lesson_number = 12;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Face à un patient agité / agressif, premier réflexe ?$$,
  $$Hausser le ton pour imposer le calme$$, $$Baisser la voix et reculer pour donner de l'espace$$, $$Le saisir fermement$$, $$Lui ordonner de se taire$$,
  1, $$Baisser la voix calme paradoxalement.$$
FROM public.lessons WHERE lesson_number = 12;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Un patient pleure parce que sa mère lui manque (décédée il y a 40 ans). Que dire ?$$,
  $$« Ihre Mutter ist seit 40 Jahren tot »$$, $$« Das tut mir weh, dass Sie traurig sind. Erzählen Sie mir von Ihrer Mutter. »$$, $$« Beruhigen Sie sich »$$, $$« Reden wir über etwas anderes »$$,
  1, $$Valider l'émotion, pas la situation.$$
FROM public.lessons WHERE lesson_number = 12;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Avant d'entrer dans la chambre d'un résident, que faire ?$$,
  $$Entrer directement, c'est ton service$$, $$Frapper à la porte et saluer par le nom : « Frau Müller »$$, $$Klaxonner$$, $$Appeler de l'extérieur$$,
  1, $$Frapper + saluer = respect de la dignité.$$
FROM public.lessons WHERE lesson_number = 12;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 12 — Urgences  (DB lesson 13)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Numéro d'urgence en Allemagne ?$$,
  $$15$$, $$112$$, $$911$$, $$18$$,
  1, $$Le 112 partout en Europe / Allemagne.$$
FROM public.lessons WHERE lesson_number = 13;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$En appelant le 112, dans quel ordre donner les 4 informations ?$$,
  $$Wer, Was, Wo, Wann$$, $$Wo, Was, Wer, Wie viele$$, $$Was, Wo, Wer, Warum$$, $$Name, Adresse, Telefon, Alter$$,
  1, $$Où, Quoi, Qui, Combien.$$
FROM public.lessons WHERE lesson_number = 13;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Un résident est tombé et se plaint d'une douleur à la hanche. Que faire ?$$,
  $$Le porter sur le lit$$, $$L'asseoir doucement$$, $$Ne pas le bouger (fracture suspectée du col du fémur), le couvrir, attendre les secours$$, $$Lui donner un antidouleur$$,
  2, $$Geste n°1 : ne pas mobiliser une fracture suspectée.$$
FROM public.lessons WHERE lesson_number = 13;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Test FAST pour détecter un AVC ?$$,
  $$Face, Arms, Speech, Time$$, $$Fever, Asthma, Sweat, Tension$$, $$Food, Air, Skin, Temperature$$, $$Fall, Anémie, Sleep, Thrombose$$,
  0, $$Visage asymétrique, bras qui retombent, parole confuse, heure exacte.$$
FROM public.lessons WHERE lesson_number = 13;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Si un patient inconscient respire encore, dans quelle position le placer ?$$,
  $$Sur le dos, jambes en l'air$$, $$Position latérale de sécurité (PLS)$$, $$Assis adossé au mur$$, $$Sur le ventre$$,
  1, $$PLS évite l'asphyxie en cas de vomissement.$$
FROM public.lessons WHERE lesson_number = 13;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 13 — Simulation entretien #1 Téléphonique  (DB lesson 14)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Question : « Warum möchten Sie in Deutschland arbeiten ? » — quelle réponse à ÉVITER ?$$,
  $$« Pour élever mon niveau professionnel »$$, $$« Pour gagner plus d'argent »$$, $$« Pour travailler dans un pays qui valorise la Pflege »$$, $$« Pour la qualité du système de soin »$$,
  1, $$Tu te disqualifies en 5 secondes.$$
FROM public.lessons WHERE lesson_number = 14;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Tu as un B1 mais pas encore le B2. Que dire au recruteur ?$$,
  $$Mentir et dire B2$$, $$« Ich habe B1 und bereite gerade die B2-Prüfung vor »$$, $$Refuser de répondre$$, $$Dire que tu as le C1$$,
  1, $$Honnêteté + précision.$$
FROM public.lessons WHERE lesson_number = 14;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Le recruteur accélère son débit pour tester ton niveau. Que faire ?$$,
  $$Faire semblant de comprendre$$, $$Demander : « Können Sie das bitte wiederholen ? » ou « ...etwas langsamer sprechen ? »$$, $$Raccrocher$$, $$Répondre n'importe quoi$$,
  1, $$Demander de répéter = intelligence pro, pas faiblesse.$$
FROM public.lessons WHERE lesson_number = 14;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Réponse stratégique à la question « Welche Gehaltsvorstellungen haben Sie ? » ?$$,
  $$« 3500 € »$$, $$« 2000 € »$$, $$« Ich orientiere mich am Tarifvertrag. Entscheidend ist für mich die Stelle und das Team »$$, $$« Je veux le maximum »$$,
  2, $$Stratégique : laisser le recruteur ouvrir.$$
FROM public.lessons WHERE lesson_number = 14;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Quelle expression culturelle peut te coûter l'entretien ?$$,
  $$Dire « Guten Tag »$$, $$Utiliser « Inshallah » ou expressions religieuses similaires$$, $$Remercier en fin d'appel$$, $$Parler lentement$$,
  1, $$Le recruteur attend du business, pas du religieux.$$
FROM public.lessons WHERE lesson_number = 14;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 14 — Simulation entretien #2 Vidéo  (DB lesson 15)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Combien de temps max pour décrire ta journée type ?$$,
  $$30 secondes$$, $$90 secondes (3 blocs de 30s : matin / mi-journée / après-midi)$$, $$5 minutes$$, $$15 minutes$$,
  1, $$90 secondes pile.$$
FROM public.lessons WHERE lesson_number = 15;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$En présentant un cas patient, quel pronom utiliser pour décrire les actions prises ?$$,
  $$« Wir » (nous, l'équipe)$$, $$« Ich » (je — ce que TU as fait personnellement)$$, $$« Man » (on, impersonnel)$$, $$« Sie » (vous)$$,
  1, $$Le recruteur veut savoir ce que TU as fait.$$
FROM public.lessons WHERE lesson_number = 15;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Structure en 4 étapes pour présenter un cas patient ?$$,
  $$Nom / âge / pathologie / médicament$$, $$Qui / Anamnèse / Ce que TU as fait / Résultat + ressenti$$, $$Diagnostic / traitement / pronostic / sortie$$, $$Médecin / infirmier / aide-soignant / famille$$,
  1, $$4 étapes, 2 minutes total.$$
FROM public.lessons WHERE lesson_number = 15;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Faut-il dénigrer le système algérien pour valoriser ton départ ?$$,
  $$Oui, ça montre du recul$$, $$Non — si tu critiques ton ancien employeur, tu critiqueras le nouveau$$, $$Seulement si on te le demande$$, $$Oui, mais avec tact$$,
  1, $$Règle stricte : ne JAMAIS dénigrer.$$
FROM public.lessons WHERE lesson_number = 15;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Comment quantifier ton expérience pour qu'elle ait du poids ?$$,
  $$« Beaucoup de patients »$$, $$« 25 patients par jour »$$, $$« Plein de gens »$$, $$« Une équipe nombreuse »$$,
  1, $$Chiffres précis > flou.$$
FROM public.lessons WHERE lesson_number = 15;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 15 — Simulation entretien #3 Conflits  (DB lesson 16)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Que signifie STAR ?$$,
  $$Situation, Tâche, Action, Résultat$$, $$Stress, Travail, Aide, Réponse$$, $$Standard, Test, Action, Reporting$$, $$Solution, Team, Adaptation, Réussite$$,
  0, $$Format STAR standard en entretien européen.$$
FROM public.lessons WHERE lesson_number = 16;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Tu es en désaccord avec une prescription d'un médecin. Que faire ?$$,
  $$Le contredire devant le patient$$, $$Demander à parler en privé : « Könnte ich kurz mit Ihnen unter vier Augen sprechen ? » + présenter les FAITS$$, $$Refuser d'exécuter l'ordre$$, $$Aller directement voir le directeur$$,
  1, $$Jamais contredire devant le patient.$$
FROM public.lessons WHERE lesson_number = 16;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Face à un patient agressif, première phrase à dire en allemand ?$$,
  $$« Hören Sie sofort auf ! »$$, $$« Erstmal bleibe ich ruhig und wahre Distanz... »$$, $$« Gehen Sie weg ! »$$, $$« Ruhe ! »$$,
  1, $$Calme + distance protège patient et soignant.$$
FROM public.lessons WHERE lesson_number = 16;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Question « Raconte-moi un échec professionnel ». Mauvaise réponse ?$$,
  $$« Au début je sous-estimais les douleurs thoraciques chez les personnes âgées »$$, $$« Je travaille trop dur » (faux humble brag)$$, $$« J'ai mal géré une transmission, depuis je documente systématiquement »$$, $$« J'ai mal évalué une plaie au début, depuis je consulte plus tôt »$$,
  1, $$Réponse de débutant qui esquive.$$
FROM public.lessons WHERE lesson_number = 16;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$En fin d'entretien, le recruteur te demande « Haben Sie noch Fragen ? ». Réponse idéale ?$$,
  $$« Non, tout est clair »$$, $$Préparer 3 questions à poser (équipe, formation continue, plan d'intégration)$$, $$Une seule question sur le salaire$$, $$Demander à partir$$,
  1, $$0 question = candidat désintéressé = disqualifié.$$
FROM public.lessons WHERE lesson_number = 16;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 16 — Anerkennung Dossier  (DB lesson 17)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Quel document est le PLUS critique (sans lui, rejet automatique ou Anerkennung partielle) ?$$,
  $$Le passeport$$, $$L'acte de naissance$$, $$Le programme détaillé de la formation (detaillierte Studienordnung)$$, $$Le certificat médical$$,
  2, $$Sans ce document, dossier rejeté automatiquement.$$
FROM public.lessons WHERE lesson_number = 17;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Quels certificats B2 sont reconnus pour l'Anerkennung ?$$,
  $$N'importe quel certificat privé$$, $$Uniquement Goethe-Institut, telc, ÖSD, TestDaF$$, $$Seulement le Goethe$$, $$Tous les certificats algériens$$,
  1, $$4 certificats officiels reconnus.$$
FROM public.lessons WHERE lesson_number = 17;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Durée de validité du casier judiciaire (Polizeiliches Führungszeugnis) ?$$,
  $$1 mois$$, $$6 mois$$, $$1 an$$, $$5 ans$$,
  1, $$6 mois max.$$
FROM public.lessons WHERE lesson_number = 17;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Une traduction algérienne officielle de ton diplôme est-elle acceptée ?$$,
  $$Oui, si elle est tamponnée$$, $$Non — il faut un Übersetzer assermenté reconnu en Allemagne$$, $$Oui, en arabe et en français$$, $$Oui, si elle est certifiée par le consulat allemand$$,
  1, $$Traducteur assermenté reconnu en Allemagne, obligatoire.$$
FROM public.lessons WHERE lesson_number = 17;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Qui doit apposer l'apostille de La Haye sur ton diplôme algérien ?$$,
  $$Le consulat allemand$$, $$Le ministère algérien de la Justice$$, $$L'école qui a délivré le diplôme$$, $$Le ministère de la Santé$$,
  1, $$Ministère algérien de la Justice.$$
FROM public.lessons WHERE lesson_number = 17;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 17 — Anerkennung Behörde  (DB lesson 18)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Quel portail officiel utiliser pour trouver la bonne Behörde ?$$,
  $$anerkennung-in-deutschland.de$$, $$bundesagentur.de$$, $$goethe.de$$, $$make-it-in-germany.de$$,
  0, $$Portail officiel du gouvernement allemand.$$
FROM public.lessons WHERE lesson_number = 18;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Quel Bundesland a le délai de traitement le plus court (3 à 4 mois) ?$$,
  $$Berlin$$, $$NRW$$, $$Bayern$$, $$Hessen$$,
  2, $$Bayern le plus rapide.$$
FROM public.lessons WHERE lesson_number = 18;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Délai légal théorique pour traiter une demande d'Anerkennung ?$$,
  $$1 mois$$, $$3 mois (5 en moyenne réelle, jusqu'à 8 dans le pire cas)$$, $$6 mois$$, $$12 mois$$,
  1, $$3 mois théoriques, 5 mois moyens, 8 max.$$
FROM public.lessons WHERE lesson_number = 18;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Quel Bundesland accepte le dépôt avec un B1 (B2 requis seulement avant délivrance) ?$$,
  $$Bayern$$, $$Baden-Württemberg$$, $$Hessen$$, $$Berlin$$,
  1, $$Baden-Württemberg : B1 au dépôt, B2 avant délivrance.$$
FROM public.lessons WHERE lesson_number = 18;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Tu n'as pas de réponse après plusieurs semaines. Que faire ?$$,
  $$Recommencer le dossier à zéro$$, $$Envoyer un email poli de relance avec ton Aktenzeichen (n° de dossier)$$, $$Appeler ton consulat$$, $$Aller sur place en Allemagne$$,
  1, $$Email de relance respectant les codes administratifs allemands.$$
FROM public.lessons WHERE lesson_number = 18;


-- ─────────────────────────────────────────────────────────────────────────────
-- PDF Leçon 18 — Conclusion / Plan d'action  (DB lesson 19)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 1, $$Objectif principal à 3 mois ?$$,
  $$Acheter le billet d'avion$$, $$Passer le B2 Goethe + déposer le dossier Anerkennung$$, $$Trouver un appartement$$, $$Apprendre l'anglais$$,
  1, $$Langue + dossier, jalons mesurables.$$
FROM public.lessons WHERE lesson_number = 19;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 2, $$Objectif principal à 6 mois ?$$,
  $$Premier contrat signé$$, $$5 à 10 entretiens passés + au moins 2 propositions d'embauche$$, $$Apprendre le bavarois$$, $$Visa touristique$$,
  1, $$Candidatures + entretiens.$$
FROM public.lessons WHERE lesson_number = 19;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 3, $$Objectif principal à 12 mois ?$$,
  $$Arrivée en Allemagne, premier jour de travail, premier salaire en euros$$, $$Acheter une maison$$, $$Repasser le B2$$, $$Lancer une auto-entreprise$$,
  0, $$Arrivée + premier salaire.$$
FROM public.lessons WHERE lesson_number = 19;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 4, $$Action concrète à faire CETTE SEMAINE selon le plan ?$$,
  $$Attendre d'avoir le B2 avant tout$$, $$Demander à ton ancienne école le programme détaillé tamponné$$, $$Démissionner immédiatement$$, $$Acheter un billet d'avion$$,
  1, $$Démarche longue (3-4 semaines), à lancer tôt.$$
FROM public.lessons WHERE lesson_number = 19;

INSERT INTO public.quiz_questions (lesson_id, position, question_text, option_a, option_b, option_c, option_d, correct_index, explanation)
SELECT id, 5, $$Rythme conseillé pour envoyer les candidatures Pflegeheim ?$$,
  $$Toutes d'un coup$$, $$5 à 10 par semaine, progressivement$$, $$Une par mois$$, $$Une seule, sur-mesure$$,
  1, $$5-10 par semaine avec les templates fournis.$$
FROM public.lessons WHERE lesson_number = 19;

COMMIT;
