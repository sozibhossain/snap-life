export type LegalSection = {
  title: string;
  body: string[];
};

export type LegalDocument = {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
};

export const SNAP_CONTACT_EMAIL = "teamsnap@snaplife.co.uk";
export const SNAP_WEBSITE = "www.snaplife.co.uk";

export const privacyPolicyDocument: LegalDocument = {
  title: "Privacy Policy",
  lastUpdated: "June 2026",
  intro:
    "SNAP Life is a digital health and wellbeing platform designed to support bone health, healthy ageing, mobility, nutrition, wellness, education, and lifestyle management. This policy explains what information we collect, how we use it, how we protect it, your privacy rights, and how to contact us.",
  sections: [
    {
      title: "1. Information we collect",
      body: [
        "When you create an account or use SNAP Life, we may collect your name, email address, date of birth or age range, country or location, profile details, bone health information, DEXA scan results, FRAX assessment data, medication and supplement information, nutrition information, activity and movement information, wellness entries, coaching or consultation requests, and customer support communications.",
        "We may also collect device information, operating system, browser information, IP address, app version, usage activity, feature engagement, diagnostic information, crash reports, and analytics data.",
        "For subscriptions, we may process subscription status, transaction identifiers, and purchase history. Payment card details are processed by authorised third-party payment providers and are not stored by SNAP Life.",
      ],
    },
    {
      title: "2. Health and wellness information",
      body: [
        "Some information you provide may be health-related, including bone health information, DEXA results, FRAX assessments, medication information, supplement information, activity and movement data, and wellness or wellbeing information.",
        "SNAP Life processes this information only to provide personalised experiences, educational content, tracking features, and wellness support. SNAP Life does not provide medical diagnosis, treatment, or healthcare services.",
      ],
    },
    {
      title: "3. How we use your information",
      body: [
        "We use your information to create and manage your account, personalise your experience, provide Bone Buddy AI functionality, deliver educational content, provide tracking tools and insights, support subscriptions and billing, improve platform performance, deliver notifications and reminders, respond to support requests, facilitate coaching and expert consultations, conduct analytics and research, and comply with legal obligations.",
      ],
    },
    {
      title: "4. Bone Buddy AI",
      body: [
        "Information submitted to Bone Buddy AI may be processed to generate responses, personalise support, improve user experience, and enhance platform functionality.",
        "Bone Buddy AI is an educational and wellness companion. It is not a healthcare professional and should not be relied upon for diagnosis, treatment, or medical decision-making.",
      ],
    },
    {
      title: "5. Legal basis for processing",
      body: [
        "Where required by applicable law, we process personal information based on your consent, performance of a contract, legitimate business interests, legal obligations, and protection of vital interests.",
      ],
    },
    {
      title: "6. Sharing information",
      body: [
        "We do not sell personal information.",
        "We may share information with service providers including authentication, cloud hosting, analytics, email, customer support, AI, and subscription management providers.",
        "Where you request support from consultants, coaches, or experts, information may be shared with those professionals solely to facilitate the requested service. We may also disclose information where required by law or to protect rights, safety, or security.",
      ],
    },
    {
      title: "7. International transfers",
      body: [
        "SNAP Life operates globally. Your information may be transferred to and processed in countries outside your country of residence. Where required, we implement appropriate safeguards including contractual protections and recognised international data transfer mechanisms.",
      ],
    },
    {
      title: "8. Data security",
      body: [
        "We maintain administrative, technical, and organisational measures designed to protect personal information against unauthorised access, disclosure, alteration, loss, and misuse. However, no system can guarantee absolute security.",
      ],
    },
    {
      title: "9. Data retention",
      body: [
        "We retain personal information only as long as necessary to provide services, fulfil legal obligations, resolve disputes, and enforce agreements. When information is no longer required, it will be securely deleted or anonymised.",
      ],
    },
    {
      title: "10. Your privacy rights",
      body: [
        "Depending on your location, you may have rights to access your information, correct inaccurate information, delete your information, restrict processing, object to processing, withdraw consent, request data portability, and lodge complaints with regulators.",
        `You may exercise these rights by contacting ${SNAP_CONTACT_EMAIL}.`,
      ],
    },
    {
      title: "11. California privacy rights",
      body: [
        "California residents may have additional rights including the right to know, delete, correct, limit certain processing, and be free from discrimination for exercising privacy rights. SNAP Life does not sell personal information.",
      ],
    },
    {
      title: "12. Children's privacy",
      body: [
        "SNAP Life is intended for adults. We do not knowingly collect personal information from individuals under the age of 16 without appropriate consent where required by law. If we become aware that such information has been collected improperly, we will delete it.",
      ],
    },
    {
      title: "13. Cookies and similar technologies",
      body: [
        "SNAP Life and associated websites may use cookies, analytics tools, device identifiers, and similar technologies to improve functionality, understand usage, enhance security, and deliver services. Users may manage cookie preferences through browser settings where applicable.",
      ],
    },
    {
      title: "14. Marketing communications",
      body: [
        "Where permitted by law and with appropriate consent, we may send educational updates, product updates, wellness content, and promotional communications. You may unsubscribe at any time using the links provided or by contacting us.",
      ],
    },
    {
      title: "15. Changes to this policy",
      body: [
        "We may update this Privacy Policy from time to time. Updated versions will be posted within the app and on our website. The effective date at the top of this document will indicate the latest revision.",
      ],
    },
    {
      title: "16. Contact us",
      body: [
        `For privacy-related questions, requests, or concerns, contact SNAP Life at ${SNAP_CONTACT_EMAIL}. Website: ${SNAP_WEBSITE}.`,
      ],
    },
    {
      title: "17. Medical and health disclaimer",
      body: [
        "SNAP Life provides educational, informational, wellness, and lifestyle support only. SNAP Life, Bone Buddy AI, coaching services, educational content, tracking tools, assessments, and expert support features are not intended to diagnose, treat, cure, or prevent any disease.",
        "Users should always seek advice from qualified healthcare professionals regarding medical conditions, symptoms, medications, treatment decisions, or healthcare concerns. If you believe you are experiencing a medical emergency, contact emergency services or your healthcare provider immediately.",
      ],
    },
  ],
};

export const termsDocument: LegalDocument = {
  title: "Terms & Conditions",
  lastUpdated: "June 2026",
  intro:
    "These Terms & Conditions govern your access to and use of the SNAP Life website, mobile applications, content, services, subscriptions, coaching services, educational resources, AI tools, and related features. By creating an account, accessing, or using SNAP Life, you agree to be bound by these terms.",
  sections: [
    {
      title: "1. Eligibility",
      body: [
        "You must be at least 18 years old to create an account and use SNAP Life. By using SNAP Life, you confirm that you are at least 18 years of age, the information you provide is accurate and current, and you will maintain the security of your account credentials.",
      ],
    },
    {
      title: "2. Purpose of SNAP Life",
      body: [
        "SNAP Life is designed to provide educational content, wellness support, healthy ageing guidance, bone health information, lifestyle tools, habit tracking, AI-supported wellness guidance, and coaching or expert support access.",
        "SNAP Life does not provide medical care, diagnosis, treatment, or healthcare services.",
      ],
    },
    {
      title: "3. Medical disclaimer",
      body: [
        "All information provided through SNAP Life is intended for educational and informational purposes only. SNAP Life does not diagnose medical conditions, provide medical treatment, prescribe medication, or replace healthcare professionals.",
        "Users should always seek advice from qualified healthcare professionals regarding medical concerns, symptoms, diagnosis, treatment decisions, medication changes, and healthcare emergencies. In an emergency, contact emergency services immediately.",
      ],
    },
    {
      title: "4. Bone Buddy AI",
      body: [
        "Bone Buddy AI is an educational and wellness companion. It does not provide medical advice, diagnose conditions, or replace healthcare professionals.",
        "Users acknowledge that AI-generated responses may contain inaccuracies and should not be relied upon for healthcare decisions. SNAP Life accepts no responsibility for actions taken based solely on AI-generated content.",
      ],
    },
    {
      title: "5. User accounts",
      body: [
        "Users are responsible for maintaining account confidentiality, protecting passwords, and ensuring account information remains accurate. Users must notify SNAP Life immediately of any suspected unauthorised access.",
        "SNAP Life reserves the right to suspend or terminate accounts where misuse is suspected.",
      ],
    },
    {
      title: "6. Subscriptions",
      body: [
        "SNAP Life may offer free access, free trials, SNAP Plus subscriptions, and SNAP Premium subscriptions. Subscription pricing will be displayed within the app and may be updated from time to time.",
        "Where trials are offered, trial periods apply only to eligible users, payment details may be required at registration, and users may cancel before the trial ends to avoid charges. Unless cancelled before the trial period expires, subscriptions may automatically renew.",
        "Subscriptions automatically renew unless cancelled through the relevant app store or payment provider before the renewal date. Refund requests are subject to Apple App Store policies, Google Play Store policies, and applicable consumer protection laws.",
      ],
    },
    {
      title: "7. Coaching services",
      body: [
        "Coaching services available through SNAP Life are not therapy, counselling, medical treatment, or psychological treatment. Coaching is intended to support personal development, wellbeing, behaviour change, and healthy ageing. Results cannot be guaranteed.",
      ],
    },
    {
      title: "8. Expert support",
      body: [
        "SNAP Life may facilitate introductions to third-party experts, consultants, nutrition professionals, coaches, or specialists. Any advice, guidance, or services provided by third parties remain the responsibility of those professionals. Users engage with experts at their own discretion.",
      ],
    },
    {
      title: "9. User content",
      body: [
        "Users may submit messages, feedback, reviews, goals, tracking information, and wellness information. Users retain ownership of their content.",
        "By submitting content, users grant SNAP Life a licence to use that content solely for the purpose of providing services and improving the platform. Users must not submit illegal, harmful, defamatory, offensive, or infringing material.",
      ],
    },
    {
      title: "10. Acceptable use",
      body: [
        "Users must not misuse the platform, attempt unauthorised access, reverse engineer systems, distribute malicious software, abuse AI functionality, or interfere with platform operation. SNAP Life reserves the right to suspend accounts that breach these terms.",
      ],
    },
    {
      title: "11. Intellectual property",
      body: [
        "All content within SNAP Life, including branding, logos, graphics, educational materials, AI experiences, audio content, pathways, and software, remains the property of SNAP Life or its licensors. Users may not reproduce, distribute, or commercially exploit content without written permission.",
      ],
    },
    {
      title: "12. Availability",
      body: [
        "SNAP Life aims to provide reliable access but does not guarantee uninterrupted availability. We may modify services, update features, remove features, or suspend services temporarily for maintenance where necessary.",
      ],
    },
    {
      title: "13. Limitation of liability",
      body: [
        "To the fullest extent permitted by law, SNAP Life shall not be liable for indirect losses, consequential losses, loss of profits, loss of business opportunity, health outcomes, decisions based on educational content, decisions based on AI-generated content, third-party professional services, or use of SNAP Life.",
        "Use of SNAP Life is at the user's own risk. Nothing in these terms excludes liability where such exclusion is prohibited by law.",
      ],
    },
    {
      title: "14. Indemnity",
      body: [
        "Users agree to indemnify and hold harmless SNAP Life, its directors, employees, contractors, and partners from claims arising from misuse of the platform, breach of these terms, unlawful activity, or violation of third-party rights.",
      ],
    },
    {
      title: "15. Termination",
      body: [
        "SNAP Life may suspend or terminate access where these terms are breached, fraud is suspected, or platform security is threatened. Users may stop using SNAP Life at any time. Termination does not affect accrued rights and obligations.",
      ],
    },
    {
      title: "16. International users",
      body: [
        "SNAP Life is available globally. Users are responsible for ensuring use complies with local laws applicable within their jurisdiction.",
      ],
    },
    {
      title: "17. Changes to terms",
      body: [
        "We may update these terms periodically. Updated versions will be published within the app and on our website. Continued use after updates constitutes acceptance of the revised terms.",
      ],
    },
    {
      title: "18. Governing law",
      body: [
        "These terms shall be governed by and interpreted in accordance with the laws of England and Wales, unless mandatory local consumer protection laws apply within the user's jurisdiction. Any disputes shall be subject to the jurisdiction of the courts of England and Wales.",
      ],
    },
    {
      title: "19. Contact information",
      body: [
        `SNAP Life website: ${SNAP_WEBSITE}. Support and general enquiries: ${SNAP_CONTACT_EMAIL}.`,
      ],
    },
    {
      title: "20. Acknowledgement",
      body: [
        "By creating an account or using SNAP Life, you acknowledge that you have read these Terms & Conditions, understand the Medical Disclaimer and Bone Buddy AI Disclaimer, and understand that SNAP Life is an educational, wellness, and healthy ageing platform and not a healthcare provider.",
      ],
    },
  ],
};

export const medicalAiCoachingDisclaimerDocument: LegalDocument = {
  title: "Medical, AI & Coaching Disclaimer",
  lastUpdated: "June 2026",
  intro:
    "Please read this disclaimer carefully before using SNAP Life, Bone Buddy AI, coaching services, educational content, wellness programmes, tracking tools, assessments, consultant support services, or any other features available through the SNAP Life platform.",
  sections: [
    {
      title: "1. Educational and informational purposes only",
      body: [
        "SNAP Life is designed to provide educational, informational, lifestyle, wellbeing, healthy ageing, and wellness support. Educational pathways, bone health information, nutrition information, movement guidance, wellness content, community content, coaching services, consultant support, Bone Buddy AI, tracking tools, assessments, and recommendations are provided for general educational and informational purposes only.",
        "SNAP Life is not a healthcare provider.",
      ],
    },
    {
      title: "2. No medical advice",
      body: [
        "Nothing within SNAP Life should be considered medical advice, clinical advice, healthcare advice, professional medical guidance, diagnosis, treatment, medical opinion, or prescription advice.",
        "Information provided through SNAP Life should never be used as a substitute for consultation with qualified healthcare professionals such as your doctor, GP, specialist consultant, pharmacist, registered dietitian, physiotherapist, or other qualified healthcare professional.",
      ],
    },
    {
      title: "3. No doctor-patient relationship",
      body: [
        "Use of SNAP Life does not create a doctor-patient, clinician-patient, healthcare provider, or therapeutic relationship between users and SNAP Life, Bone Buddy AI, consultants, coaches, contributors, advisors, or educational experts unless separately agreed under a formal professional engagement.",
      ],
    },
    {
      title: "4. Emergency situations",
      body: [
        "SNAP Life is not designed to respond to emergencies. If you believe you are experiencing a medical emergency, chest pain, difficulty breathing, loss of consciousness, stroke symptoms, serious injury, severe mental health crisis, thoughts of self-harm, or any urgent medical condition, seek immediate assistance from emergency services or your local healthcare provider.",
        "Do not rely on SNAP Life, Bone Buddy AI, coaching services, or educational content during an emergency.",
      ],
    },
    {
      title: "5. Bone Buddy AI disclaimer",
      body: [
        "Bone Buddy AI is an artificial intelligence-powered educational and wellness support tool. It is not a doctor, clinician, healthcare professional, or therapist. It does not diagnose medical conditions, prescribe treatments, interpret medical tests clinically, or replace professional advice.",
        "Artificial intelligence systems may generate incomplete, inaccurate, outdated, or inappropriate information. Users should independently verify information and consult qualified healthcare professionals before taking action. Users remain solely responsible for decisions made based on AI-generated content.",
      ],
    },
    {
      title: "6. DEXA, FRAX and health assessments",
      body: [
        "Tools that record DEXA scan information, calculate FRAX scores, monitor bone health indicators, or track health-related information are provided solely for educational, informational, tracking, and self-management purposes.",
        "Results are not diagnoses, do not constitute medical advice, should not be interpreted as clinical recommendations, and should always be reviewed with qualified healthcare professionals.",
      ],
    },
    {
      title: "7. Nutrition, supplements and medication information",
      body: [
        "Information about nutrition, supplements, vitamins, minerals, medication tracking, and lifestyle recommendations is provided for educational purposes only. SNAP Life does not recommend medication changes, prescribe supplements, provide pharmaceutical advice, or guarantee outcomes.",
        "Users should consult appropriate healthcare professionals before starting, stopping, or adjusting supplements or medications.",
      ],
    },
    {
      title: "8. Exercise, movement and wellness activities",
      body: [
        "Exercise guidance, movement suggestions, mobility content, breathing exercises, wellness programmes, and meditation sessions are voluntary and undertaken at the user's own risk.",
        "Users should seek medical advice before beginning any exercise, movement, rehabilitation, or wellness programme. Stop immediately and seek professional advice if you experience pain, dizziness, breathlessness, injury, discomfort, or adverse symptoms.",
      ],
    },
    {
      title: "9. Coaching disclaimer",
      body: [
        "Systemic coaching and coaching services support personal development, healthy ageing, confidence, wellbeing, lifestyle change, behaviour change, and goal setting.",
        "Coaching is not therapy, counselling, psychotherapy, medical treatment, mental health treatment, or clinical intervention. Coaches do not diagnose, treat, or manage medical or psychological conditions. No specific results can be guaranteed.",
      ],
    },
    {
      title: "10. Consultant and expert services",
      body: [
        "SNAP Life may provide access to bone health consultants, nutritionists, coaches, wellness experts, and guest specialists. Any opinions, recommendations, services, or information provided by those professionals remain their own responsibility.",
        "SNAP Life does not guarantee outcomes, advice accuracy, suitability of recommendations, or professional results.",
      ],
    },
    {
      title: "11. No guarantees or promises",
      body: [
        "SNAP Life does not guarantee improved health outcomes, prevention of disease, prevention of fractures, weight loss, increased bone density, symptom improvement, clinical outcomes, or behavioural outcomes. Individual experiences and results will vary.",
      ],
    },
    {
      title: "12. Limitation of liability",
      body: [
        "To the fullest extent permitted by applicable law, SNAP Life and its founders, directors, employees, contractors, advisors, consultants, coaches, contributors, licensors, and partners shall not be liable for medical decisions, treatment decisions, health outcomes, injuries, losses, damages, reliance on AI-generated content, reliance on educational content, reliance on coaching services, reliance on consultant recommendations, or use of SNAP Life.",
        "Use of SNAP Life is entirely at the user's own risk. Nothing within this disclaimer excludes liability where exclusion is prohibited by law.",
      ],
    },
    {
      title: "13. Global use",
      body: [
        "SNAP Life is intended for use globally. Healthcare regulations, medical guidance, supplement recommendations, medication availability, and clinical practices may differ between countries and jurisdictions. Local healthcare advice should always take precedence over information provided through SNAP Life.",
      ],
    },
    {
      title: "14. Acceptance",
      body: [
        "By using SNAP Life, Bone Buddy AI, coaching services, consultant support services, educational resources, assessments, tracking tools, or associated features, you acknowledge that you have read and understood this disclaimer, understand SNAP Life is not a healthcare provider, understand Bone Buddy AI is not a medical professional, understand coaching is not therapy or medical treatment, accept responsibility for your own health and wellbeing decisions, and agree to use SNAP Life at your own discretion and risk.",
        `For questions regarding this disclaimer, contact ${SNAP_CONTACT_EMAIL}.`,
      ],
    },
  ],
};
