import { useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Download, FlaskConical, ShieldCheck } from "lucide-react";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AdminLayout } from "@/components/AdminLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Group = { label: string; count: number | null; suppressed: boolean };
type EventStats = {
  count7d: number | null;
  users7d: number | null;
  count30d: number | null;
  users30d: number | null;
};
type NamedCount = { count: number | null } & Record<string, string | number | null>;
type Insights = {
  generatedAt: string;
  analyticsVersion?: string;
  privacy: {
    minCohortSize: number;
    consentedParticipants: number | null;
    suppressed: boolean;
    consentVersion: string;
    purpose?: "community" | "research";
    researchUseRequired?: boolean;
  };
  overview: null | {
    totalRegisteredUsers?: number;
    newRegistrations7d?: number;
    newRegistrations30d?: number;
    dailyActiveConsentedUsers?: number | null;
    weeklyActiveConsentedUsers?: number | null;
    monthlyActiveConsentedUsers?: number | null;
    age: Group[];
    gender: Group[];
    condition: Group[];
    country: Group[];
    goals: Group[];
    averageYearsSinceDiagnosis: number | null;
  };
  boneHealth: Record<string, unknown> | null;
  nutrition: Record<
    string,
    { average30d: number | null; loggedDays: number | null }
  > | null;
  medicationAndSupplements: Record<string, unknown> | null;
  exercise: Record<string, unknown> | null;
  learningAndWellness: Record<string, unknown> | null;
  outcomes: Record<string, unknown> | null;
  impact: Record<string, number | null> | null;
  productActivity?: Record<string, EventStats>;
  community?: Record<string, EventStats> | null;
  prevention?: Record<string, unknown> | null;
  behaviourChange?: Record<string, unknown> | null;
  dataQuality?: Record<string, unknown> | null;
  wellbeingSupportNeeds7d?: NamedCount[];
  topLearningPathways30d?: NamedCount[];
  topBoneBuddyTopics30d?: NamedCount[];
  coachingDemand30d?: NamedCount[];
  expertDemand30d?: NamedCount[];
};

function parseInsightsResponse(value: unknown): Insights {
  if (!value || typeof value !== "object") {
    throw new Error("The Community Insights API returned an invalid response.");
  }
  const candidate = value as Partial<Insights>;
  if (
    typeof candidate.generatedAt !== "string" ||
    !candidate.privacy ||
    typeof candidate.privacy.minCohortSize !== "number" ||
    typeof candidate.privacy.suppressed !== "boolean" ||
    typeof candidate.privacy.consentVersion !== "string"
  ) {
    throw new Error(
      "The API server is using the previous Community Insights contract. Restart the API server after applying the latest database schema.",
    );
  }
  return candidate as Insights;
}

function show(value: unknown): string {
  if (value == null) return "Suppressed";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function downloadAggregateCsv(data: Insights) {
  const rows: Array<[string, string]> = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}.${index + 1}`));
    } else if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, child]) =>
        visit(child, path ? `${path}.${key}` : key),
      );
    } else {
      rows.push([path, value == null ? "Suppressed" : String(value)]);
    }
  };
  visit(data, "");
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [
    "metric,value",
    ...rows.map(([key, value]) => `${escape(key)},${escape(value)}`),
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  const purpose = data.privacy.purpose === "research" ? "research-insights" : "community-insights";
  anchor.download = `snap-${purpose}-${data.generatedAt.slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function GroupTable({ title, rows }: { title: string; rows: Group[] }) {
  const chartRows = rows
    .filter((row): row is Group & { count: number } => row.count != null)
    .slice(0, 8);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {chartRows.length > 0 && (
          <div className="mb-5 h-56" aria-label={`${title} chart`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 4, right: 8, bottom: 45, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" angle={-30} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} width={35} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#3ABBD4" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Group</TableHead>
              <TableHead className="text-right">Participants</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground">
                  No eligible data yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right">
                    {show(row.count)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function NamedCountTable({
  title,
  rows,
  labelKey,
  rateKey,
}: {
  title: string;
  rows: NamedCount[];
  labelKey: string;
  rateKey?: string;
}) {
  return (
    <GroupTable
      title={title}
      rows={rows.map((row) => ({
        label: `${String(row[labelKey] ?? "Unknown")}${
          rateKey && typeof row[rateKey] === "number"
            ? ` (${Math.round(Number(row[rateKey]) * 100)}%)`
            : ""
        }`,
        count: row.count,
        suppressed: row.count == null,
      }))}
    />
  );
}

function MetricSection({
  title,
  values,
}: {
  title: string;
  values: Record<string, unknown> | null;
}) {
  if (!values) return null;
  const primitiveRows = Object.entries(values).filter(
    ([, value]) =>
      !Array.isArray(value) && (!value || typeof value !== "object"),
  );
  const groupedRows = Object.entries(values).filter(([, value]) =>
    Array.isArray(value),
  ) as Array<[string, Group[]]>;
  const nestedRows = Object.entries(values).filter(
    ([, value]) => value && typeof value === "object" && !Array.isArray(value),
  ) as Array<[string, Record<string, unknown>]>;
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {primitiveRows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {primitiveRows.map(([key, value]) => (
            <Card key={key}>
              <CardContent className="pt-5">
                <p className="text-xs text-muted-foreground">
                  {key.replace(/([A-Z])/g, " $1")}
                </p>
                <p className="mt-1 text-2xl font-semibold">{show(value)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {nestedRows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {nestedRows.map(([key, nested]) => (
            <Card key={key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {key.replace(/([A-Z])/g, " $1")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(nested).map(([childKey, value]) => (
                  <div
                    key={childKey}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-muted-foreground">
                      {childKey.replace(/([A-Z])/g, " $1")}
                    </span>
                    <span className="font-medium">{show(value)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {groupedRows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {groupedRows.map(([key, rows]) => (
            <GroupTable
              key={key}
              title={key.replace(/([A-Z])/g, " $1")}
              rows={rows}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function CommunityInsights() {
  const { getToken } = useAuth();
  const [researchExporting, setResearchExporting] = useState(false);
  const [researchExportError, setResearchExportError] = useState<string | null>(null);
  const fetchInsights = async (purpose: "community" | "research") => {
    const token = await getToken();
    const suffix = purpose === "research" ? "?purpose=research" : "";
    const response = await fetch(`/api/admin/metrics/community-insights${suffix}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const serverMessage =
        body && typeof body === "object" && "error" in body
          ? String((body as { error?: unknown }).error ?? "")
          : "";
      throw new Error(
        serverMessage
          ? `Insights request failed (${response.status}): ${serverMessage}`
          : `Insights request failed (${response.status})`,
      );
    }
    return parseInsightsResponse(body);
  };
  const query = useQuery({
    queryKey: ["admin", "community-insights"],
    queryFn: () => fetchInsights("community"),
    refetchInterval: 60_000,
  });

  const data = query.data;
  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Community Insights
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Consent-based, aggregate population trends. No individual Bone
              Buddy conversations are included.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!data}
              onClick={() => data && downloadAggregateCsv(data)}
            >
              <Download className="mr-2 h-4 w-4" />
              Export aggregate CSV
            </Button>
            <Button
              variant="outline"
              disabled={researchExporting}
              onClick={async () => {
                setResearchExporting(true);
                setResearchExportError(null);
                try {
                  downloadAggregateCsv(await fetchInsights("research"));
                } catch (error) {
                  setResearchExportError(error instanceof Error ? error.message : "Research export failed");
                } finally {
                  setResearchExporting(false);
                }
              }}
            >
              <FlaskConical className="mr-2 h-4 w-4" />
              {researchExporting ? "Preparing…" : "Export research CSV"}
            </Button>
          </div>
        </div>

        {researchExportError && (
          <Alert variant="destructive">
            <AlertTitle>Could not export research report</AlertTitle>
            <AlertDescription>{researchExportError}</AlertDescription>
          </Alert>
        )}

        {query.isError && (
          <Alert variant="destructive">
            <AlertTitle>Could not load insights</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{query.error.message}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void query.refetch()}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {query.isLoading && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        )}
        {data && (
          <>
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>
                Privacy threshold: {data.privacy.minCohortSize}
              </AlertTitle>
              <AlertDescription>
                Only opted-in participants contribute. Any cohort smaller than
                the threshold is shown as Suppressed. Generated{" "}
                {new Date(data.generatedAt).toLocaleString()}.
              </AlertDescription>
            </Alert>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">
                    Consented participants
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {show(data.privacy.consentedParticipants)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">
                    Avg years since diagnosis
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {show(data.overview?.averageYearsSinceDiagnosis)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-5">
                  <p className="text-xs text-muted-foreground">Consent model</p>
                  <p className="mt-1 text-lg font-semibold">
                    {data.privacy.consentVersion}
                  </p>
                </CardContent>
              </Card>
            </div>
            <MetricSection title="Community overview" values={data.overview} />
            <MetricSection title="Bone health" values={data.boneHealth} />
            <MetricSection
              title="Product activity"
              values={data.productActivity ?? null}
            />
            <MetricSection title="Community engagement" values={data.community ?? null} />
            <MetricSection
              title="Nutrition (30 days)"
              values={data.nutrition}
            />
            <MetricSection
              title="Medication and supplements"
              values={data.medicationAndSupplements}
            />
            <MetricSection title="Exercise" values={data.exercise} />
            <MetricSection
              title="Learning and wellness"
              values={data.learningAndWellness}
            />
            <MetricSection
              title="Self-reported outcomes"
              values={data.outcomes}
            />
            <MetricSection title="Impact totals" values={data.impact} />
            <MetricSection title="Prevention cohorts" values={data.prevention ?? null} />
            <MetricSection title="Behaviour change" values={data.behaviourChange ?? null} />
            <MetricSection title="Data quality and coverage" values={data.dataQuality ?? null} />
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Demand and topic trends</h2>
              <div className="grid gap-4 lg:grid-cols-2">
                <NamedCountTable title="Learning pathways (30 days)" rows={data.topLearningPathways30d ?? []} labelKey="pathway" rateKey="completionRate" />
                <NamedCountTable title="Bone Buddy topics (30 days)" rows={data.topBoneBuddyTopics30d ?? []} labelKey="topic" />
                <NamedCountTable title="Wellbeing support needs (7 days)" rows={data.wellbeingSupportNeeds7d ?? []} labelKey="mood" />
                <NamedCountTable title="Coaching demand (30 days)" rows={data.coachingDemand30d ?? []} labelKey="sessionId" />
                <NamedCountTable title="Expert demand (30 days)" rows={data.expertDemand30d ?? []} labelKey="consultantId" />
              </div>
            </section>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
