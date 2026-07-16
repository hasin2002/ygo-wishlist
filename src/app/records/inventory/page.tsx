import { Suspense } from "react";
import { RecordsApp } from "@/components/records/records-app";

export default function RecordsInventoryPage() {
  return (
    <Suspense fallback={null}>
      <RecordsApp view="inventory" />
    </Suspense>
  );
}
