/**
 * SOT: guest-menu-page, qr-menu
 * WHAT   The menu, as seen from a table.
 * WHY    Server-rendered because the whole promise of the QR is that it opens instantly. The
 *        categories, dishes and combos all arrive in the first response; the only client
 *        work is picking things.
 * WHERE  apps/web/src/features/table/menu-board.tsx
 */
import { MenuBoard } from "@/features/table/menu-board";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function TableMenuPage() {
  const session = await api.qrSession.current({});
  const menuId = session.context.menuId;

  const [categories, items, combos] = await Promise.all([
    api.menuCategory.list({ limit: 50, cursor: null, ...(menuId === null ? {} : { menuId }) }),
    api.menuItem.list({
      limit: 100,
      cursor: null,
      availableOnly: true,
      ...(menuId === null ? {} : { menuId }),
    }),
    api.combo.list({ limit: 50, cursor: null, availableOnly: true }),
  ]);

  return (
    <MenuBoard
      categories={categories.items}
      items={items.items}
      combos={combos.items}
      branchId={session.context.branchId ?? ""}
      orderingEnabled={session.context.orderingEnabled}
    />
  );
}
