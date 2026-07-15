import { Suspense } from "react";
import { WishlistApp } from "@/components/wishlist-app";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <WishlistApp />
    </Suspense>
  );
}
