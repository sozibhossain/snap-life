import { UserProfile } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { AdminLayout } from "@/components/AdminLayout";

/**
 * Admin settings. Clerk's prebuilt <UserProfile /> handles profile edits
 * (name, avatar), password changes, and active-session management — so we
 * don't hand-roll auth-sensitive forms. Hash routing keeps it self-contained
 * within this SPA route.
 *
 * We pass an explicit appearance (with `cssLayerName: "clerk"`) so Clerk's
 * styles land in a predictable CSS layer instead of fighting the admin app's
 * Tailwind preflight — otherwise the multi-panel layout renders cramped.
 */
const userProfileAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "hsl(190 64% 53%)",
    colorForeground: "hsl(201 45% 20%)",
    fontFamily: "var(--font-sans)",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox:
      "w-full max-w-4xl mx-auto border border-border rounded-xl shadow-sm overflow-hidden",
  },
};

export default function SettingsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Update your profile, change your password, and review active
            sessions.
          </p>
        </div>
        <UserProfile routing="hash" appearance={userProfileAppearance} />
      </div>
    </AdminLayout>
  );
}
