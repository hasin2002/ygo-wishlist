import { Suspense } from "react";
import { RecordEntryApp } from "@/components/records/record-entry-app";

export default function NewPurchasePage() {
  return <Suspense fallback={null}><RecordEntryApp flow="purchase" /></Suspense>;
}
