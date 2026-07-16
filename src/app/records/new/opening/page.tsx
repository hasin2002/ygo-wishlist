import { Suspense } from "react";
import { RecordEntryApp } from "@/components/records/record-entry-app";

export default function NewOpeningPage() {
  return <Suspense fallback={null}><RecordEntryApp flow="pack-opening" /></Suspense>;
}
