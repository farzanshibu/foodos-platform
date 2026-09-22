import { CardDesigner } from "@/features/manage/card-designer";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageCardDesignerPage() {
  const types = await api.requestType.list({ limit: 50, cursor: null, activeOnly: false });
  return <CardDesigner requestTypes={types.items} />;
}
