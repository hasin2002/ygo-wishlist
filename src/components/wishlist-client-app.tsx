"use client";

import dynamic from "next/dynamic";

const ClientWishlistApp = dynamic(
  () => import("@/components/wishlist-app").then((module) => module.WishlistApp),
  {
    loading: () => (
      <main
        aria-label="Loading wishlist"
        className="app-page-shell min-h-screen bg-[#f6f4ef]"
        role="status"
      />
    ),
    ssr: false,
  },
);

export function WishlistClientApp() {
  return <ClientWishlistApp />;
}
