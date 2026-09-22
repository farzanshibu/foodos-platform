import { CategoriesManager } from "@/features/manage/categories-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageCategoriesPage() {
  const [menus, categories] = await Promise.all([
    api.menu.list({ limit: 50, cursor: null }),
    api.menuCategory.list({ limit: 100, cursor: null }),
  ]);
  return <CategoriesManager menus={menus.items} initialCategories={categories.items} />;
}
