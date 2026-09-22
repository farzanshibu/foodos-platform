import { CombosManager } from "@/features/manage/combos-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageCombosPage() {
  const [restaurants, items, combos] = await Promise.all([
    api.restaurant.list({ limit: 20, cursor: null }),
    api.menuItem.list({ limit: 200, cursor: null, availableOnly: false }),
    api.combo.list({ limit: 50, cursor: null, availableOnly: false }),
  ]);
  return (
    <CombosManager
      restaurants={restaurants.items}
      items={items.items}
      initialCombos={combos.items}
    />
  );
}
