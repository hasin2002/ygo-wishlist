import { Suspense } from "react";
import { RecordsApp } from "@/components/records/records-app";
import { RecordsContentLoading } from "@/components/records/records-loading-screen";

export default function RecordsInventoryPage() {
  return (
    <Suspense fallback={<RecordsContentLoading />}>
      <RecordsApp view="inventory" />
    </Suspense>
  );
}
