/**
 * SOT: manage-page-shell, page-header
 * WHAT   The heading every management page shares: what this is, and the one control that
 *        belongs beside it.
 * WHY    Composed with a slot rather than a prop per variant, so a page that needs a filter
 *        row and a page that needs a create button use the same component instead of two.
 * WHY    The header sticks to the top of the scroll area, because these pages are long lists
 *        and the primary action should not be somewhere above the fold you have to go back
 *        to. The bottom padding clears the phone's bottom bar.
 */
import { EmptyState } from "@foodos/ui/empty-state";
import {
  Bell,
  Building2,
  ChefHat,
  CircleHelp,
  DoorOpen,
  Folders,
  Gift,
  type LucideIcon,
  MapPin,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  ScanLine,
  Star,
  Store,
  Tag,
  Ticket,
  Users,
  UtensilsCrossed,
} from "lucide-react";

export function PageShell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1 className="font-semibold text-foreground text-xl tracking-[-0.015em]">{title}</h1>
          {description === undefined ? null : (
            <p className="max-w-prose text-muted-foreground text-sm">{description}</p>
          )}
        </div>
        {action === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
        )}
      </header>
      {children}
    </div>
  );
}

/**
 * Emoji to the platform's line icons, resolved in one place.
 *
 * Twenty-four screens each passed an emoji, and an emoji is a different picture on Android
 * than on iOS, rendered as full-colour illustration at a weight nothing else in the product
 * uses. Mapping here rather than editing twenty-four call sites means the screens keep
 * naming what they hold and this file decides how the product draws it.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  "📷": ScanLine,
  "🖨️": Printer,
  "🎁": Gift,
  "🎟️": Ticket,
  "🚪": DoorOpen,
  "🔳": QrCode,
  "➕": Plus,
  "🏢": Building2,
  "🏪": Store,
  "📖": UtensilsCrossed,
  "👥": Users,
  "📍": MapPin,
  "🔔": Bell,
  "🍳": ChefHat,
  "🗂️": Folders,
  "⭐": Star,
  "🍽️": UtensilsCrossed,
  "🍱": UtensilsCrossed,
  "🧾": ReceiptText,
  "🏷️": Tag,
};

/** What a list says when it is empty, rather than showing an empty table with headers. */
export function Empty({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  // An unmapped glyph gets the neutral one rather than falling back to the emoji: a single
  // colour illustration among line icons is more obviously wrong than a generic mark.
  const Icon = ICONS[icon] ?? CircleHelp;
  return <EmptyState icon={<Icon />} title={title} detail={detail} />;
}
