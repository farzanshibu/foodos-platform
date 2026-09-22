import { KitchenDisplay } from "@/features/manage/kitchen-display";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageKitchenPage() {
  const branches = await api.branch.list({ limit: 50, cursor: null });
  return <KitchenDisplay branches={branches.items} />;
}
