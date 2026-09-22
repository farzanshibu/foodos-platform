import { ItemsManager } from "@/features/manage/items-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageItemsPage() {
  const [menus, categories, items] = await Promise.all([
    api.menu.list({ limit: 50, cursor: null }),
    api.menuCategory.list({ limit: 100, cursor: null }),
    api.menuItem.list({ limit: 100, cursor: null, availableOnly: false }),
  ]);
  return (
    <ItemsManager menus={menus.items} categories={categories.items} initialItems={items.items} />
  );
}
