import { ReviewForm } from "@/features/table/review-form";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function TableReviewPage() {
  const session = await api.qrSession.current({});
  return (
    <ReviewForm
      restaurantId={session.context.restaurantId}
      branchId={session.context.branchId}
      restaurantName={session.context.restaurantName}
    />
  );
}
