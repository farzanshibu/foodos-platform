import { PlacesManager } from "@/features/manage/places-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageTablesPage() {
  const [branches, parameters] = await Promise.all([
    api.branch.list({ limit: 50, cursor: null }),
    api.parameterDefinition.list({
      limit: 50,
      cursor: null,
      customerVisibleOnly: false,
      includeInactive: false,
    }),
  ]);
  return <PlacesManager branches={branches.items} parameters={parameters.items} />;
}
