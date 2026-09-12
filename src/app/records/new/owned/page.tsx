import { Suspense } from "react";
import { OwnedCardsApp } from "@/components/records/owned-cards-app";

export default function AddOwnedCardsPage() {
  return <Suspense fallback={null}><OwnedCardsApp /></Suspense>;
}
