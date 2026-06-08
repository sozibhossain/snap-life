import React, { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import {
  Activity,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Eye,
  KeyRound,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  XCircle,
} from "lucide-react";

import {
  getGetAdminUserLookupQueryOptions,
  useDeleteAdminUser,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/AdminLayout";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface UserListItem {
  appUserId: string;
  clerkUserId: string | null;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  isTester: boolean;
  deletedAt: string | null;
  createdAt: string | null;
}
interface UserListResponse {
  items: UserListItem[];
  total: number;
}

const PAGE_SIZE = 20;

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "MMM d, yyyy");
}

function fmtRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDistanceToNow(d)} ago`;
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds - mins * 60);
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

export default function Users() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // ── All-users list (paginated) ───────────────────────────────────────────
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  const usersList = useQuery({
    queryKey: ["admin-users-list", { search, offset }],
    queryFn: async (): Promise<UserListResponse> => {
      const qs = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (search) qs.set("search", search);
      const token = await getToken();
      const res = await fetch(`/api/admin/users?${qs.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as UserListResponse;
    },
  });

  // ── Selected user detail (lookup by email) ───────────────────────────────
  const [email, setEmail] = useState("");
  const lookupQueryOptions = getGetAdminUserLookupQueryOptions({ email });
  const { data, isLoading } = useQuery({
    ...lookupQueryOptions,
    enabled: email.length > 0,
    retry: false,
  });

  // ── Delete (shared by list rows + detail card) ───────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{
    appUserId: string;
    email: string | null;
  } | null>(null);

  const deleteUser = useDeleteAdminUser({
    mutation: {
      onSuccess: (res) => {
        toast.success(
          `Account soft-deleted. Hard-delete scheduled for ${fmtDate(res.hardDeleteAfter)}.`,
        );
        queryClient.invalidateQueries({ queryKey: ["admin-users-list"] });
        queryClient.invalidateQueries({ queryKey: lookupQueryOptions.queryKey });
      },
      onError: (err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : "Failed to delete account.",
        );
      },
    },
  });

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteUser.mutate(
      { id: deleteTarget.appUserId },
      { onSettled: () => setDeleteTarget(null) },
    );
  };

  // ── Login token (detail card) ────────────────────────────────────────────
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenResult, setTokenResult] = useState<string | null>(null);

  const handleGenerateToken = async () => {
    if (!data?.user.clerkUserId) return;
    setTokenLoading(true);
    setTokenResult(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/admin/users/${data.user.clerkUserId}/sign-in-token`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
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
      toast.success("Login token copied to clipboard");
    });
  };

  const handleListSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setOffset(0);
  };

  const openDetail = (item: UserListItem) => {
    if (!item.email) return;
    setTokenResult(null);
    setEmail(item.email);
  };

  const isSoftDeleted = Boolean(data && data.user.email == null);

  const total = usersList.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const items = usersList.data?.items ?? [];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Users
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse all users, view full profiles, and manage accounts.
          </p>
        </div>

        {/* ── All Users list ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserIcon className="h-4 w-4 text-primary" />
              All Users
              {total > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {total}
                </Badge>
              )}
            </CardTitle>
            <form
              onSubmit={handleListSearch}
              className="flex flex-col sm:flex-row gap-2 pt-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="user-list-search"
                  placeholder="Filter by email or name…"
                  className="pl-9 bg-background"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
              {search && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSearch("");
                    setSearchInput("");
                    setOffset(0);
                  }}
                >
                  Clear
                </Button>
              )}
            </form>
          </CardHeader>
          <CardContent className="p-0">
            {usersList.isError ? (
              <div className="p-6 flex flex-col items-start gap-3">
                <p className="text-sm text-destructive">
                  Failed to load users. This is usually a temporary network or
                  server hiccup.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => usersList.refetch()}
                  disabled={usersList.isFetching}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${usersList.isFetching ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {usersList.isFetching ? "Retrying…" : "Retry"}
                </Button>
              </div>
            ) : usersList.isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {search ? "No users match your search." : "No users yet."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead className="whitespace-nowrap">Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.appUserId}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">
                              {item.displayName || "—"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {item.email || "(no email)"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {item.isAdmin && (
                              <Badge
                                variant="outline"
                                className="bg-primary/10 text-primary border-primary/20 gap-1"
                              >
                                <ShieldCheck className="h-3 w-3" /> Admin
                              </Badge>
                            )}
                            {item.isTester && (
                              <Badge variant="secondary">Tester</Badge>
                            )}
                            {item.deletedAt && (
                              <Badge
                                variant="outline"
                                className="bg-slate-50 text-slate-600 border-slate-200 gap-1"
                              >
                                <XCircle className="h-3 w-3" /> Deleted
                              </Badge>
                            )}
                            {!item.isAdmin &&
                              !item.isTester &&
                              !item.deletedAt && (
                                <span className="text-xs text-muted-foreground">
                                  User
                                </span>
                              )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(item.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1.5"
                              onClick={() => openDetail(item)}
                              disabled={!item.email}
                            >
                              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                              View
                            </Button>
                            {!item.deletedAt && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() =>
                                  setDeleteTarget({
                                    appUserId: item.appUserId,
                                    email: item.email,
                                  })
                                }
                                aria-label={`Delete ${item.email ?? "user"}`}
                              >
                                <Trash2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {!usersList.isLoading && !usersList.isError && total > 0 && (
              <div className="flex items-center justify-between gap-3 border-t p-3">
                <p className="text-xs text-muted-foreground">
                  Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
                  {total}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Prev
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* ── User details modal ─────────────────────────────────────────── */}
      <Dialog
        open={email.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setEmail("");
            setTokenResult(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User details</DialogTitle>
            <DialogDescription>
              {email || "Full profile, subscription, activity and feedback."}
            </DialogDescription>
          </DialogHeader>
          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2">
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-64 w-full" />
              <Skeleton className="h-48 w-full md:col-span-2" />
            </div>
          ) : data ? (
            <div className="grid gap-6 md:grid-cols-2">
              {/* Identity */}
              <Card data-testid="lookup-identity">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <UserIcon className="h-5 w-5 text-primary" />
                    Identity
                    {data.user.isAdmin && (
                      <Badge
                        variant="outline"
                        className="ml-auto bg-primary/10 text-primary border-primary/20 gap-1"
                      >
                        <ShieldAlert className="h-3 w-3" /> Admin
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                    <span className="text-sm text-muted-foreground">Email</span>
                    <span className="text-sm font-medium truncate">
                      {data.user.email || "—"}
                    </span>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                    <span className="text-sm text-muted-foreground">Name</span>
                    <span className="text-sm font-medium">
                      {data.user.displayName || "—"}
                    </span>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                    <span className="text-sm text-muted-foreground">
                      App User ID
                    </span>
                    <span className="text-xs font-mono text-muted-foreground break-all">
                      {data.user.appUserId}
                    </span>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                    <span className="text-sm text-muted-foreground">
                      Clerk ID
                    </span>
                    <span className="text-xs font-mono text-muted-foreground break-all">
                      {data.user.clerkUserId || "—"}
                    </span>
                  </div>
                  <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                    <span className="text-sm text-muted-foreground">Joined</span>
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      {fmtDate(data.user.createdAt)}
                    </span>
                  </div>
                  <div
                    className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50"
                    data-testid="lookup-last-active"
                  >
                    <span className="text-sm text-muted-foreground">
                      Last active
                    </span>
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {fmtRelative(data.user.lastActiveAt)}
                    </span>
                  </div>
                  <div
                    className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50"
                    data-testid="lookup-photo"
                  >
                    <span className="text-sm text-muted-foreground">Photo</span>
                    {data.user.avatar ? (
                      <img
                        src={data.user.avatar}
                        alt="Profile photo"
                        className="h-10 w-10 rounded-full object-cover border border-border/60"
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                  <div
                    className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50"
                    data-testid="lookup-country"
                  >
                    <span className="text-sm text-muted-foreground">
                      Country
                    </span>
                    <span className="text-sm font-medium">
                      {data.user.country || "—"}
                    </span>
                  </div>
                  <div
                    className="grid grid-cols-[110px_1fr] items-center py-2"
                    data-testid="lookup-timezone"
                  >
                    <span className="text-sm text-muted-foreground">
                      Timezone
                    </span>
                    <span className="text-sm font-medium">
                      {data.user.timezone || "—"}
                    </span>
                  </div>

                  <div className="pt-3 border-t border-border/50 space-y-2">
                    {data.user.clerkUserId && !isSoftDeleted && (
                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={handleGenerateToken}
                          disabled={tokenLoading}
                        >
                          <KeyRound
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {tokenLoading ? "Generating…" : "Generate Login Token"}
                        </Button>
                        {tokenResult && (
                          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                            <p className="text-xs font-medium text-amber-800">
                              Login token (valid 30 days). Paste into the mobile
                              app's dev login.
                            </p>
                            <div className="flex items-start gap-2">
                              <code className="flex-1 text-[10px] break-all font-mono text-amber-900 leading-relaxed">
                                {tokenResult}
                              </code>
                              <button
                                onClick={handleCopyToken}
                                className="shrink-0 text-amber-700 hover:text-amber-900"
                                aria-label="Copy token"
                              >
                                <Copy className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {isSoftDeleted ? (
                      <Badge
                        variant="outline"
                        data-testid="account-deleted-badge"
                        className="bg-slate-50 text-slate-600 border-slate-200 gap-1"
                      >
                        <XCircle className="h-3 w-3" /> Account soft-deleted
                      </Badge>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full gap-2"
                        data-testid="delete-account-button"
                        onClick={() =>
                          setDeleteTarget({
                            appUserId: data.user.appUserId,
                            email: data.user.email,
                          })
                        }
                        disabled={deleteUser.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {deleteUser.isPending
                          ? "Deleting…"
                          : "Delete account (GDPR)"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Subscription */}
              <Card data-testid="lookup-subscription">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-primary" />
                    Subscription
                    {data.subscription?.isActive ? (
                      <Badge
                        variant="outline"
                        className="ml-auto bg-green-50 text-green-700 border-green-200 gap-1"
                      >
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="ml-auto bg-slate-50 text-slate-600 border-slate-200 gap-1"
                      >
                        <XCircle className="h-3 w-3" /> Inactive
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!data.subscription ? (
                    <div className="h-full flex flex-col items-center justify-center text-center py-8">
                      <CreditCard className="h-8 w-8 text-muted-foreground/30 mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No active subscription history.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                        <span className="text-sm text-muted-foreground">
                          Tier
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium capitalize">
                            {data.subscription.entitlementId}
                          </span>
                          {data.subscription.isInTrial && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] h-5 px-1.5"
                            >
                              In Trial
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                        <span className="text-sm text-muted-foreground">
                          Product
                        </span>
                        <span className="text-sm font-mono text-muted-foreground">
                          {data.subscription.productId || "—"}
                        </span>
                      </div>
                      <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                        <span className="text-sm text-muted-foreground">
                          Period
                        </span>
                        <span className="text-sm font-medium capitalize">
                          {data.subscription.periodType || "—"}
                        </span>
                      </div>
                      <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                        <span className="text-sm text-muted-foreground">
                          Store
                        </span>
                        <span className="text-sm font-medium capitalize">
                          {data.subscription.store || "—"}
                        </span>
                      </div>
                      <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                        <span className="text-sm text-muted-foreground">
                          Will Renew
                        </span>
                        <span className="text-sm font-medium">
                          {data.subscription.willRenew ? "Yes" : "No"}
                        </span>
                      </div>
                      {data.subscription.expiresAt && (
                        <div className="grid grid-cols-[110px_1fr] items-center py-2 border-b border-border/50">
                          <span className="text-sm text-muted-foreground">
                            Expires
                          </span>
                          <span className="text-sm font-medium">
                            {fmtDate(data.subscription.expiresAt)}
                          </span>
                        </div>
                      )}
                      {data.subscription.cancelledAt && (
                        <div className="grid grid-cols-[110px_1fr] items-center py-2 text-destructive">
                          <span className="text-sm">Cancelled</span>
                          <span className="text-sm font-medium">
                            {fmtDate(data.subscription.cancelledAt)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Counts */}
              <Card className="md:col-span-2" data-testid="lookup-counts">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Activity Overview
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-muted/40 rounded-lg p-4 text-center">
                      <p className="text-3xl font-bold font-mono text-foreground mb-1">
                        {data.counts.interactionEvents.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                        Events
                      </p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-4 text-center">
                      <p className="text-3xl font-bold font-mono text-foreground mb-1">
                        {data.counts.wellbeingEntries.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                        Sessions
                      </p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-4 text-center">
                      <p className="text-3xl font-bold font-mono text-foreground mb-1">
                        {data.counts.feedbackSubmissions.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                        Feedback
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Recent sessions */}
              <Card
                className="md:col-span-2"
                data-testid="lookup-recent-sessions"
              >
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" />
                    Recent Sessions
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      last 30 days
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.recentSessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No wellbeing sessions in the last 30 days.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="h-9">Kind</TableHead>
                            <TableHead className="h-9">Session</TableHead>
                            <TableHead className="h-9">Mood</TableHead>
                            <TableHead className="h-9 text-right">
                              Duration
                            </TableHead>
                            <TableHead className="h-9 text-right">When</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.recentSessions.map((row, idx) => (
                            <TableRow key={`${row.completedAt}-${idx}`}>
                              <TableCell className="capitalize text-sm">
                                {row.kind}
                              </TableCell>
                              <TableCell className="text-sm">
                                {row.sessionName ?? "—"}
                              </TableCell>
                              <TableCell className="text-sm capitalize">
                                {row.mood ?? "—"}
                              </TableCell>
                              <TableCell className="text-right text-sm font-mono text-muted-foreground">
                                {fmtDuration(row.durationSec)}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {fmtRelative(row.completedAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent feedback */}
              <Card
                className="md:col-span-2"
                data-testid="lookup-recent-feedback"
              >
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    Recent Feedback
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {data.recentFeedback.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No feedback submitted.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {data.recentFeedback.map((row) => (
                        <div
                          key={row.id}
                          className="border rounded-md p-3 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant="outline"
                                className="capitalize text-xs"
                              >
                                {row.feedbackType}
                              </Badge>
                              <Badge
                                variant="secondary"
                                className="capitalize text-xs"
                              >
                                {row.tier}
                              </Badge>
                              {row.allowTestimonialUse && (
                                <Badge className="text-xs gap-1 bg-orange-100 text-orange-800 hover:bg-orange-100">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Testimonial OK
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {fmtRelative(row.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">
                            {row.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Couldn&apos;t load this user&apos;s details.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="delete-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this account?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.email ? (
                <>
                  This soft-deletes <strong>{deleteTarget.email}</strong>.{" "}
                </>
              ) : null}
              It honours a GDPR right-to-erasure request: PII redacted, push
              tokens and bearer tokens removed, free-text scrubbed, and the
              upstream Clerk identity erased. Cascaded rows are purged after the
              30-day grace period. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="delete-cancel-button">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="delete-confirm-button"
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
