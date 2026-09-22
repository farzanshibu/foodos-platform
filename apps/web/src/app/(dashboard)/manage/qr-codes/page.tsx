import { QrManager } from "@/features/manage/qr-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageQrPage() {
  const [restaurants, branches, tables] = await Promise.all([
    api.restaurant.list({ limit: 20, cursor: null }),
    api.branch.list({ limit: 50, cursor: null }),
    api.place.list({
      limit: 200,
      cursor: null,
      parameterFilters: [],
      customerVisibleParametersOnly: false,
    }),
  ]);
  return (
    <QrManager restaurants={restaurants.items} branches={branches.items} tables={tables.items} />
  );
}
