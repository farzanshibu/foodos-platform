import { CouponsManager } from "@/features/manage/coupons-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageCouponsPage() {
  const promotions = await api.promotion.list({ limit: 50, cursor: null, activeOnly: false });
  return <CouponsManager promotions={promotions.items} />;
}
