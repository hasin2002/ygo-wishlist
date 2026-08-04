import { redirect } from "next/navigation";

export default function NewEbayLotPage() {
  // Historical lot records still render in the Listings workspace; only the
  // creation journey is retired.
  redirect("/records/listings/new");
}
