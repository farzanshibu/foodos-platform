import { ModifiersManager } from "@/features/manage/modifiers-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageModifiersPage() {
  const items = await api.menuItem.list({ limit: 100, cursor: null, availableOnly: false });
  return <ModifiersManager items={items.items} />;
}
