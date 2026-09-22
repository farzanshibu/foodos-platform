import { BranchesManager } from "@/features/manage/branches-manager";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function ManageBranchesPage() {
  const [restaurants, branches] = await Promise.all([
    api.restaurant.list({ limit: 20, cursor: null }),
    api.branch.list({ limit: 50, cursor: null }),
  ]);
  return <BranchesManager restaurants={restaurants.items} initialBranches={branches.items} />;
}
