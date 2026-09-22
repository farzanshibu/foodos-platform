import { AnalyticsDashboard } from "@/features/manage/analytics-dashboard";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageAnalyticsPage() {
  const branches = await api.branch.list({ limit: 50, cursor: null });
  return <AnalyticsDashboard branches={branches.items} />;
}
