"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { RarityCombobox } from "@/components/rarity-combobox";
import { DestructiveToast } from "@/components/records/entry-form-ui";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import type { ProductEdition } from "@/lib/records/types";

const fieldClass = "mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm";

export type ProductFetchStatus = "idle" | "fetching" | "resolved" | "attention" | "stale";

export type ProductIdentityDraft = {
  tcgplayerUrl: string;
  name: string;
  imageUrl: string | null;
  edition: ProductEdition | "";
  rarity: string;
  setName: string;
  setCode: string;
  cardType: string;
  fetchStatus: ProductFetchStatus;
  fetchAttempted: boolean;
  fetchMessage: string;
  metadataNeedsAttention: boolean;
  editedFields: string[];
};

export function blankProductIdentity(name = ""): ProductIdentityDraft {
  return {
    tcgplayerUrl: "",
    name,
    imageUrl: null,
    edition: "",
    rarity: "",
    setName: "",
    setCode: "",
    cardType: "",
    fetchStatus: "idle",
    fetchAttempted: false,
    fetchMessage: "",
    metadataNeedsAttention: false,
    editedFields: name ? ["name"] : [],
  };
}

export function isTcgplayerProductUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return (
      (host === "tcgplayer.com" || host.endsWith(".tcgplayer.com")) &&
      /\/product\/\d+(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function FieldOrigin({ edited, fetched }: { edited: boolean; fetched: boolean }) {
  if (edited) return <span className="ml-2 text-[11px] font-bold text-amber-700">Edited</span>;
  if (fetched) return <span className="ml-2 text-[11px] font-bold text-emerald-700">Auto-filled</span>;
  return null;
}

export function ProductIdentityEditor({
  kind,
  onChange,
  value,
}: {
  kind: "card" | "sealed";
  onChange: (value: ProductIdentityDraft) => void;
  value: ProductIdentityDraft;
}) {
  const source = useRecordsDataSource();
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const fetched = value.fetchAttempted && value.fetchStatus !== "attention";

  function updateField(field: keyof ProductIdentityDraft, nextValue: string) {
    const editedFields = value.editedFields.includes(field)
      ? value.editedFields
      : [...value.editedFields, field];
    onChange({ ...value, [field]: nextValue, editedFields });
  }

  async function fetchDetails(force = false) {
    if (!isTcgplayerProductUrl(value.tcgplayerUrl)) {
      const message = "Use a complete TCGplayer product link containing a product ID.";
      setFetchError(message);
      onChange({
        ...value,
        fetchAttempted: true,
        fetchStatus: "attention",
        fetchMessage: message,
        metadataNeedsAttention: true,
      });
      return;
    }
    if (value.editedFields.length && value.fetchAttempted && !force) {
      setConfirmOverwrite(true);
      return;
    }

    setConfirmOverwrite(false);
    setFetchError(null);
    onChange({ ...value, fetchStatus: "fetching", fetchMessage: "" });
    const result = await source.resolveTcgplayerProduct(value.tcgplayerUrl.trim());
    if (!result.ok) {
      setFetchError(result.message);
      onChange({
        ...value,
        fetchAttempted: true,
        fetchStatus: "attention",
        fetchMessage: result.message,
        metadataNeedsAttention: true,
      });
      return;
    }

    const metadata = result.metadata;
    setFetchError(null);
    const missingRequired =
      !metadata.title ||
      (kind === "card" && !metadata.rarity) ||
      (kind === "sealed" && !metadata.edition);
    const incomplete = missingRequired || !metadata.imageUrl || (kind === "card" && (!metadata.setName || !metadata.setCode));
    onChange({
      ...value,
      name: metadata.title || value.name,
      imageUrl: metadata.imageUrl || value.imageUrl,
      edition: kind === "sealed" ? metadata.edition || value.edition : "",
      rarity: kind === "card" ? metadata.rarity || value.rarity : "",
      setName: kind === "card" ? metadata.setName || value.setName : "",
      setCode: kind === "card" ? metadata.setCode || value.setCode : "",
      cardType: metadata.cardType || value.cardType,
      fetchAttempted: true,
      fetchStatus: incomplete ? "attention" : "resolved",
      fetchMessage: incomplete
        ? "Some details were not available. Check the populated fields and complete what you know."
        : metadata.resolution === "fallback"
          ? "Details recovered from the TCGplayer link and card catalogue. Check them before continuing."
          : "Details fetched. Check them before continuing.",
      metadataNeedsAttention: incomplete,
      editedFields: [],
    });
  }

  return (
    <div className="grid gap-4">
      <DestructiveToast message={fetchError} onDismiss={() => setFetchError(null)} />
      <div>
        <label className="block">
          <span className="text-sm font-bold text-zinc-700">TCGplayer product link <span className="text-rose-700">*</span></span>
          <input
            className={fieldClass}
            inputMode="url"
            onChange={(event) => onChange({
              ...value,
              tcgplayerUrl: event.target.value,
              fetchStatus: value.fetchAttempted ? "stale" : "idle",
              fetchMessage: value.fetchAttempted ? "Link changed. Fetch details again before continuing." : "",
              metadataNeedsAttention: value.fetchAttempted,
            })}
            placeholder="https://www.tcgplayer.com/product/…"
            required
            type="url"
            value={value.tcgplayerUrl}
          />
        </label>
        <button
          className="mt-2 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
          disabled={value.fetchStatus === "fetching" || !value.tcgplayerUrl.trim()}
          onClick={() => void fetchDetails()}
          type="button"
        >
          {value.fetchStatus === "fetching" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="size-4" />}
          {value.fetchStatus === "fetching" ? "Fetching details…" : value.fetchAttempted ? "Fetch again" : "Fetch details"}
        </button>
      </div>

      <div aria-live="polite">
        {value.fetchStatus === "fetching" ? (
          <div className="grid min-h-24 animate-pulse grid-cols-[72px_1fr] gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 motion-reduce:animate-none">
            <span className="rounded-md bg-zinc-200" />
            <span className="space-y-2"><span className="block h-4 w-2/3 rounded bg-zinc-200" /><span className="block h-3 w-1/2 rounded bg-zinc-200" /></span>
          </div>
        ) : value.fetchAttempted ? (
          <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-sm font-medium ${value.fetchStatus === "resolved" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
            {value.fetchStatus === "resolved" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0" />}
            <p>{value.fetchMessage}</p>
          </div>
        ) : null}
      </div>

      {confirmOverwrite ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
          <p className="font-bold">Fetching again may replace your edited fields.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button className="min-h-11 rounded-md bg-amber-900 px-4 font-bold text-white" onClick={() => void fetchDetails(true)} type="button">Replace with fetched details</button>
            <button className="min-h-11 rounded-md border border-amber-400 px-4 font-bold" onClick={() => setConfirmOverwrite(false)} type="button">Keep my edits</button>
          </div>
        </div>
      ) : null}

      {value.imageUrl ? (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <Image
            alt={value.name ? `${value.name} product` : "Fetched TCGplayer product"}
            className="size-24 rounded-md object-contain"
            height={96}
            src={`/api/image-proxy?url=${encodeURIComponent(value.imageUrl)}`}
            unoptimized
            width={96}
          />
          <div className="min-w-0">
            <p className="font-bold text-zinc-950">{value.name || "Product details"}</p>
            <p className="mt-1 text-sm font-medium text-zinc-500">Check every auto-filled field before continuing.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-sm font-bold text-zinc-700">{kind === "card" ? "Card name" : "Product name"} <span className="text-rose-700">*</span><FieldOrigin edited={value.editedFields.includes("name")} fetched={fetched && Boolean(value.name)} /></span>
          <input className={fieldClass} onChange={(event) => updateField("name", event.target.value)} required value={value.name} />
        </label>
        {kind === "card" ? (
          <div>
            <RarityCombobox onChange={(rarity) => updateField("rarity", rarity)} required value={value.rarity} />
            <FieldOrigin edited={value.editedFields.includes("rarity")} fetched={fetched && Boolean(value.rarity)} />
          </div>
        ) : null}
        {kind === "card" ? (
          <>
            <label>
              <span className="text-sm font-bold text-zinc-700">Set name<FieldOrigin edited={value.editedFields.includes("setName")} fetched={fetched && Boolean(value.setName)} /></span>
              <input className={fieldClass} onChange={(event) => updateField("setName", event.target.value)} placeholder="Auto-filled when available" value={value.setName} />
            </label>
            <label>
              <span className="text-sm font-bold text-zinc-700">Set code<FieldOrigin edited={value.editedFields.includes("setCode")} fetched={fetched && Boolean(value.setCode)} /></span>
              <input className={fieldClass} onChange={(event) => updateField("setCode", event.target.value)} placeholder="Auto-filled when available" value={value.setCode} />
            </label>
          </>
        ) : (
          <label className="sm:col-span-2 sm:max-w-sm">
            <span className="text-sm font-bold text-zinc-700">Product edition <span className="text-rose-700">*</span><FieldOrigin edited={value.editedFields.includes("edition")} fetched={fetched && Boolean(value.edition)} /></span>
            <select
              className={fieldClass}
              onChange={(event) => updateField("edition", event.target.value)}
              required
              value={value.edition}
            >
              <option value="">Choose edition</option>
              <option value="1st Edition">1st Edition</option>
              <option value="Unlimited Edition">Unlimited Edition</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
