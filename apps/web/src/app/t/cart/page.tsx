import { CartPage } from "@/features/table/cart-page";
import { api } from "@/trpc/server";

export const dynamic = "force-dynamic";

export default async function TableCartPage() {
  const session = await api.qrSession.current({});
  return (
    <CartPage
      branchId={session.context.branchId ?? ""}
      placeId={session.context.placeId}
      placeKind={session.context.placeKind}
      placeLabel={session.context.placeLabel}
      guestName={session.guestName}
      guestPhone={session.guestPhone}
      pollSeconds={session.pollIntervalSeconds}
    />
  );
}
