import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, Sparkles, Clock3, XCircle, Gauge, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { ClassificationDistributionChart } from "./components/ClassificationDistributionChart";
import { ConfidenceTrendChart } from "./components/ConfidenceTrendChart";
import { SourceBreakdownChart } from "./components/SourceBreakdownChart";
import { useSignals } from "../../hooks/useSignals";
import { useActiveProject } from "../../hooks/useActiveProject";
import { cn } from "../../lib/utils";

// "This Sprint" needs sprint dates from the schedule component, which is not connected yet; it is only offered
// when the project has them.
const RANGE_OPTIONS = [
  { key: "7d", label: "Last 7 Days" },
  { key: "30d", label: "Last 30 Days" },
  { key: "90d", label: "Last 90 Days" },
  { key: "sprint", label: "This Sprint" },
];

const SOURCE_ORDER = ["Standup", "Slack", "Email", "Jira Comment", "Teams", "Document Upload"];

// Every mock timestamp in this app is written in +05:30, so "today" and
// "which day did this signal land on" only mean one consistent thing if
// resolved against that same offset, not whatever timezone this code
// happens to be running in. isoDate() below is the one place that
// resolves a real timestamp to its "YYYY-MM-DD" calendar day; every other
// date helper here does pure string/UTC-int arithmetic on that key and
// never touches a local timezone again, so bucket boundaries can't drift
// a day depending on where this runs.
const APP_TZ = "Asia/Colombo";

function isoDate(timestamp) {
  return new Date(timestamp).toLocaleDateString("en-CA", { timeZone: APP_TZ });
}
function addDaysToKey(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(x.getUTCDate()).padStart(2, "0")}`;
}
function shortDateFromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

// `today` is the day of the project's newest signal (or the real today if there are none), so the ranges follow the
// data instead of a fixed demo date.
function getRangeBounds(rangeKey, activeProject, today) {
  if (rangeKey === "7d") return { from: addDaysToKey(today, -6), to: today, granularity: "day" };
  if (rangeKey === "90d") return { from: addDaysToKey(today, -89), to: today, granularity: "week" };
  if (rangeKey === "sprint" && activeProject?.activeSprint?.startDate && activeProject?.activeSprint?.endDate) {
    const sprintStart = isoDate(activeProject.activeSprint.startDate);
    const sprintEnd = isoDate(activeProject.activeSprint.endDate);
    return { from: sprintStart, to: sprintEnd < today ? sprintEnd : today, granularity: "day" };
  }
  return { from: addDaysToKey(today, -29), to: today, granularity: "week" };
}

// Buckets the filtered signal set into day-or-week slots and folds each
// one's classification counts / average confidence straight out of the
// same records, no parallel aggregate dataset, just mockSignals.js
// grouped differently. `from`/`to`/bucket `start`/`end` are all
// "YYYY-MM-DD" keys throughout, compared as strings (which sorts
// correctly for ISO dates) rather than Date objects.
function buildBuckets(signals, { from, to, granularity }) {
  const shells = [];
  if (granularity === "day") {
    let cursor = from;
    while (cursor <= to) {
      shells.push({ key: cursor, start: cursor, end: cursor, label: shortDateFromKey(cursor) });
      cursor = addDaysToKey(cursor, 1);
    }
  } else {
    let cursor = from;
    while (cursor <= to) {
      const weekEnd = addDaysToKey(cursor, 6);
      const end = weekEnd > to ? to : weekEnd;
      shells.push({ key: cursor, start: cursor, end, label: `${shortDateFromKey(cursor)} – ${shortDateFromKey(end)}` });
      cursor = addDaysToKey(end, 1);
    }
  }

  return shells.map((shell) => {
    const inBucket = signals.filter((s) => {
      const dayKey = isoDate(s.timestamp);
      return dayKey >= shell.start && dayKey <= shell.end;
    });
    const counts = { Constraint: 0, Expectation: 0, Completion: 0, Conflict: 0, None: 0 };
    inBucket.forEach((s) => {
      if (s.classification) counts[s.classification] = (counts[s.classification] ?? 0) + 1; // unclassified signals are not counted
    });
    // Dataset (seeded) signals have no model confidence: they are left out of the average.
    const scored = inBucket.filter((s) => s.confidence != null);
    const avgConfidence = scored.length ? Math.round(scored.reduce((sum, s) => sum + s.confidence, 0) / scored.length) : null;
    return { ...shell, signals: inBucket, counts, total: inBucket.length, avgConfidence };
  });
}

function KpiTile({ label, value, icon: Icon, highlight }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0">
          <p className={cn("text-lg font-bold leading-none text-foreground", highlight)}>{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SignalAnalyticsPage() {
  const { activeProjectId, activeProject } = useActiveProject();
  const { data: signals, loading, error, reload } = useSignals(activeProjectId);
  const navigate = useNavigate();
  const [rangeKey, setRangeKey] = useState("30d");

  const today = useMemo(() => {
    if (!signals.length) return isoDate(new Date());
    return isoDate(Math.max(...signals.map((s) => new Date(s.timestamp).getTime())));
  }, [signals]);
  const rangeOptions = useMemo(
    () => RANGE_OPTIONS.filter((r) => r.key !== "sprint" || (activeProject?.activeSprint?.startDate && activeProject?.activeSprint?.endDate)),
    [activeProject]
  );

  const { from, to, granularity } = useMemo(
    () => getRangeBounds(rangeKey, activeProject, today),
    [rangeKey, activeProject, today]
  );

  const inRange = useMemo(
    () => signals.filter((s) => { const dayKey = isoDate(s.timestamp); return dayKey >= from && dayKey <= to; }),
    [signals, from, to]
  );

  const buckets = useMemo(() => buildBuckets(inRange, { from, to, granularity }), [inRange, from, to, granularity]);

  const kpis = useMemo(() => {
    const total = inRange.length;
    const autoApplied = inRange.filter((s) => s.applied && !s.reviewAction).length; // applied without a PM decision
    const pending = inRange.filter((s) => s.reviewStatus === "pending").length;
    const rejected = inRange.filter((s) => s.reviewStatus === "rejected").length;
    const scored = inRange.filter((s) => s.confidence != null);
    const avgConfidence = scored.length ? Math.round(scored.reduce((sum, s) => sum + s.confidence, 0) / scored.length) : null;
    return { total, autoApplied, pending, rejected, avgConfidence };
  }, [inRange]);

  const sourceCounts = useMemo(
    () => SOURCE_ORDER.map((source) => ({ source, count: inRange.filter((s) => s.source === source).length })),
    [inRange]
  );

  const rangeLabel = RANGE_OPTIONS.find((r) => r.key === rangeKey)?.label ?? "";

  if (error && !loading) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
        <AlertCircle className="h-6 w-6 text-status-dropped-fg" />
        <p className="text-sm font-medium text-foreground">Could not load the signals for the analytics.</p>
        <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
        <button onClick={reload} className="text-sm font-medium text-primary hover:underline">
          Try again
        </button>
      </div>
    );
  }

  const goToSignalFeed = (params) => {
    const search = new URLSearchParams({ tab: "signals", ...params });
    navigate(`/projects/${activeProjectId}/requirements/list?${search.toString()}`);
  };

  const handleSelectSegment = (bucket, classification) => {
    goToSignalFeed({ classification, from: bucket.start, to: bucket.end });
  };
  const handleSelectConfidencePoint = (bucket) => {
    goToSignalFeed({ from: bucket.start, to: bucket.end });
  };
  const handleSelectSource = (source) => {
    goToSignalFeed({ source, from, to });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{rangeLabel}</p>
        <Select value={rangeKey} onValueChange={setRangeKey}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rangeOptions.map((opt) => (
              <SelectItem key={opt.key} value={opt.key}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[4.5rem] w-full rounded-xl" />)
          : [
              { label: `Total Signals (${rangeLabel})`, value: kpis.total, icon: Radio },
              { label: "Auto-Applied", value: kpis.autoApplied, icon: Sparkles, highlight: "text-status-confirmed-fg" },
              { label: "Pending Review", value: kpis.pending, icon: Clock3, highlight: "text-status-atrisk-fg" },
              { label: "Rejected", value: kpis.rejected, icon: XCircle, highlight: "text-status-dropped-fg" },
              { label: "Average Confidence", value: kpis.avgConfidence == null ? "–" : `${kpis.avgConfidence}%`, icon: Gauge },
            ].map((kpi) => <KpiTile key={kpi.label} {...kpi} />)}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classification Distribution</CardTitle>
          <CardDescription>Click a segment to jump to those signals in the Signal Feed.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-52 w-full" /> : <ClassificationDistributionChart buckets={buckets} onSelectSegment={handleSelectSegment} />}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Confidence Trend</CardTitle>
            <CardDescription>Click a point to jump to that period's signals.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-52 w-full" /> : <ConfidenceTrendChart buckets={buckets} onSelectPoint={handleSelectConfidencePoint} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Source Breakdown</CardTitle>
            <CardDescription>Click a source to jump to those signals.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-40 w-full" /> : <SourceBreakdownChart sourceCounts={sourceCounts} onSelectSource={handleSelectSource} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
