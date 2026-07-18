import { Suspense } from "react";
import { RecordsApp } from "@/components/records/records-app";
import { RecordsLoadingScreen } from "@/components/records/records-loading-screen";

export default function RecordsInventoryPage() {
  return (
    <Suspense fallback={<RecordsLoadingScreen />}>
      <RecordsApp view="inventory" />
    </Suspense>
  );
}
