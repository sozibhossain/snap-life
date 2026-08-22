import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Settings,
  Star,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getGetAdminEngagementMetricsQueryOptions,
  getGetAdminFeedbackQueryOptions,
  getGetAdminSubscriptionMetricsQueryOptions,
  getGetAdminUserMetricsQueryOptions,
  GetAdminFeedbackFeedbackType,
  GetAdminFeedbackTier,
  type AdminEngagementMetrics,
  type AdminFeedbackList,
  type AdminSubscriptionMetrics,
  type AdminUserMetrics,
} from "@workspace/api-client-react";

import { AdminLayout } from "@/components/AdminLayout";
import { MetricTile } from "@/components/MetricTile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- *
 * Brand palette (SNAP Life — internal admin uses the calmer end of the
 * scale; orange is reserved for emphasis only).
 *  - cyan    #3ABBD4
 *  - teal    #2B7499
 *  - navy    #1C3A4A
 *  - orange  #F47530 (accent / "needs attention")
 * -------------------------------------------------------------------------- */
const BRAND_CYAN = "#3ABBD4";
const BRAND_TEAL = "#2B7499";
const BRAND_NAVY = "#1C3A4A";
const BRAND_ORANGE = "#F47530";
const TIER_COLORS = [BRAND_CYAN, BRAND_TEAL, BRAND_NAVY, BRAND_ORANGE];

/** A single source of truth for the dashboard polling cadence. Background
 *  refetches keep the page live without blowing up rate limits. */
const POLL_INTERVAL_MS = 30_000;

function fmtCurrencyCents(cents: number | undefined | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fmtPercent(decimal: number | undefined | null): string {
  if (decimal == null || !Number.isFinite(decimal)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(decimal);
}

function fmtNumber(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

/* -------------------------------------------------------------------------- *
 * Page
 * -------------------------------------------------------------------------- */

export default function Dashboard() {
  const userMetricsQuery = useQuery({
    ...getGetAdminUserMetricsQueryOptions(),
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  });
  const engagementQuery = useQuery({
    ...getGetAdminEngagementMetricsQueryOptions(),
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  });
  const subscriptionsQuery = useQuery({
    ...getGetAdminSubscriptionMetricsQueryOptions(),
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  });

  const errs = [
    userMetricsQuery.error,
    engagementQuery.error,
    subscriptionsQuery.error,
  ].filter(Boolean);

  const userMetrics = userMetricsQuery.data;
  const engMetrics = engagementQuery.data;
  const subMetrics = subscriptionsQuery.data;

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Read-only metrics and feedback across SNAP Life.
          </p>
        </div>

        {errs.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Partial data loading failure</AlertTitle>
            <AlertDescription>
              Some metrics could not be loaded. Data may be incomplete.
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="users" className="space-y-4">
          <TabsList className="grid grid-cols-2 sm:grid-cols-4 h-auto gap-1 w-full md:w-auto md:inline-flex">
            <TabsTrigger value="users" data-testid="tab-users">
              Users
            </TabsTrigger>
            <TabsTrigger value="engagement" data-testid="tab-engagement">
              Engagement
            </TabsTrigger>
            <TabsTrigger
              value="subscriptions"
              data-testid="tab-subscriptions"
            >
              Subscriptions
            </TabsTrigger>
            <TabsTrigger value="feedback" data-testid="tab-feedback">
              Feedback
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-6">
            <UsersPane
              data={userMetrics}
              isLoading={userMetricsQuery.isLoading}
            />
          </TabsContent>
          <TabsContent value="engagement" className="space-y-6">
            <EngagementPane
              data={engMetrics}
              isLoading={engagementQuery.isLoading}
            />
          </TabsContent>
          <TabsContent value="subscriptions" className="space-y-6">
            <SubscriptionsPane
              data={subMetrics}
              isLoading={subscriptionsQuery.isLoading}
            />
          </TabsContent>
          <TabsContent value="feedback" className="space-y-6">
            <FeedbackPane />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

/* -------------------------------------------------------------------------- *
 * Users pane
 * -------------------------------------------------------------------------- */

function UsersPane({
  data,
  isLoading,
}: {
  data: AdminUserMetrics | undefined;
  isLoading: boolean;
}) {
  const tierData = data
    ? [
        { name: "Free", value: data.byTier.free },
        { name: "Trial", value: data.byTier.trial },
        { name: "Plus", value: data.byTier.plus },
        { name: "Premium", value: data.byTier.premium },
        { name: "Lapsed", value: data.byTier.lapsed },
      ]
    : [];

  return (
    <>
      <div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        data-testid="users-kpis"
      >
        <MetricTile
          title="Total Users"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              fmtNumber(data?.totalUsers)
            )
          }
          tooltip="All users who have created an account."
        />
        <MetricTile
          title="Admins"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              fmtNumber(data?.adminCount)
            )
          }
          tooltip="Users flagged with users.isAdmin = true."
        />
        <MetricTile
          title="Active (last 7d)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              fmtNumber(data?.activeLast7d)
            )
          }
          subtitle={`${fmtNumber(data?.activeLast30d)} in last 30d`}
          tooltip="Distinct users with at least one interaction event."
        />
        <MetricTile
          title="New Signups"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              `+${fmtNumber(data?.newUsersLast7d)}`
            )
          }
          subtitle={`+${fmtNumber(data?.newUsersLast30d)} in last 30d`}
          tooltip="Account created date within the rolling window."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tier Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="h-64" data-testid="tier-breakdown-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={tierData}
                  margin={{ top: 0, right: 4, left: -10, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    fontSize={12}
                    tickMargin={8}
                  />
                  <YAxis axisLine={false} tickLine={false} fontSize={12} />
                  <ChartTooltip
                    cursor={{ fill: "#f1f5f9" }}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={64}>
                    {tierData.map((_, index) => (
                      <Cell
                        key={`tier-${index}`}
                        fill={TIER_COLORS[index % TIER_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Engagement pane
 * -------------------------------------------------------------------------- */

function EngagementPane({
  data,
  isLoading,
}: {
  data: AdminEngagementMetrics | undefined;
  isLoading: boolean;
}) {
  return (
    <>
      <div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        data-testid="engagement-kpis"
      >
        <MetricTile
          title="DAU"
          value={
            isLoading ? <Skeleton className="h-8 w-16" /> : fmtNumber(data?.dau)
          }
          tooltip="Distinct active users in the last 24h."
        />
        <MetricTile
          title="WAU"
          value={
            isLoading ? <Skeleton className="h-8 w-16" /> : fmtNumber(data?.wau)
          }
          tooltip="Distinct active users in the last 7d."
        />
        <MetricTile
          title="MAU"
          value={
            isLoading ? <Skeleton className="h-8 w-16" /> : fmtNumber(data?.mau)
          }
          tooltip="Distinct active users in the last 30d."
        />
        <MetricTile
          title="Push Open Rate"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtPercent(data?.pushOpenRate)
            )
          }
          subtitle={
            data
              ? `${fmtNumber(data.pushOpenedLast7d)} / ${fmtNumber(
                  data.pushRecipientsLast7d,
                )} recipients`
              : undefined
          }
          tooltip="Distinct openers / distinct recipients in the last 7 days."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricTile
          title="Meal plans (7d)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.mealPlansLast7d)
            )
          }
          tooltip="Distinct (user, day) meal-plan rows updated in last 7d."
        />
        <MetricTile
          title="Bone Buddy (7d)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.boneBuddyInteractionsLast7d)
            )
          }
          tooltip="Total push opens (every push v1 is the Bone Buddy daily nudge)."
        />
        <MetricTile
          title="Push Recipients (7d)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.pushRecipientsLast7d)
            )
          }
          tooltip="Distinct users who received a push in last 7d."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weekly Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="h-48" data-testid="weekly-activity-sparkline">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data?.weeklyActivity ?? []}
                  margin={{ top: 5, right: 12, left: -10, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="date"
                    fontSize={11}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    fontSize={11}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <ChartTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="activeUsers"
                    stroke={BRAND_CYAN}
                    strokeWidth={2}
                    dot={{ r: 3, fill: BRAND_TEAL }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Wellbeing Sessions (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Breathing</span>
                  <span className="font-mono">
                    {fmtNumber(data?.wellbeingSessionsLast7d.breathing)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Meditation</span>
                  <span className="font-mono">
                    {fmtNumber(data?.wellbeingSessionsLast7d.meditation)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Other</span>
                  <span className="font-mono">
                    {fmtNumber(data?.wellbeingSessionsLast7d.other)}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Events (7d)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8">Event</TableHead>
                    <TableHead className="h-8 text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.eventCountsLast7d ?? []).slice(0, 6).map((row) => (
                    <TableRow key={row.kind}>
                      <TableCell className="py-2 text-sm font-medium">
                        {row.kind}
                      </TableCell>
                      <TableCell className="py-2 text-right text-sm font-mono text-muted-foreground">
                        {fmtNumber(row.count)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!data?.eventCountsLast7d ||
                    data.eventCountsLast7d.length === 0) && (
                    <TableRow>
                      <TableCell
                        colSpan={2}
                        className="text-center text-muted-foreground py-6 text-sm"
                      >
                        No events recorded.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Subscriptions pane
 * -------------------------------------------------------------------------- */

function SubscriptionsPane({
  data,
  isLoading,
}: {
  data: AdminSubscriptionMetrics | undefined;
  isLoading: boolean;
}) {
  return (
    <>
      <div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        data-testid="subscription-kpis"
      >
        <MetricTile
          title="Active Subs"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.activeCount)
            )
          }
          subtitle={`${fmtNumber(data?.inTrialCount)} in trial`}
        />
        <MetricTile
          title="MRR (approx)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              fmtCurrencyCents(data?.approxMrrCents)
            )
          }
          subtitle={`ARR ${fmtCurrencyCents(data?.approxArrCents)}`}
        />
        <MetricTile
          title="Trial → Paid"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtPercent(data?.trialToPaidRate)
            )
          }
          subtitle={`${fmtNumber(
            data?.trialsConvertedToPaidLast30d ??
              data?.paidConvertedLast30d,
          )} of ${fmtNumber(data?.trialsStartedLast30d)} trials (30d)`}
          tooltip="Of 30-day Premium trials started in the last 30d, the fraction now on a paid plan."
        />
        <MetricTile
          title="30d Churn"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtPercent(data?.churnRate30d)
            )
          }
          subtitle={`${fmtNumber(data?.cancelledLast30d)} cancellations`}
        />
      </div>

      {/* 30-day Premium trial breakdown — surfaces the new server-managed
          trial metrics so the team can monitor active trials, the per-tier
          conversion split, and trial drop-offs in one row. */}
      <div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        data-testid="trial-kpis"
      >
        <MetricTile
          title="Active Trials"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.trialsActiveCount)
            )
          }
          subtitle={`${fmtNumber(data?.trialsStartedLast30d)} started in 30d`}
          tooltip="Users currently inside a 30-day server-managed Premium trial."
        />
        <MetricTile
          title="→ Plus (30d)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.trialsConvertedToPlusLast30d)
            )
          }
          tooltip="Trials started in the last 30d that are now on a paid Plus plan."
        />
        <MetricTile
          title="→ Premium (30d)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.trialsConvertedToPremiumLast30d)
            )
          }
          tooltip="Trials started in the last 30d that are now on a paid Premium plan."
        />
        <MetricTile
          title="Trial Drop-offs (30d)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.trialsExpiredWithoutConversionLast30d)
            )
          }
          tooltip="Server-managed trials whose 30-day window ended in the last 30d without the user picking a paid plan."
        />
      </div>

      {/* Billing-issue grace tile — surfaces the count of subscribers
          currently in a payment-failed grace window so we can spot a
          processor outage early. Lives on its own row to keep the trial
          KPI grid coherent. */}
      <div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
        data-testid="billing-issue-kpis"
      >
        <MetricTile
          title="Billing Issues (now)"
          value={
            isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              fmtNumber(data?.billingIssueCount)
            )
          }
          tooltip="Active subscribers currently inside a BILLING_ISSUE grace window — payment failed at the store but they still have access while the store retries."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by Product</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.revenueByProduct ?? []).map((row) => (
                  <TableRow key={row.productId ?? "unknown"}>
                    <TableCell className="font-mono text-xs">
                      {row.productId ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {row.tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmtNumber(row.activeCount)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {fmtCurrencyCents(row.monthlyCents)}
                    </TableCell>
                  </TableRow>
                ))}
                {(!data?.revenueByProduct ||
                  data.revenueByProduct.length === 0) && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground py-6 text-sm"
                    >
                      No paying subscribers yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* -------------------------------------------------------------------------- *
 * Feedback pane
 * -------------------------------------------------------------------------- */

const FEEDBACK_TYPE_OPTIONS: Array<{
  value: GetAdminFeedbackFeedbackType | "all";
  label: string;
}> = [
  { value: "all", label: "All types" },
  { value: GetAdminFeedbackFeedbackType.general, label: "General" },
  { value: GetAdminFeedbackFeedbackType.testimonial, label: "Testimonial" },
  { value: GetAdminFeedbackFeedbackType.experience, label: "Experience" },
];

const TIER_OPTIONS: Array<{
  value: GetAdminFeedbackTier | "all";
  label: string;
}> = [
  { value: "all", label: "All tiers" },
  { value: GetAdminFeedbackTier.free, label: "Free" },
  { value: GetAdminFeedbackTier.trial, label: "Trial" },
  { value: GetAdminFeedbackTier.plus, label: "Plus" },
  { value: GetAdminFeedbackTier.premium, label: "Premium" },
];

function getFeedbackIcon(type: string) {
  switch (type) {
    case "testimonial":
      return <Star className="h-4 w-4 text-orange-500" />;
    case "experience":
      return <Settings className="h-4 w-4 text-blue-500" />;
    default:
      return <MessageSquare className="h-4 w-4 text-slate-500" />;
  }
}

function FeedbackPane() {
  const [typeFilter, setTypeFilter] = useState<
    GetAdminFeedbackFeedbackType | "all"
  >("all");
  const [tierFilter, setTierFilter] = useState<GetAdminFeedbackTier | "all">(
    "all",
  );
  const [testimonialOnly, setTestimonialOnly] = useState(false);

  const params = {
    limit: 200,
    feedbackType:
      typeFilter === "all"
        ? undefined
        : (typeFilter as GetAdminFeedbackFeedbackType),
    tier: tierFilter === "all" ? undefined : (tierFilter as GetAdminFeedbackTier),
    testimonialOnly: testimonialOnly ? true : undefined,
  };

  const { data, isLoading, error } = useQuery({
    ...getGetAdminFeedbackQueryOptions(params),
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
  });

  const list: AdminFeedbackList | undefined = data;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row gap-3 md:items-center">
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select
                value={typeFilter}
                onValueChange={(v: string) =>
                  setTypeFilter(v as GetAdminFeedbackFeedbackType | "all")
                }
              >
                <SelectTrigger
                  className="mt-1"
                  data-testid="feedback-type-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Tier</Label>
              <Select
                value={tierFilter}
                onValueChange={(v: string) =>
                  setTierFilter(v as GetAdminFeedbackTier | "all")
                }
              >
                <SelectTrigger
                  className="mt-1"
                  data-testid="feedback-tier-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 md:ml-4 md:pt-5">
            <Switch
              id="testimonial-only"
              checked={testimonialOnly}
              onCheckedChange={setTestimonialOnly}
              data-testid="testimonial-only-switch"
            />
            <Label htmlFor="testimonial-only" className="text-sm">
              Testimonials only
            </Label>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3" data-testid="feedback-list">
        {isLoading && !list && <Skeleton className="h-48 w-full" />}

        {!isLoading && error && !list && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Couldn't load feedback. Retrying every 30s…
            </CardContent>
          </Card>
        )}

        {list && (
          <>
            <p className="text-xs text-muted-foreground">
              {fmtNumber(list.total)} total · showing {list.items.length}
            </p>
            {list.items.length === 0 && (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  No feedback matches the current filters.
                </CardContent>
              </Card>
            )}
          </>
        )}

        {list?.items.map((item) => (
            <Card key={item.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {getFeedbackIcon(item.feedbackType)}
                    <Badge
                      variant="outline"
                      className={cn("capitalize text-xs")}
                    >
                      {item.feedbackType}
                    </Badge>
                    <Badge variant="secondary" className="capitalize text-xs">
                      {item.tier}
                    </Badge>
                    {item.allowTestimonialUse && (
                      <Badge className="text-xs gap-1 bg-orange-100 text-orange-800 hover:bg-orange-100">
                        <CheckCircle2 className="h-3 w-3" />
                        Testimonial OK
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(item.createdAt), "MMM d, yyyy HH:mm")}
                  </span>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {item.message}
                </p>
                {(item.platform || item.appVersion) && (
                  <p className="text-xs text-muted-foreground">
                    {item.platform ?? "?"} · v{item.appVersion ?? "?"}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
