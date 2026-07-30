import { Suspense } from "react";
import { RecordEntryApp } from "@/components/records/record-entry-app";

export default function NewSalePage() {
  return <Suspense fallback={null}><RecordEntryApp flow="sale" /></Suspense>;
}
