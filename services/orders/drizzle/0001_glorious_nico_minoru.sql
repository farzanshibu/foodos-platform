CREATE TABLE "ord_cart_member" (
	"cart_id" text NOT NULL,
	"session_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ord_cart_member_cart_id_session_id_pk" PRIMARY KEY("cart_id","session_id")
);
--> statement-breakpoint
ALTER TABLE "ord_cart" ADD COLUMN "place_label" text;--> statement-breakpoint
ALTER TABLE "ord_cart" ADD COLUMN "place_kind" text;--> statement-breakpoint
ALTER TABLE "ord_cart" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "ord_cart" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ord_order_item" ADD COLUMN "added_by_name" text;--> statement-breakpoint
CREATE INDEX "ord_cart_member_cart_idx" ON "ord_cart_member" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "ord_cart_place_idx" ON "ord_cart" USING btree ("organization_id","place_id","status") WHERE "ord_cart"."place_id" is not null;--> statement-breakpoint
CREATE INDEX "ord_cart_status_idx" ON "ord_cart" USING btree ("organization_id","branch_id","status");