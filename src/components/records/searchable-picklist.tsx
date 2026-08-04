"use client";

import { Check, ChevronDown, Info, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type SearchablePicklistOption = {
  detail: string;
  displayText: string;
  id: string;
  label: string;
  searchText: string;
};

export function SearchablePicklist({
  emptyMessage,
  label,
  labelHint,
  maxResults = 10,
  onSelect,
  options,
  placeholder,
  resultsLabel,
  selectedId,
  visibleRows = 5,
}: {
  emptyMessage: string;
  label: string;
  labelHint?: string;
  maxResults?: number;
  onSelect: (id: string) => void;
  options: SearchablePicklistOption[];
  placeholder: string;
  resultsLabel: string;
  selectedId: string;
  visibleRows?: number;
}) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const hintId = `${inputId}-hint`;
  const selectedOption = options.find((option) => option.id === selectedId) ?? null;
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(selectedOption?.displayText ?? "");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const normalizedQuery = query.trim().toLocaleLowerCase("en-GB");
  const selectedText = selectedOption?.displayText.toLocaleLowerCase("en-GB") ?? "";

  const filteredOptions = useMemo(() => {
    if (!normalizedQuery || normalizedQuery === selectedText) return options;
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    return options.filter((option) => terms.every((term) => option.searchText.includes(term)));
  }, [normalizedQuery, options, selectedText]);

  const orderedOptions = useMemo(() => {
    if (normalizedQuery !== selectedText || !selectedOption) return filteredOptions;
    return [selectedOption, ...filteredOptions.filter((option) => option.id !== selectedOption.id)];
  }, [filteredOptions, normalizedQuery, selectedOption, selectedText]);
  const visibleOptions = orderedOptions.slice(0, maxResults);
  const activeOption = visibleOptions[Math.min(activeIndex, Math.max(visibleOptions.length - 1, 0))] ?? null;

  useEffect(() => {
    if (isOpen && activeOption) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, activeOption, isOpen]);

  function closeAndRestore() {
    setQuery(selectedOption?.displayText ?? "");
    setIsOpen(false);
    setActiveIndex(0);
  }

  function selectOption(option: SearchablePicklistOption) {
    setQuery(option.displayText);
    setIsOpen(false);
    setActiveIndex(0);
    onSelect(option.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(0);
      } else {
        setActiveIndex((current) => Math.min(current + 1, Math.max(visibleOptions.length - 1, 0)));
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter" && isOpen && activeOption) {
      event.preventDefault();
      selectOption(activeOption);
      return;
    }
    if (event.key === "Escape") closeAndRestore();
  }

  return (
    <div
      className="relative focus-within:z-30"
      onBlur={(event) => {
        if (containerRef.current?.contains(event.relatedTarget)) return;
        closeAndRestore();
      }}
      ref={containerRef}
    >
      <div className="flex min-h-8 items-center gap-1">
        <label className="text-sm font-bold text-zinc-800" htmlFor={inputId}>{label}</label>
        {labelHint ? <span className="group/hint relative inline-flex hover:z-50 focus-within:z-50">
          <button aria-describedby={hintId} aria-label={`Why ${label} is selected together`} className="relative grid size-8 place-items-center rounded-md text-zinc-500 transition after:absolute after:-inset-1.5 after:rounded-lg after:content-[''] hover:bg-zinc-100 hover:text-zinc-800 focus-visible:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-[#8a1f2d]" type="button"><Info aria-hidden="true" className="size-3.5" /></button>
          <span className="pointer-events-none absolute left-0 top-full mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] translate-y-1 rounded-lg border border-zinc-200 bg-zinc-950 px-3 py-2 text-left text-xs font-semibold leading-5 text-white opacity-0 shadow-xl transition duration-150 group-hover/hint:pointer-events-auto group-hover/hint:translate-y-0 group-hover/hint:opacity-100 group-focus-within/hint:pointer-events-auto group-focus-within/hint:translate-y-0 group-focus-within/hint:opacity-100" id={hintId} role="tooltip">{labelHint}</span>
        </span> : null}
      </div>
      <div className="relative mt-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <input
          aria-activedescendant={isOpen && activeOption ? `${listId}-${activeOption.id}` : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={isOpen}
          autoComplete="off"
          className="min-h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 py-2 pl-9 pr-10 text-base font-semibold text-zinc-900 outline-none transition placeholder:font-medium placeholder:text-zinc-400 hover:border-zinc-400 focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm"
          id={inputId}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onClick={(event) => {
            event.currentTarget.select();
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={(event) => {
            event.currentTarget.select();
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          value={query}
        />
        <ChevronDown aria-hidden="true" className={`pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
      </div>
      {isOpen ? (
        <div aria-label={resultsLabel} className="absolute z-40 mt-2 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg" id={listId} role="listbox">
          <div className="overflow-y-auto p-1.5" style={{ maxHeight: `calc(${visibleRows} * 3.375rem + .75rem)` }}>
            {visibleOptions.length ? visibleOptions.map((option, index) => {
              const isSelected = option.id === selectedId;
              const isActive = option.id === activeOption?.id;
              return (
                <button
                  aria-selected={isSelected}
                  className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${isActive ? "bg-zinc-100" : "hover:bg-zinc-50"} ${isSelected ? "text-[#8a1f2d]" : "text-zinc-900"}`}
                  id={`${listId}-${option.id}`}
                  key={option.id}
                  onClick={() => selectOption(option)}
                  onFocus={() => setActiveIndex(index)}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  role="option"
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{option.label}</span>
                    <span className="mt-0.5 block truncate text-xs font-medium text-zinc-500">{option.detail}</span>
                  </span>
                  {isSelected ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
                </button>
              );
            }) : <p className="px-3 py-4 text-sm font-medium text-zinc-500">{emptyMessage}</p>}
          </div>
          {filteredOptions.length > maxResults ? <p className="border-t border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-600">Showing {maxResults} of {filteredOptions.length} matches. Keep typing to narrow the list.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
