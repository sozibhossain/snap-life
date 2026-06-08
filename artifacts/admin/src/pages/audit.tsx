import React, { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search, X } from "lucide-react";
import { useSearch } from "wouter";

import { useFilterNavigate } from "@/hooks/useFilterNavigate";
import { ACTION_LABELS, DATE_RANGE_SEPARATOR } from "@/lib/auditFilterSummary";
import { AdminLayout } from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: number;
  actorAppUserId: string | null;
  targetAppUserId: string | null;
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditEventList {
  items: AuditEvent[];
  total: number;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PAGE_SIZE = 50;

const ACTION_OPTIONS = [
  { value: "test_account_provisioned", label: "Test account provisioned" },
  { value: "account_deleted", label: "Account deleted" },
  { value: "tester_data_reset", label: "Tester data reset" },
] as const;

type ActionValue = (typeof ACTION_OPTIONS)[number]["value"];


const ACTION_VARIANTS: Record<
  string,
  "default" | "destructive" | "secondary" | "outline"
> = {
  test_account_provisioned: "secondary",
  account_deleted: "destructive",
  tester_data_reset: "outline",
  sign_in_token_generated: "default",
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function datePreset(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: toDateStr(from), to: toDateStr(to) };
}

function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function PayloadCell({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload ?? {});
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-0.5 text-xs">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="font-medium text-muted-foreground">{k}:</span>{" "}
          <span>{String(v)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AuditLog() {
  const searchStr = useSearch();
  const filterNavigate = useFilterNavigate();

  const searchParams = new URLSearchParams(searchStr);
  const actionFilter = (searchParams.get("action") as ActionValue | null) ?? undefined;
  const targetFilter = searchParams.get("targetAppUserId") ?? undefined;
  const actorFilter = searchParams.get("actorAppUserId") ?? undefined;
  const fromFilter = searchParams.get("from") ?? undefined;
  const toFilter = searchParams.get("to") ?? undefined;
  const offsetParam = parseInt(searchParams.get("offset") ?? "0", 10);
  const offset = Number.isNaN(offsetParam) ? 0 : offsetParam;

  const updateFilters = useCallback(
    (updates: {
      action?: string | null;
      targetAppUserId?: string | null;
      actorAppUserId?: string | null;
      from?: string | null;
      to?: string | null;
      offset?: number;
    }) => {
      const next = new URLSearchParams(searchStr);
      if ("action" in updates) {
        if (updates.action) next.set("action", updates.action);
        else next.delete("action");
      }
      if ("targetAppUserId" in updates) {
        if (updates.targetAppUserId) next.set("targetAppUserId", updates.targetAppUserId);
        else next.delete("targetAppUserId");
      }
      if ("actorAppUserId" in updates) {
        if (updates.actorAppUserId) next.set("actorAppUserId", updates.actorAppUserId);
        else next.delete("actorAppUserId");
      }
      if ("from" in updates) {
        if (updates.from) next.set("from", updates.from);
        else next.delete("from");
      }
      if ("to" in updates) {
        if (updates.to) next.set("to", updates.to);
        else next.delete("to");
      }
      if ("offset" in updates && updates.offset !== undefined) {
        if (updates.offset === 0) next.delete("offset");
        else next.set("offset", String(updates.offset));
      }
      filterNavigate(next);
    },
    [searchStr, filterNavigate],
  );

  const resetOffset = useCallback(
    (updates: {
      action?: string | null;
      targetAppUserId?: string | null;
      actorAppUserId?: string | null;
      from?: string | null;
      to?: string | null;
    }) => {
      updateFilters({ ...updates, offset: 0 });
    },
    [updateFilters],
  );

  const hasFilters = Boolean(actionFilter || targetFilter || actorFilter || fromFilter || toFilter);
  const activeFilterCount = [actionFilter, targetFilter, actorFilter, fromFilter, toFilter].filter(Boolean).length;

  const { getToken } = useAuth();

  const { data, isLoading, error, refetch, isFetching } = useQuery<AuditEventList>({
    queryKey: [
      "admin-audit",
      { limit: PAGE_SIZE, offset, actionFilter, targetFilter, actorFilter, fromFilter, toFilter },
    ],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (actionFilter) qs.set("action", actionFilter);
      if (targetFilter) qs.set("targetAppUserId", targetFilter);
      if (actorFilter) qs.set("actorAppUserId", actorFilter);
      if (fromFilter) qs.set("from", `${fromFilter}T00:00:00.000Z`);
      if (toFilter) qs.set("to", `${toFilter}T23:59:59.999Z`);
      const token = await getToken();
      const res = await fetch(`${BASE}/api/admin/audit?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        // Admin data must be fresh; bypass the HTTP cache so a stale/304
        // revalidation can never surface as a load failure.
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<AuditEventList>;
    },
    staleTime: 30_000,
  });

  const total = data?.total ?? 0;
  const page = Math.floor(offset / PAGE_SIZE);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground mt-1">
            Append-only record of admin actions and GDPR operations.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              Filters
            </CardTitle>
            <div className="grid grid-cols-1 gap-3 pt-2 sm:flex sm:flex-wrap">
              <div className="flex flex-col gap-1.5 min-w-[200px]">
                <Label htmlFor="action-filter" className="text-xs">
                  Action type
                </Label>
                <Select
                  value={actionFilter ?? "all"}
                  onValueChange={(val) =>
                    resetOffset({ action: val === "all" ? null : val })
                  }
                >
                  <SelectTrigger id="action-filter" className="h-8 text-sm">
                    <SelectValue placeholder="All actions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actions</SelectItem>
                    {ACTION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5 min-w-[240px]">
                <Label htmlFor="actor-filter" className="text-xs">
                  Actor user ID
                </Label>
                <div className="relative">
                  <Input
                    id="actor-filter"
                    className="h-8 text-sm pr-7 font-mono"
                    placeholder="Exact user ID…"
                    value={actorFilter ?? ""}
                    onChange={(e) =>
                      resetOffset({ actorAppUserId: e.target.value || null })
                    }
                  />
                  {actorFilter && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => resetOffset({ actorAppUserId: null })}
                      aria-label="Clear actor user ID filter"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 min-w-[240px]">
                <Label htmlFor="target-filter" className="text-xs">
                  Target user ID
                </Label>
                <div className="relative">
                  <Input
                    id="target-filter"
                    className="h-8 text-sm pr-7 font-mono"
                    placeholder="Exact user ID…"
                    value={targetFilter ?? ""}
                    onChange={(e) =>
                      resetOffset({ targetAppUserId: e.target.value || null })
                    }
                  />
                  {targetFilter && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => resetOffset({ targetAppUserId: null })}
                      aria-label="Clear target user ID filter"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Quick range</Label>
                <div className="flex gap-1.5 h-8 items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2.5"
                    onClick={() => resetOffset(datePreset(7))}
                  >
                    Last 7 days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2.5"
                    onClick={() => resetOffset(datePreset(30))}
                  >
                    Last 30 days
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from-filter" className="text-xs">
                  From
                </Label>
                <div className="relative">
                  <Input
                    id="from-filter"
                    type="date"
                    className="h-8 text-sm pr-7"
                    value={fromFilter ?? ""}
                    onChange={(e) => resetOffset({ from: e.target.value || null })}
                  />
                  {fromFilter && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => resetOffset({ from: null })}
                      aria-label="Clear from date"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to-filter" className="text-xs">
                  To
                </Label>
                <div className="relative">
                  <Input
                    id="to-filter"
                    type="date"
                    className="h-8 text-sm pr-7"
                    value={toFilter ?? ""}
                    onChange={(e) => resetOffset({ to: e.target.value || null })}
                  />
                  {toFilter && (
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => resetOffset({ to: null })}
                      aria-label="Clear to date"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              {hasFilters && (
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() =>
                      updateFilters({
                        action: null,
                        targetAppUserId: null,
                        actorAppUserId: null,
                        from: null,
                        to: null,
                        offset: 0,
                      })
                    }
                  >
                    Clear all
                  </Button>
                </div>
              )}
            </div>
            {(actorFilter || targetFilter || actionFilter) && (
              <div className="flex flex-wrap gap-2 pt-3">
                {actionFilter && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Action: {ACTION_LABELS[actionFilter] ?? actionFilter}
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:text-foreground transition-colors"
                      aria-label="Clear action filter"
                      onClick={() => resetOffset({ action: null })}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                )}
                {actorFilter && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Actor: <span className="font-mono">{actorFilter}</span>
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:text-foreground transition-colors"
                      aria-label="Clear actor filter"
                      onClick={() => resetOffset({ actorAppUserId: null })}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                )}
                {targetFilter && (
                  <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Target: <span className="font-mono">{targetFilter}</span>
                    <button
                      type="button"
                      className="ml-0.5 rounded-full hover:text-foreground transition-colors"
                      aria-label="Clear target filter"
                      onClick={() => resetOffset({ targetAppUserId: null })}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            )}
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4" />
                Events
                {total > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {total}
                  </Badge>
                )}
                {activeFilterCount > 0 && (
                  <Badge variant="outline" className="ml-1 text-xs">
                    {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"}
                  </Badge>
                )}
              </CardTitle>
              {totalPages > 1 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    Page {page + 1} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={!hasPrev}
                    aria-label="Previous page"
                    onClick={() =>
                      updateFilters({ offset: Math.max(0, offset - PAGE_SIZE) })
                    }
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={!hasNext}
                    aria-label="Next page"
                    onClick={() => updateFilters({ offset: offset + PAGE_SIZE })}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
            {hasFilters && (
              <div data-testid="event-filter-summary" className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Filtered by:</span>
                {actionFilter && (
                  <button
                    type="button"
                    aria-label={`Clear action filter: ${ACTION_LABELS[actionFilter] ?? actionFilter}`}
                    onClick={() => resetOffset({ action: null })}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-muted/70 transition-colors"
                  >
                    Action: {ACTION_LABELS[actionFilter] ?? actionFilter}
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </button>
                )}
                {actorFilter && (
                  <button
                    type="button"
                    aria-label={`Clear actor filter: ${actorFilter}`}
                    onClick={() => resetOffset({ actorAppUserId: null })}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-muted/70 transition-colors"
                  >
                    Actor: <span className="font-mono">{actorFilter}</span>
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </button>
                )}
                {targetFilter && (
                  <button
                    type="button"
                    aria-label={`Clear target filter: ${targetFilter}`}
                    onClick={() => resetOffset({ targetAppUserId: null })}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-muted/70 transition-colors"
                  >
                    Target: <span className="font-mono">{targetFilter}</span>
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </button>
                )}
                {(fromFilter || toFilter) && (
                  <button
                    type="button"
                    aria-label={`Clear date filter: ${fromFilter ?? "…"} to ${toFilter ?? "…"}`}
                    onClick={() => resetOffset({ from: null, to: null })}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-muted/70 transition-colors"
                  >
                    Date: {fromFilter ?? "…"} {DATE_RANGE_SEPARATOR} {toFilter ?? "…"}
                    <X className="h-3 w-3 shrink-0" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {error ? (
              <div className="p-6 flex flex-col items-start gap-3">
                <p className="text-sm text-destructive">
                  Failed to load the audit log. This is usually a temporary
                  network or server hiccup.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="gap-2"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {isFetching ? "Retrying…" : "Retry"}
                </Button>
              </div>
            ) : isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !data || data.items.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {hasFilters
                  ? "No events match the current filters."
                  : "No audit events recorded yet."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-52">Timestamp (UTC)</TableHead>
                      <TableHead className="w-40">Action</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Metadata</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDateTime(event.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              ACTION_VARIANTS[event.action] ?? "default"
                            }
                          >
                            {ACTION_LABELS[event.action] ?? event.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {event.actorAppUserId === "self" ? (
                            <span className="italic text-muted-foreground">
                              self
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="underline decoration-dotted underline-offset-2 hover:text-foreground text-muted-foreground transition-colors cursor-pointer"
                              title="Filter by this actor ID"
                              onClick={() =>
                                resetOffset({ actorAppUserId: event.actorAppUserId })
                              }
                            >
                              {event.actorAppUserId}
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {event.targetAppUserId ? (
                            <button
                              type="button"
                              className="underline decoration-dotted underline-offset-2 hover:text-foreground text-muted-foreground transition-colors cursor-pointer"
                              title="Filter by this user ID"
                              onClick={() =>
                                resetOffset({ targetAppUserId: event.targetAppUserId })
                              }
                            >
                              {event.targetAppUserId}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <PayloadCell
                            payload={
                              event.payload as Record<string, unknown>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
