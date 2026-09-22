import { RequestTypesManager } from "@/features/manage/request-types-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageRequestTypesPage() {
  const [restaurants, types] = await Promise.all([
    api.restaurant.list({ limit: 20, cursor: null }),
    api.requestType.list({ limit: 50, cursor: null, activeOnly: false }),
  ]);
  return <RequestTypesManager restaurants={restaurants.items} initialTypes={types.items} />;
}
