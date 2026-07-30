import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AddWishlistApp } from "@/components/wishlist-app";

export const runtime = "nodejs";

export default async function AddWishlistPage() {
  const localPreviewReview =
    process.env.NODE_ENV !== "production"
    && process.env.NEXT_PUBLIC_RECORDS_UI_PREVIEW === "1"
    && (await headers()).get("x-records-test-live") !== "1";
  const session = localPreviewReview
    ? null
    : await (await import("@/server/session")).getCurrentSession();

  if (!session && !localPreviewReview) {
    redirect("/login?next=/wishlist/new");
  }

  return <AddWishlistApp />;
}
