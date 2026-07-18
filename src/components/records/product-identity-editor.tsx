"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RarityCombobox } from "@/components/rarity-combobox";
import { DestructiveToast } from "@/components/records/entry-form-ui";
import { useRecordsDataSource } from "@/components/records/records-preview-provider";
import type { LibraryCardSuggestion, ProductEdition } from "@/lib/records/types";

const fieldClass = "mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm";

export type ProductFetchStatus = "idle" | "fetching" | "resolved" | "attention" | "stale";

export type ProductIdentityDraft = {
  selectedTargetId: string | null;
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

export function blankProductIdentity(
  name = "",
  edition: ProductEdition | "" = "",
): ProductIdentityDraft {
  return {
    selectedTargetId: null,
    tcgplayerUrl: "",
    name,
    imageUrl: null,
    edition,
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
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const closeSuggestionsTimeout = useRef<number | null>(null);
  const requestId = useRef(0);
  const suggestions = useMemo(
    () => kind === "card" ? source.searchLibraryCards(value.name) : [],
    [kind, source, value.name],
  );
  const fetched =
    value.fetchAttempted &&
    (value.fetchStatus === "resolved" || value.fetchStatus === "attention");

  useEffect(() => () => {
    if (closeSuggestionsTimeout.current !== null) window.clearTimeout(closeSuggestionsTimeout.current);
  }, []);

  function updateField(field: keyof ProductIdentityDraft, nextValue: string) {
    const editedFields = value.editedFields.includes(field)
      ? value.editedFields
      : [...value.editedFields, field];
    onChange({ ...value, [field]: nextValue, editedFields });
  }

  function applyLibrarySuggestion(suggestion: LibraryCardSuggestion) {
    const complete = Boolean(
      suggestion.tcgplayerUrl &&
      suggestion.name &&
      suggestion.rarity &&
      suggestion.edition &&
      suggestion.setName &&
      suggestion.setCode,
    );
    onChange({
      ...value,
      selectedTargetId: suggestion.targetId,
      tcgplayerUrl: suggestion.tcgplayerUrl ?? "",
      name: suggestion.name,
      imageUrl: suggestion.imageUrl,
      edition: suggestion.edition,
      rarity: suggestion.rarity,
      setName: suggestion.setName,
      setCode: suggestion.setCode,
      fetchAttempted: true,
      fetchStatus: complete ? "resolved" : "attention",
      fetchMessage: complete
        ? "Details loaded from your Library. Check them before continuing."
        : "Details loaded from your Library. Complete anything missing before continuing.",
      metadataNeedsAttention: !complete,
      editedFields: [],
    });
    setSuggestionsOpen(false);
  }

  function handleSuggestionKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen || !suggestions.length) {
      if (event.key === "ArrowDown" && suggestions.length) setSuggestionsOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => Math.min(current + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      applyLibrarySuggestion(suggestions[activeSuggestionIndex]);
    } else if (event.key === "Escape") {
      setSuggestionsOpen(false);
    }
  }

  async function fetchDetails(force = false) {
    const replacingProduct = value.fetchStatus === "stale";
    const requestedUrl = value.tcgplayerUrl.trim();
    const requestValue: ProductIdentityDraft = replacingProduct
      ? {
          ...blankProductIdentity("", kind === "card" ? "1st Edition" : ""),
          selectedTargetId: value.selectedTargetId,
          tcgplayerUrl: requestedUrl,
          fetchAttempted: true,
        }
      : {
          ...value,
          tcgplayerUrl: requestedUrl,
        };

    if (!isTcgplayerProductUrl(requestedUrl)) {
      requestId.current += 1;
      const message = "Use a complete TCGplayer product link containing a product ID.";
      setFetchError(message);
      onChange({
        ...requestValue,
        fetchAttempted: true,
        fetchStatus: "attention",
        fetchMessage: message,
        metadataNeedsAttention: true,
      });
      return;
    }
    if (
      !replacingProduct &&
      value.editedFields.length &&
      value.fetchAttempted &&
      !force
    ) {
      setConfirmOverwrite(true);
      return;
    }

    const activeRequestId = ++requestId.current;
    const pendingValue: ProductIdentityDraft = {
      ...requestValue,
      fetchStatus: "fetching",
      fetchMessage: "",
    };

    setConfirmOverwrite(false);
    setFetchError(null);
    onChange(pendingValue);
    const result = await source.resolveTcgplayerProduct(requestedUrl);

    if (activeRequestId !== requestId.current) {
      return;
    }

    if (!result.ok) {
      setFetchError(result.message);
      onChange({
        ...pendingValue,
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
      (kind === "card" && (!metadata.rarity || !pendingValue.edition)) ||
      (kind === "sealed" && !metadata.edition);
    const incomplete = missingRequired || !metadata.imageUrl || (kind === "card" && (!metadata.setName || !metadata.setCode));
    onChange({
      ...pendingValue,
      name: metadata.title || pendingValue.name,
      imageUrl: metadata.imageUrl || pendingValue.imageUrl,
      edition: kind === "sealed"
        ? metadata.edition || pendingValue.edition
        : pendingValue.edition || "1st Edition",
      rarity: kind === "card" ? metadata.rarity || pendingValue.rarity : "",
      setName: kind === "card" ? metadata.setName || pendingValue.setName : "",
      setCode: kind === "card" ? metadata.setCode || pendingValue.setCode : "",
      cardType: metadata.cardType || pendingValue.cardType,
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
            autoComplete="off"
            className={fieldClass}
            inputMode="url"
            onChange={(event) => {
              requestId.current += 1;
              setConfirmOverwrite(false);
              setFetchError(null);
              onChange({
                ...value,
                tcgplayerUrl: event.target.value,
                fetchStatus: value.fetchAttempted ? "stale" : "idle",
                fetchMessage: value.fetchAttempted
                  ? "Link changed. Fetch details again before continuing. Previous details will be cleared when you fetch."
                  : "",
                metadataNeedsAttention: value.fetchAttempted,
              });
            }}
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
        <label className="relative sm:col-span-2">
          <span className="text-sm font-bold text-zinc-700">{kind === "card" ? "Card name" : "Product name"} <span className="text-rose-700">*</span><FieldOrigin edited={value.editedFields.includes("name")} fetched={fetched && Boolean(value.name)} /></span>
          <input
            autoComplete="off"
            aria-activedescendant={suggestionsOpen && suggestions.length ? `library-card-suggestion-${activeSuggestionIndex}` : undefined}
            aria-autocomplete={kind === "card" ? "list" : undefined}
            aria-controls={kind === "card" ? "library-card-suggestions" : undefined}
            aria-expanded={kind === "card" && suggestionsOpen && suggestions.length > 0}
            className={fieldClass}
            onBlur={() => {
              closeSuggestionsTimeout.current = window.setTimeout(() => setSuggestionsOpen(false), 120);
            }}
            onChange={(event) => {
              const nextName = event.target.value;
              const editedFields = value.editedFields.includes("name")
                ? value.editedFields
                : [...value.editedFields, "name"];
              onChange({
                ...value,
                name: nextName,
                selectedTargetId: nextName === value.name ? value.selectedTargetId : null,
                editedFields,
              });
              setActiveSuggestionIndex(0);
              setSuggestionsOpen(true);
            }}
            onFocus={() => {
              if (kind === "card" && suggestions.length) setSuggestionsOpen(true);
            }}
            onKeyDown={kind === "card" ? handleSuggestionKeys : undefined}
            required
            role={kind === "card" ? "combobox" : undefined}
            value={value.name}
          />
          {kind === "card" && suggestionsOpen && suggestions.length ? (
            <div
              className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg"
              id="library-card-suggestions"
              role="listbox"
            >
              <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-zinc-500">Matches from your Wishlist</p>
              {suggestions.map((suggestion, index) => (
                <button
                  aria-selected={index === activeSuggestionIndex}
                  className={`flex min-h-11 w-full cursor-pointer items-center rounded-md px-3 py-2 text-left text-sm transition ${index === activeSuggestionIndex ? "bg-rose-50 text-rose-950" : "hover:bg-zinc-50"}`}
                  id={`library-card-suggestion-${index}`}
                  key={`${suggestion.targetId}-${suggestion.printingId ?? "target"}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveSuggestionIndex(index)}
                  onClick={() => applyLibrarySuggestion(suggestion)}
                  role="option"
                  type="button"
                >
                  <span className="truncate font-semibold">{suggestion.name}</span>
                  <span className="truncate text-zinc-500">&nbsp;· {suggestion.rarity || "Unknown rarity"} · {suggestion.edition || "Unknown edition"} · {suggestion.setName || "Unknown set"}</span>
                </button>
              ))}
            </div>
          ) : null}
        </label>
        {kind === "card" ? (
          <RarityCombobox
            labelSuffix={
              <FieldOrigin
                edited={value.editedFields.includes("rarity")}
                fetched={fetched && Boolean(value.rarity)}
              />
            }
            onChange={(rarity) => updateField("rarity", rarity)}
            required
            value={value.rarity}
          />
        ) : null}
        {kind === "card" ? (
          <label>
            <span className="text-sm font-bold text-zinc-700">Card edition <span className="text-rose-700">*</span></span>
            <select
              className={fieldClass}
              onChange={(event) => updateField("edition", event.target.value)}
              required
              value={value.edition}
            >
              <option value="1st Edition">1st Edition</option>
              <option value="Unlimited Edition">Unlimited Edition</option>
              <option value="Limited Edition">Limited Edition</option>
            </select>
            <span className="mt-1 block text-xs font-medium text-zinc-500">Defaults to 1st Edition. Change it when the physical card says Unlimited Edition.</span>
          </label>
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
              <option value="Limited Edition">Limited Edition</option>
            </select>
          </label>
        )}
      </div>
    </div>
  );
}
