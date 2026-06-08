import { shadcn } from "@clerk/themes";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(190 64% 53%)", // Primary cyan
    colorForeground: "hsl(201 45% 20%)", // Dark navy
    colorMutedForeground: "hsl(200 15% 45%)",
    colorDanger: "hsl(21 90% 57%)", // Warm orange
    colorBackground: "hsl(0 0% 100%)", // Surface white
    colorInput: "hsl(200 20% 98%)", // Pale bg
    colorInputForeground: "hsl(201 45% 20%)",
    colorNeutral: "hsl(200 15% 85%)",
    fontFamily: "var(--font-sans)",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white dark:bg-slate-900 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-md",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold text-slate-900 dark:text-slate-100",
    headerSubtitle: "text-sm text-slate-500",
    socialButtonsBlockButtonText: "text-sm font-medium",
    formFieldLabel: "text-sm font-medium text-slate-700 dark:text-slate-300",
    footerActionLink: "text-sm font-medium text-cyan-600 hover:text-cyan-700",
    footerActionText: "text-sm text-slate-500",
    dividerText: "text-xs text-slate-500",
    identityPreviewEditButton: "text-cyan-600 hover:text-cyan-700",
    formFieldSuccessText: "text-sm text-green-600",
    alertText: "text-sm text-red-600",
    logoBox: "mb-6 flex justify-center",
    logoImage: "h-12 w-auto",
    socialButtonsBlockButton: "border border-slate-200 hover:bg-slate-50",
    formButtonPrimary: "bg-cyan-500 hover:bg-cyan-600 text-white",
    formFieldInput: "rounded-md border border-slate-200 bg-white px-3 py-2",
    footerAction: "mt-6 text-center",
    dividerLine: "bg-slate-200",
    alert: "bg-red-50 border border-red-200 rounded-md p-3",
    otpCodeFieldInput: "border border-slate-200 rounded-md",
    formFieldRow: "mb-4",
    main: "p-6",
  },
};
