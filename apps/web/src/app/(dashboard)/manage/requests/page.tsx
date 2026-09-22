import { RequestsConsole } from "@/features/manage/requests-console";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageRequestsPage() {
  const branches = await api.branch.list({ limit: 50, cursor: null });
  return <RequestsConsole branches={branches.items} />;
}
