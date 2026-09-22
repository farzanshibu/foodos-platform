import { RestaurantsManager } from "@/features/manage/restaurants-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageRestaurantsPage() {
  const restaurants = await api.restaurant.list({ limit: 20, cursor: null });
  return <RestaurantsManager initialRestaurants={restaurants.items} />;
}
