import { Document, Page, Text, View, StyleSheet, Svg, Circle, Path, Image } from '@react-pdf/renderer';
import type { Certificate } from '@/lib/types';

// PDF certificate (A4 landscape, brand colors).
// Polices : on s'appuie sur les Helvetica/Times défaut de @react-pdf
// pour éviter les pb de chargement de fonts custom dans le worker bundle.

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#FFF8F1',
    padding: 50,
    fontFamily: 'Helvetica',
    color: '#1A1A1A',
    position: 'relative',
  },
  border: {
    position: 'absolute',
    top: 24,
    left: 24,
    right: 24,
    bottom: 24,
    borderWidth: 2,
    borderColor: '#F97316',
    borderStyle: 'solid',
  },
  innerBorder: {
    position: 'absolute',
    top: 32,
    left: 32,
    right: 32,
    bottom: 32,
    borderWidth: 0.5,
    borderColor: '#F97316',
    borderStyle: 'solid',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 30, marginBottom: 20, gap: 16 },
  logoCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#F97316', alignItems: 'center', justifyContent: 'center' },
  logoLetter: { fontFamily: 'Times-Italic', fontSize: 36, color: '#FFFFFF' },
  brand: { fontSize: 14, letterSpacing: 6, fontFamily: 'Helvetica-Bold', color: '#1A1A1A' },
  brandSub: { fontSize: 9, letterSpacing: 3, color: '#6B7280', marginTop: 2 },
  title: { fontFamily: 'Times-Italic', fontSize: 36, textAlign: 'center', color: '#1A1A1A', marginTop: 30, letterSpacing: 1 },
  subtitle: { fontSize: 12, textAlign: 'center', color: '#475569', marginTop: 12, letterSpacing: 2 },
  name: { fontFamily: 'Times-BoldItalic', fontSize: 44, textAlign: 'center', color: '#F97316', marginTop: 24 },
  divider: { width: 200, height: 1, backgroundColor: '#F97316', alignSelf: 'center', marginTop: 14 },
  description: { fontSize: 12, textAlign: 'center', color: '#3A3F4D', marginTop: 18, marginHorizontal: 60, lineHeight: 1.6 },
  highlight: { fontFamily: 'Helvetica-Bold', color: '#0D7377' },
  footer: { position: 'absolute', bottom: 60, left: 60, right: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  certBlock: {},
  certLabel: { fontSize: 7, color: '#94A3B8', letterSpacing: 1, marginBottom: 2 },
  certNumber: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#1A1A1A' },
  certDate: { fontSize: 9, color: '#475569', marginTop: 2 },
  signatureBlock: { alignItems: 'center' },
  signatureLine: { width: 180, height: 0.5, backgroundColor: '#1A1A1A' },
  signatureName: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  signatureRole: { fontSize: 8, color: '#6B7280', fontFamily: 'Times-Italic' },
});

interface Props {
  certificate: Certificate;
  programName?: string; // ex : "Deutsch für Pflegekräfte"
}

export function CertificatePDF({ certificate, programName = 'Deutsch für Pflegekräfte' }: Props) {
  const dateStr = new Date(certificate.course_completion_date).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <Document title={`Certificat ${certificate.certificate_number}`} author="Aurel Academy">
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.border} fixed />
        <View style={styles.innerBorder} fixed />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoLetter}>A</Text>
          </View>
          <View>
            <Text style={styles.brand}>AUREL  ACADEMY</Text>
            <Text style={styles.brandSub}>DEUTSCH  FÜR  PFLEGEKRÄFTE</Text>
          </View>
        </View>

        <Text style={styles.title}>Certificat de complétion</Text>
        <Text style={styles.subtitle}>CE CERTIFICAT EST DÉLIVRÉ À</Text>

        <Text style={styles.name}>{certificate.full_name_on_certificate}</Text>

        <View style={styles.divider} />

        <Text style={styles.description}>
          Pour avoir complété avec succès la formation{' '}
          <Text style={styles.highlight}>{programName}</Text>
          {' '}d'une durée de 4h30, comprenant{' '}
          <Text style={styles.highlight}>18 leçons vidéo</Text> et{' '}
          <Text style={styles.highlight}>7 ressources premium</Text>{' '}
          (glossaire 150 termes, templates CV, lettres de motivation, guide Anerkennung, méthode prospection),
          en date du {dateStr}.
        </Text>

        <View style={styles.footer}>
          <View style={styles.certBlock}>
            <Text style={styles.certLabel}>NUMÉRO DE CERTIFICAT</Text>
            <Text style={styles.certNumber}>{certificate.certificate_number}</Text>
            <Text style={styles.certDate}>Émis le {new Date(certificate.issued_at).toLocaleDateString('fr-FR')}</Text>
          </View>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureName}>Aurel</Text>
            <Text style={styles.signatureRole}>Fondateur, Aurel Academy</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
