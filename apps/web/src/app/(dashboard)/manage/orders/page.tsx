import { OrdersConsole } from "@/features/manage/orders-console";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageOrdersPage() {
  const branches = await api.branch.list({ limit: 50, cursor: null });
  return <OrdersConsole branches={branches.items} />;
}
