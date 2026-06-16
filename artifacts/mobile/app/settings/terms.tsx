import { LegalDocumentScreen } from "@/components/LegalDocumentScreen";
import { termsDocument } from "@/lib/legalDocuments";

export default function TermsScreen() {
  return <LegalDocumentScreen document={termsDocument} />;
}
