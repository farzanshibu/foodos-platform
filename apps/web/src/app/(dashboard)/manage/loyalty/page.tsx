import { LoyaltyManager } from "@/features/manage/loyalty-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageLoyaltyPage() {
  const restaurants = await api.restaurant.list({ limit: 20, cursor: null });
  return <LoyaltyManager restaurants={restaurants.items} />;
}
