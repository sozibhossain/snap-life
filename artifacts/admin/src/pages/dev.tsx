import React, { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Copy,
  FlaskConical,
  KeyRound,
  RefreshCw,
  Search,
  UserPlus,
  XCircle,
} from "lucide-react";
import { getGetAdminUserLookupQueryOptions } from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const isStaging = import.meta.env.VITE_SNAP_LIFE_ENV === "staging";

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1">
      <CheckCircle2 className="h-3 w-3" /> {label}
    </Badge>
  ) : (
    <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200 gap-1">
      <XCircle className="h-3 w-3" /> {label}
    </Badge>
  );
}

function ResultBox({ children, variant = "info" }: { children: React.ReactNode; variant?: "info" | "success" | "error" | "warning" }) {
  const cls = {
    info:    "border-blue-200 bg-blue-50 text-blue-800",
    success: "border-green-200 bg-green-50 text-green-800",
    error:   "border-destructive/30 bg-destructive/10 text-destructive",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
  }[variant];
  return <div className={`rounded-md border p-3 text-sm ${cls}`}>{children}</div>;
}

export default function DevPage() {
  const { getToken } = useAuth();

  // ── Quick Impersonation ───────────────────────────────────────────────────
  const [impEmail, setImpEmailInput] = useState("");
  const [impSearchEmail, setImpSearchEmail] = useState("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenResult, setTokenResult] = useState<string | null>(null);

  const lookupQuery = useQuery({
    ...getGetAdminUserLookupQueryOptions({ email: impSearchEmail }),
    enabled: impSearchEmail.length > 0,
    retry: false,
  });
  const user = lookupQuery.data?.user;

  const handleImpSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = impEmail.trim();
    if (trimmed && trimmed !== impSearchEmail) {
      setImpSearchEmail(trimmed);
      setTokenResult(null);
    }
  };

  const handleGenerateToken = async () => {
    if (!user?.clerkUserId) return;
    setTokenLoading(true);
    setTokenResult(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/users/${user.clerkUserId}/sign-in-token`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as { token: string };
      setTokenResult(j.token);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate token",
      );
    } finally {
      setTokenLoading(false);
    }
  };

  const handleCopyToken = () => {
    if (!tokenResult) return;
    navigator.clipboard.writeText(tokenResult).then(() => {
      toast.success("Sign-in token copied to clipboard");
    });
  };

  // ── Test Account Provisioning (staging only) ──────────────────────────────
  const [taEmail, setTaEmail] = useState("");
  const [taName, setTaName] = useState("");
  const [taLoading, setTaLoading] = useState(false);
  const [taResult, setTaResult] = useState<{ appUserId: string; created: boolean } | null>(null);

  const handleProvisionTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taEmail.trim() || !taName.trim()) return;
    setTaLoading(true);
    setTaResult(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/test-accounts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: taEmail.trim(), displayName: taName.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setTaResult(j as { appUserId: string; created: boolean });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to provision test account",
      );
    } finally {
      setTaLoading(false);
    }
  };

  // ── Account Reset (staging only) ─────────────────────────────────────────
  const [resetEmail, setResetEmail] = useState("");
  const [resetSearchEmail, setResetSearchEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const resetLookup = useQuery({
    ...getGetAdminUserLookupQueryOptions({ email: resetSearchEmail }),
    enabled: resetSearchEmail.length > 0,
    retry: false,
  });
  const resetUser = resetLookup.data?.user;

  const handleResetSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = resetEmail.trim();
    if (trimmed && trimmed !== resetSearchEmail) {
      setResetSearchEmail(trimmed);
    }
  };

  const handleReset = async () => {
    if (!resetUser?.clerkUserId) return;
    setResetConfirmOpen(false);
    setResetLoading(true);
    try {
      const token = await getToken();
      // Uses the impersonation token to call /api/me/reset on behalf of the user.
      // First generate a sign-in token so we can act as them.
      const tokenRes = await fetch(`/api/admin/users/${resetUser.clerkUserId}/sign-in-token`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!tokenRes.ok) throw new Error("Could not generate sign-in token for reset");
      const { token: userToken } = (await tokenRes.json()) as { token: string };

      // Exchange the sign-in token for a session token via Clerk.
      // We call the API directly with the admin token instead, using the
      // dedicated admin reset endpoint.
      const resetRes = await fetch(`/api/admin/users/${resetUser.appUserId}/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ _signInToken: userToken }),
      });

      if (!resetRes.ok) {
        const j = await resetRes.json().catch(() => ({}));
        // Fall back to a friendly message for 404 (staging-only endpoint)
        if (resetRes.status === 404) {
          throw new Error("Account reset is only available in the staging environment.");
        }
        throw new Error((j as { error?: string }).error ?? `HTTP ${resetRes.status}`);
      }
      const j = (await resetRes.json()) as { ok?: boolean; resetAt?: string };
      toast.success(
        `Account data reset at ${j.resetAt ? new Date(j.resetAt).toLocaleString() : "now"}.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-8 max-w-3xl">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Dev &amp; Testing</h1>
            <StatusBadge ok={isStaging} label={isStaging ? "Staging" : "Production"} />
          </div>
          <p className="text-sm text-muted-foreground">
            Tools for development, QA, and account management. Destructive actions are
            {isStaging ? " available in this environment." : " disabled — only available in staging."}
          </p>
        </div>

        {/* ── Quick Impersonation ─────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-primary" />
              Quick Impersonation
            </CardTitle>
            <CardDescription>
              Look up any user by email and generate a 30-day sign-in token. Use it to log in to the
              mobile app as that user to reproduce issues or test their experience.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleImpSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="user@example.com"
                  className="pl-9"
                  value={impEmail}
                  onChange={(e) => setImpEmailInput(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline" disabled={!impEmail.trim() || lookupQuery.isLoading}>
                {lookupQuery.isLoading ? "Looking up…" : "Look up"}
              </Button>
            </form>

            {impSearchEmail && !lookupQuery.isLoading && lookupQuery.error && (
              <ResultBox variant="error">No user found for <strong>{impSearchEmail}</strong>.</ResultBox>
            )}

            {user && !lookupQuery.isLoading && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  {user.avatar ? (
                    <img src={user.avatar} className="h-10 w-10 rounded-full object-cover border" alt="" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {user.displayName?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{user.displayName || "—"}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email || "—"}</p>
                  </div>
                  {user.isAdmin && (
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 shrink-0">Admin</Badge>
                  )}
                </div>
                <Button
                  className="w-full gap-2"
                  size="sm"
                  onClick={handleGenerateToken}
                  disabled={tokenLoading || !user.clerkUserId}
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  {tokenLoading ? "Generating…" : "Generate Sign-In Token"}
                </Button>
                {tokenResult && (
                  <ResultBox variant="warning">
                    <p className="font-medium mb-2">Token ready (valid 30 days)</p>
                    <div className="flex items-start gap-2">
                      <code className="flex-1 text-[10px] break-all font-mono leading-relaxed">{tokenResult}</code>
                      <button onClick={handleCopyToken} className="shrink-0 hover:opacity-70" aria-label="Copy token">
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </ResultBox>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Test Account Provisioning ───────────────────────────────────── */}
        <Card className={!isStaging ? "opacity-60" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" />
              Provision Test Account
              {!isStaging && <Badge variant="outline" className="ml-auto text-xs">Staging only</Badge>}
            </CardTitle>
            <CardDescription>
              Create or upgrade an account as a tester. Tester accounts skip billing gates and can
              freely repeat onboarding. Idempotent — safe to re-run.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProvisionTest} className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ta-email">Email</Label>
                  <Input
                    id="ta-email"
                    type="email"
                    placeholder="tester@example.com"
                    value={taEmail}
                    onChange={(e) => setTaEmail(e.target.value)}
                    disabled={!isStaging}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ta-name">Display name</Label>
                  <Input
                    id="ta-name"
                    placeholder="Test User"
                    value={taName}
                    onChange={(e) => setTaName(e.target.value)}
                    disabled={!isStaging}
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={!isStaging || taLoading || !taEmail.trim() || !taName.trim()}
                className="gap-2"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                {taLoading ? "Provisioning…" : "Provision Account"}
              </Button>
              {taResult && (
                <ResultBox variant="success">
                  Account {taResult.created ? "created" : "updated"} as tester.{" "}
                  <span className="font-mono text-xs">{taResult.appUserId}</span>
                </ResultBox>
              )}
            </form>
          </CardContent>
        </Card>

        {/* ── Account Reset ───────────────────────────────────────────────── */}
        <Card className={!isStaging ? "opacity-60" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4 text-primary" />
              Reset Account Data
              {!isStaging && <Badge variant="outline" className="ml-auto text-xs">Staging only</Badge>}
            </CardTitle>
            <CardDescription>
              Wipe all app data for a user (DEXA scans, activity logs, nutrition, XP, achievements)
              so they can re-run onboarding from scratch. Does not delete the Clerk account or the
              users row — login still works.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleResetSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="user@example.com"
                  className="pl-9"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  disabled={!isStaging}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={!isStaging || !resetEmail.trim() || resetLookup.isLoading}
              >
                {resetLookup.isLoading ? "Looking up…" : "Look up"}
              </Button>
            </form>

            {resetSearchEmail && !resetLookup.isLoading && resetLookup.error && (
              <ResultBox variant="error">No user found for <strong>{resetSearchEmail}</strong>.</ResultBox>
            )}

            {resetUser && !resetLookup.isLoading && (
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-3">
                  {resetUser.avatar ? (
                    <img src={resetUser.avatar} className="h-9 w-9 rounded-full object-cover border" alt="" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {resetUser.displayName?.charAt(0)?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{resetUser.displayName || "—"}</p>
                    <p className="text-xs text-muted-foreground truncate">{resetUser.email || "—"}</p>
                  </div>
                </div>
                <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                  <div className="flex items-start gap-2">
                    <Activity className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive">
                      This permanently deletes all app data for this account. The user can log in
                      again and will be routed through onboarding from scratch.
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => setResetConfirmOpen(true)}
                  disabled={resetLoading}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  {resetLoading ? "Resetting…" : "Reset Account Data"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this account&apos;s data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes all app data for{" "}
              <strong>{resetUser?.email || "this user"}</strong> (DEXA scans,
              activity logs, nutrition, XP, achievements). They can log in again
              and will be routed through onboarding from scratch. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleReset();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Reset data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
