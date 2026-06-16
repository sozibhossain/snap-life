import { LegalDocumentScreen } from "@/components/LegalDocumentScreen";
import { medicalAiCoachingDisclaimerDocument } from "@/lib/legalDocuments";

export default function DisclaimerScreen() {
  return <LegalDocumentScreen document={medicalAiCoachingDisclaimerDocument} />;
}
