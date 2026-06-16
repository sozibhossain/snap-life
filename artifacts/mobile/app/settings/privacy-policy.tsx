import { LegalDocumentScreen } from "@/components/LegalDocumentScreen";
import { privacyPolicyDocument } from "@/lib/legalDocuments";

export default function PrivacyPolicyScreen() {
  return <LegalDocumentScreen document={privacyPolicyDocument} />;
}
