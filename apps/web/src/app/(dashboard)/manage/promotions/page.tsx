import { PromotionsManager } from "@/features/manage/promotions-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManagePromotionsPage() {
  const restaurants = await api.restaurant.list({ limit: 20, cursor: null });
  return <PromotionsManager restaurants={restaurants.items} />;
}
