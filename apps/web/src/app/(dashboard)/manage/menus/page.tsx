import { MenusManager } from "@/features/manage/menus-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageMenusPage() {
  const [restaurants, branches, menus] = await Promise.all([
    api.restaurant.list({ limit: 20, cursor: null }),
    api.branch.list({ limit: 50, cursor: null }),
    api.menu.list({ limit: 50, cursor: null }),
  ]);
  return (
    <MenusManager
      restaurants={restaurants.items}
      branches={branches.items}
      initialMenus={menus.items}
    />
  );
}
