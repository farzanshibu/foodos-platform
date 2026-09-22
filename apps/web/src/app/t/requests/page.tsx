import { RequestCards } from "@/features/table/request-cards";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function TableRequestsPage() {
  const types = await api.requestType.list({ limit: 30, cursor: null, activeOnly: true });
  return <RequestCards types={types.items} />;
}
