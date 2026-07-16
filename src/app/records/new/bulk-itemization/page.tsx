import { Suspense } from "react";
import { RecordEntryApp } from "@/components/records/record-entry-app";

export default function NewBulkItemizationPage() {
  return <Suspense fallback={null}><RecordEntryApp flow="bulk-itemization" /></Suspense>;
}
