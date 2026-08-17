import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Course, Tier } from '@/lib/types';
import { courseLabel, tierLabel } from '@/lib/utils';

export type ActivationDocumentMode = 'quick' | 'full';

interface Props {
  codes: string[];
  documentReferences: Record<string, number>;
  course: Course;
  tier: Tier;
  mode: ActivationDocumentMode;
  activationQr: string;
  telegramQr?: string;
  generatedAt?: Date;
}

const ORANGE = '#F97316';
const NAVY = '#101827';
const INK = '#172033';
const MUTED = '#64748B';
const PALE = '#FFF7ED';
const LINE = '#D9E0E8';
const GREEN = '#0F766E';
const ACTIVATION_URL = 'https://app.aurel-academy.com/activate';
const TELEGRAM_URL = 'https://t.me/+u9xT5AbqazwxODg0';
const SUPPORT_WHATSAPP = '+213 784 24 73 94';

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#FFFFFF',
    color: INK,
    fontFamily: 'Helvetica',
    fontSize: 9,
    paddingBottom: 38,
  },
  pageBody: { paddingHorizontal: 38, paddingTop: 25 },
  darkHeader: {
    height: 93,
    backgroundColor: NAVY,
    paddingHorizontal: 38,
    paddingVertical: 21,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 19, letterSpacing: 4 },
  brandSub: { color: '#CBD5E1', fontSize: 7.5, letterSpacing: 2.1, marginTop: 5 },
  refLabel: { color: '#94A3B8', fontSize: 6.8, textAlign: 'right', letterSpacing: 1.2 },
  refValue: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 4 },
  eyebrow: { color: ORANGE, fontFamily: 'Helvetica-Bold', fontSize: 8, letterSpacing: 1.6 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 25, marginTop: 7 },
  intro: { color: MUTED, fontSize: 10, lineHeight: 1.5, marginTop: 8, maxWidth: 480 },
  stepRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 11 },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ORANGE,
    color: '#FFFFFF',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    textAlign: 'center',
    paddingTop: 6,
    marginRight: 9,
  },
  stepTitle: { fontFamily: 'Helvetica-Bold', fontSize: 13 },
  activationBox: {
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 8,
    padding: 15,
    flexDirection: 'row',
  },
  qrColumn: { width: 145, alignItems: 'center', paddingRight: 14, borderRightWidth: 1, borderRightColor: LINE },
  qr: { width: 100, height: 100 },
  qrSmall: { width: 74, height: 74 },
  qrLabel: { color: MUTED, fontFamily: 'Helvetica-Bold', fontSize: 6.8, letterSpacing: 1, marginBottom: 8 },
  code: { color: ORANGE, fontFamily: 'Helvetica-Bold', fontSize: 21, letterSpacing: 1.6, marginTop: 10 },
  codeHint: { color: MUTED, fontSize: 6.6, marginTop: 5 },
  instructionColumn: { flex: 1, paddingLeft: 17 },
  urlLabel: { color: MUTED, fontFamily: 'Helvetica-Bold', fontSize: 6.8, letterSpacing: 1 },
  url: { color: GREEN, fontFamily: 'Helvetica-Bold', fontSize: 10, marginTop: 5, marginBottom: 10 },
  instruction: { fontSize: 8.8, lineHeight: 1.5, marginBottom: 3 },
  warning: { backgroundColor: PALE, borderLeftWidth: 3, borderLeftColor: ORANGE, padding: 9, marginTop: 11, color: '#7C2D12', fontSize: 7.8, lineHeight: 1.45 },
  helpBox: { backgroundColor: '#F8FAFC', borderRadius: 7, padding: 12, marginTop: 15 },
  helpTitle: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 6 },
  helpText: { color: MUTED, fontSize: 8, lineHeight: 1.5 },
  telegramBox: { flexDirection: 'row', borderWidth: 1, borderColor: LINE, borderRadius: 8, padding: 12, alignItems: 'center' },
  telegramCopy: { flex: 1, paddingRight: 18 },
  telegramTitle: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 5 },
  footer: { position: 'absolute', bottom: 17, left: 38, right: 38, borderTopWidth: 0.7, borderTopColor: LINE, paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', color: MUTED, fontSize: 6.8 },
  simpleHeader: { paddingHorizontal: 38, paddingTop: 27, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: LINE },
  simpleBrand: { fontFamily: 'Helvetica-Bold', fontSize: 14, letterSpacing: 2.5 },
  simpleTitle: { fontFamily: 'Helvetica-Bold', fontSize: 22, marginTop: 14 },
  simpleSubtitle: { color: MUTED, fontSize: 8, marginTop: 5 },
  sectionTitle: { color: ORANGE, fontFamily: 'Helvetica-Bold', fontSize: 9, letterSpacing: 1.1, marginTop: 15, marginBottom: 7 },
  bodyText: { fontSize: 8.5, lineHeight: 1.48, marginBottom: 5 },
  bullet: { fontSize: 8.2, lineHeight: 1.45, marginBottom: 3, paddingLeft: 7 },
  twoColumns: { flexDirection: 'row' },
  column: { width: '50%', paddingRight: 13 },
  columnRight: { width: '50%', paddingLeft: 13 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 2 },
  infoCard: { width: '48%', marginRight: '2%', marginBottom: 8, backgroundColor: '#F8FAFC', borderRadius: 6, padding: 9 },
  infoCardTitle: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, marginBottom: 3 },
  infoCardText: { color: MUTED, fontSize: 7.5, lineHeight: 1.4 },
  commercialRow: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 5 },
  commercialKey: { width: 120, fontFamily: 'Helvetica-Bold', fontSize: 8 },
  commercialValue: { flex: 1, fontSize: 8, lineHeight: 1.35 },
  limitBox: { marginTop: 13, backgroundColor: PALE, borderRadius: 7, padding: 11 },
  article: { marginBottom: 9 },
  articleTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9, marginBottom: 3 },
  articleText: { color: '#334155', fontSize: 7.7, lineHeight: 1.42 },
});

function registrationReference(referenceNumber: number, year: number) {
  return `AA-${year}-${String(referenceNumber).padStart(4, '0')}`;
}

function CommonFooter({ pageLabel }: { pageLabel: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>Aurel Academy · app.aurel-academy.com</Text>
      <Text>{pageLabel}</Text>
    </View>
  );
}

function ActivationPage({
  code,
  course,
  tier,
  activationQr,
  telegramQr,
  generatedAt,
  referenceNumber,
}: Omit<Props, 'codes' | 'mode' | 'documentReferences'> & { code: string; generatedAt: Date; referenceNumber: number }) {
  const reference = registrationReference(referenceNumber, generatedAt.getFullYear());
  const immigration = course === 'immigration';

  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.darkHeader}>
        <View>
          <Text style={styles.brand}>AUREL ACADEMY</Text>
          <Text style={styles.brandSub}>{immigration ? "PARCOURS ALLEMAGNE · DOCUMENT D'ACTIVATION" : "PFLEGE · DOCUMENT D'ACTIVATION"}</Text>
        </View>
        <View>
          <Text style={styles.refLabel}>RÉFÉRENCE DU DOSSIER</Text>
          <Text style={styles.refValue}>{reference}</Text>
        </View>
      </View>

      <View style={styles.pageBody}>
        <Text style={styles.eyebrow}>{courseLabel(course).toUpperCase()} · {tierLabel(tier).toUpperCase()}</Text>
        <Text style={styles.title}>Activez votre programme</Text>
        <Text style={styles.intro}>Votre parcours commence maintenant. Suivez les étapes ci-dessous pour accéder à votre formation et à votre espace étudiant.</Text>

        <View style={styles.stepRow}>
          <Text style={styles.stepNumber}>1</Text>
          <Text style={styles.stepTitle}>Accéder à la plateforme</Text>
        </View>

        <View style={styles.activationBox}>
          <View style={styles.qrColumn}>
            <Text style={styles.qrLabel}>SCANNEZ POUR ACTIVER</Text>
            <Image style={styles.qr} src={activationQr} />
            <Text style={styles.code}>{code}</Text>
            <Text style={styles.codeHint}>À usage unique · personnel · sans expiration</Text>
          </View>
          <View style={styles.instructionColumn}>
            <Text style={styles.urlLabel}>OU RENDEZ-VOUS SUR</Text>
            <Text style={styles.url}>{ACTIVATION_URL}</Text>
            <Text style={styles.instruction}>1. Scannez le QR code ou ouvrez le lien ci-dessus.</Text>
            <Text style={styles.instruction}>2. Entrez votre code personnel.</Text>
            <Text style={styles.instruction}>3. Créez votre compte et votre mot de passe.</Text>
            <Text style={styles.instruction}>4. Connectez-vous puis commencez le programme.</Text>
            <Text style={styles.warning}>Ce code est personnel et utilisable une seule fois. Ne le partagez pas et ne diffusez pas ce document.</Text>
          </View>
        </View>

        {immigration && telegramQr ? (
          <>
            <View style={styles.stepRow}>
              <Text style={styles.stepNumber}>2</Text>
              <Text style={styles.stepTitle}>Rejoindre l'espace privé Telegram</Text>
            </View>
            <View style={styles.telegramBox}>
              <View style={styles.telegramCopy}>
                <Text style={styles.telegramTitle}>Annonces, sessions en direct et informations importantes</Text>
                <Text style={styles.helpText}>Scannez le QR code ou ouvrez {TELEGRAM_URL}. Consultez régulièrement cet espace complémentaire.</Text>
              </View>
              <Image style={styles.qrSmall} src={telegramQr} />
            </View>
          </>
        ) : null}

        <View style={styles.helpBox}>
          <Text style={styles.helpTitle}>Le code ne fonctionne pas ?</Text>
          <Text style={styles.helpText}>Écrivez-nous sur WhatsApp au {SUPPORT_WHATSAPP} avec la référence {reference}, une capture d'écran du message et le numéro utilisé lors de la commande. Ne créez pas un second compte.</Text>
        </View>
      </View>

      <CommonFooter pageLabel={`Code ${code}`} />
    </Page>
  );
}

function ProgramSheet({ code, tier }: { code: string; tier: Tier }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.simpleHeader}>
        <Text style={styles.simpleBrand}>AUREL ACADEMY</Text>
        <Text style={styles.simpleTitle}>Fiche technique du programme</Text>
        <Text style={styles.simpleSubtitle}>Programme Aurel Academy — Parcours Allemagne</Text>
      </View>
      <View style={styles.pageBody}>
        <Text style={styles.sectionTitle}>OBJECTIF DU PROGRAMME</Text>
        <Text style={styles.bodyText}>Le programme Aurel Academy aide l'apprenant à comprendre, structurer et préparer son projet vers l'Allemagne selon son profil, son métier, son niveau de langue et la voie qui lui correspond.</Text>

        <View style={styles.twoColumns}>
          <View style={styles.column}>
            <Text style={styles.sectionTitle}>CONTENU INCLUS</Text>
            {[
              'Modules principaux 0 à 10', 'Identification de la voie adaptée', 'Conditions liées aux diplômes et qualifications',
              'Reconnaissance des qualifications (Anerkennung)', "Stratégie d'apprentissage de l'allemand", 'Préparation des documents',
              'CV et candidature en Allemagne', "Recherche d'un employeur ou d'une formation", 'Compréhension de la procédure de visa',
              "Préparation à l'entretien", 'Financement et compte bloqué (Sperrkonto)', "Premières démarches après l'arrivée",
            ].map((item) => <Text key={item} style={styles.bullet}>• {item}</Text>)}
          </View>
          <View style={styles.columnRight}>
            <Text style={styles.sectionTitle}>RESSOURCES ET ACCOMPAGNEMENT</Text>
            {[
              'Modules spécialisés par métier', 'Tutoriels pratiques', 'Modèles et checklists', 'Sessions collectives en direct',
              'Espace Telegram privé', 'Accompagnement pédagogique', 'Corrections et mises à jour importantes',
            ].map((item) => <Text key={item} style={styles.bullet}>• {item}</Text>)}
          </View>
        </View>

        <Text style={styles.sectionTitle}>MODES D'ACCÈS</Text>
        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>01 · Plateforme principale</Text>
            <Text style={styles.infoCardText}>Espace officiel de progression contenant les modules, tutoriels et ressources dans l'ordre pédagogique recommandé.</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>02 · Espace privé Telegram</Text>
            <Text style={styles.infoCardText}>Espace complémentaire pour les annonces, nouvelles informations, sessions en direct et contenus communiqués par Aurel Academy.</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>INFORMATIONS COMMERCIALES</Text>
        {[
          // Use an ordinary space here. Intl's French narrow no-break space
          // is rendered as a slash by the built-in PDF Helvetica font.
          ['Prix total', '38 000 DZD'],
          ['Livraison', 'Gratuite'],
          ['Paiement', 'Paiement intégral à la réception, par CCP, BaridiMob ou virement bancaire.'],
          ['Activation', "Code personnel à usage unique, sans date d'expiration."],
          ['Accès', 'Plateforme et Telegram accessibles tant que le programme est maintenu en ligne.'],
          ['Accompagnement', 'Accompagnement collectif inclus selon les modalités du programme.'],
        ].map(([key, value]) => (
          <View key={key} style={styles.commercialRow}>
            <Text style={styles.commercialKey}>{key}</Text>
            <Text style={styles.commercialValue}>{value}</Text>
          </View>
        ))}

        <View style={styles.limitBox}>
          <Text style={styles.infoCardTitle}>LIMITES DU PROGRAMME</Text>
          <Text style={styles.infoCardText}>Aurel Academy fournit une formation, des outils et un accompagnement pédagogique. Le programme ne garantit pas l'obtention d'un visa, d'un emploi, d'une admission, d'une reconnaissance de diplôme, d'un contrat de formation ou d'un titre de séjour. Les décisions officielles appartiennent aux autorités et organismes compétents.</Text>
        </View>
      </View>
      <CommonFooter pageLabel={`Dossier ${code} · Page 2/4`} />
    </Page>
  );
}

const RULES_PAGE_ONE = [
  ["Article 1 — Objet", "Le présent règlement définit les conditions d'accès et d'utilisation du programme Aurel Academy acheté au prix de 38 000 DZD."],
  ["Article 2 — Accès numériques", "L'inscription donne accès à la plateforme Aurel Academy, à l'espace privé Telegram ainsi qu'aux ressources, tutoriels et sessions annoncés dans la fiche technique. Ces espaces font partie du même programme."],
  ["Article 3 — Code personnel", "Le code d'activation est personnel, confidentiel et utilisable une seule fois. Il est interdit de le partager, le revendre, le publier, permettre à un tiers de l'utiliser ou transférer son compte."],
  ["Article 4 — Partage du contenu", "Les vidéos, documents, modèles, liens privés, directs, replays et ressources restent la propriété d'Aurel Academy. Leur redistribution, revente, republication ou transmission à une personne non inscrite est interdite."],
  ["Article 5 — Espace Telegram", "Telegram est un espace complémentaire de diffusion, de secours et d'accompagnement. La plateforme reste la référence pour l'ordre des modules et les versions officielles. Les contenus partagés sont réservés à l'usage personnel de l'apprenant."],
  ["Article 6 — Sessions en direct", "Les dates, horaires et liens sont annoncés sur Telegram. L'apprenant doit consulter les annonces, rejoindre la session à l'heure et disposer d'une connexion suffisante. Un replay n'est garanti que lorsqu'il est annoncé."],
  ["Article 7 — Accompagnement", "L'accompagnement correspond aux services décrits dans la fiche technique. Aurel Academy ne remplace pas une ambassade, une administration, un avocat, une université, un employeur ou une autorité de reconnaissance."],
  ["Article 8 — Informations et mises à jour", "Les procédures peuvent évoluer selon la date, le métier, le diplôme, le visa, le Bundesland ou l'autorité. L'apprenant doit vérifier les exigences officielles avant toute décision importante."],
] as const;

const RULES_PAGE_TWO = [
  ["Article 9 — Comportement", "Les membres doivent respecter les formateurs, administrateurs et étudiants. Les insultes, le harcèlement, la publicité non autorisée, le démarchage, les fausses informations et le partage de données personnelles sont interdits."],
  ["Article 10 — Suspension", "Aurel Academy peut suspendre un accès en cas de partage de compte, fraude, revente, diffusion non autorisée, comportement grave ou violation répétée du règlement."],
  ["Article 11 — Paiement et livraison", "Le prix total est de 38 000 DZD et la livraison du document d'activation est gratuite. En cas de document endommagé ou de code illisible ou déjà utilisé, un nouveau code peut être émis après vérification."],
  ["Article 12 — Activation et remboursement", "L'activation donne un accès immédiat au contenu numérique. Aucun remboursement n'est possible après activation. Toute demande doit être adressée au support avec la référence du dossier."],
  ["Article 13 — Durée et maintien de l'accès", "L'accès est accordé tant que le programme est maintenu en ligne. En cas d'interruption définitive, Aurel Academy communiquera un préavis permettant la consultation des ressources disponibles."],
  ["Article 14 — Résultats", "Le programme donne accès à une formation, une méthode, des ressources et un accompagnement, sans garantie de résultat. Les résultats dépendent du profil, du travail de l'apprenant et des décisions des organismes compétents."],
  ["Article 15 — Acceptation", "L'activation du code et l'utilisation de la plateforme confirment que l'apprenant a reçu et accepté la fiche technique, les modalités d'accès et le présent règlement."],
] as const;

function RulesPage({ code, second }: { code: string; second?: boolean }) {
  const articles = second ? RULES_PAGE_TWO : RULES_PAGE_ONE;
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.simpleHeader}>
        <Text style={styles.simpleBrand}>AUREL ACADEMY</Text>
        <Text style={styles.simpleTitle}>Règlement du programme</Text>
        <Text style={styles.simpleSubtitle}>{second ? 'Suite — articles 9 à 15' : "Merci de lire ces règles avant l'activation de votre accès."}</Text>
      </View>
      <View style={styles.pageBody}>
        <View style={styles.twoColumns}>
          <View style={styles.column}>
            {articles.slice(0, Math.ceil(articles.length / 2)).map(([title, body]) => (
              <View key={title} style={styles.article} wrap={false}>
                <Text style={styles.articleTitle}>{title}</Text>
                <Text style={styles.articleText}>{body}</Text>
              </View>
            ))}
          </View>
          <View style={styles.columnRight}>
            {articles.slice(Math.ceil(articles.length / 2)).map(([title, body]) => (
              <View key={title} style={styles.article} wrap={false}>
                <Text style={styles.articleTitle}>{title}</Text>
                <Text style={styles.articleText}>{body}</Text>
              </View>
            ))}
          </View>
        </View>
        {second ? (
          <View style={styles.helpBox}>
            <Text style={styles.helpTitle}>Aurel Academy · Parcours Allemagne</Text>
            <Text style={styles.helpText}>Support : {SUPPORT_WHATSAPP} · E-mail : contact@aurelacademy.com</Text>
          </View>
        ) : null}
      </View>
      <CommonFooter pageLabel={`Dossier ${code} · Page ${second ? '4/4' : '3/4'}`} />
    </Page>
  );
}

export function ActivationCodesPDF({
  codes,
  documentReferences,
  course,
  tier,
  mode,
  activationQr,
  telegramQr,
  generatedAt = new Date(),
}: Props) {
  const fullDossier = mode === 'full' && course === 'immigration';

  return (
    <Document
      title={`Documents d'activation Aurel Academy — ${courseLabel(course)}`}
      author="Aurel Academy"
      subject={`${codes.length} code(s) d'activation`}
      creator="Aurel Academy Admin"
    >
      {codes.map((code) => (
        <DocumentPages
          key={code}
          code={code}
          referenceNumber={documentReferences[code]}
          course={course}
          tier={tier}
          activationQr={activationQr}
          telegramQr={telegramQr}
          generatedAt={generatedAt}
          fullDossier={fullDossier}
        />
      ))}
    </Document>
  );
}

function DocumentPages({
  code,
  course,
  tier,
  activationQr,
  telegramQr,
  generatedAt,
  fullDossier,
  referenceNumber,
}: Omit<Props, 'codes' | 'mode' | 'documentReferences'> & { code: string; generatedAt: Date; fullDossier: boolean; referenceNumber: number }) {
  return (
    <>
      <ActivationPage code={code} course={course} tier={tier} activationQr={activationQr} telegramQr={telegramQr} generatedAt={generatedAt} referenceNumber={referenceNumber} />
      {fullDossier ? (
        <>
          <ProgramSheet code={code} tier={tier} />
          <RulesPage code={code} />
          <RulesPage code={code} second />
        </>
      ) : null}
    </>
  );
}
