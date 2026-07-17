"use client";

import { ChevronDown } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { rarityNames } from "@/lib/rarity-abbreviations";

export function RarityCombobox({
  label = "Rarity",
  labelSuffix,
  onChange,
  required = false,
  value,
}: {
  label?: string;
  labelSuffix?: ReactNode;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const visibleRarities = useMemo(() => {
    const search = value.toLowerCase().trim();
    return search
      ? rarityNames.filter((rarity) => rarity.toLowerCase().includes(search))
      : rarityNames;
  }, [value]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <label className="block">
        <span className="text-sm font-medium text-zinc-700">
          {label}
          {required ? <span className="text-rose-700"> *</span> : null}
          {labelSuffix}
        </span>
        <div className="relative mt-1">
          <input
            aria-controls={listId}
            aria-expanded={open}
            aria-label={label}
            autoComplete="off"
            className="h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 pr-11 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm"
            onChange={(event) => {
              onChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search rarity"
            required={required}
            role="combobox"
            value={value}
          />
          <button
            aria-label="Show rarities"
            className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      </label>

      {open ? (
        <div
          className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-zinc-300 bg-white p-1 shadow-lg"
          id={listId}
        >
          {visibleRarities.length ? visibleRarities.map((rarity) => (
            <button
              className="block min-h-11 w-full rounded px-3 py-2 text-left text-sm text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950"
              key={rarity}
              onClick={() => {
                onChange(rarity);
                setOpen(false);
              }}
              type="button"
            >
              {rarity}
            </button>
          )) : (
            <p className="px-3 py-2 text-sm text-zinc-500">No rarity found</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
