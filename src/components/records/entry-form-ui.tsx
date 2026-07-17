"use client";

import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export const fieldClass = "mt-1 h-11 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm";
export const textAreaClass = "mt-1 min-h-24 w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-base outline-none transition focus:border-[#8a1f2d] focus:bg-white focus:ring-2 focus:ring-[#8a1f2d]/10 sm:text-sm";

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function poundsToPence(value: string) {
  const parsed = Number(value.replace(/[£,]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

export function penceToPounds(value: number) {
  return (value / 100).toFixed(2);
}

export function rowId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function FormSection({
  children,
  description,
  number,
  title,
}: {
  children: ReactNode;
  description: string;
  number: number;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-950 text-sm font-black text-white">{number}</span>
        <div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-sm font-medium leading-5 text-zinc-500">{description}</p></div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function PreviewNotice({ children }: { children: ReactNode }) {
  return (
    <aside className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium leading-5 text-amber-900">
      <AlertCircle className="mt-0.5 size-5 shrink-0" />
      <div><strong className="font-black">Preview only.</strong> {children}</div>
    </aside>
  );
}

export function WizardProgress({ labels, step }: { labels: string[]; step: number }) {
  return (
    <nav aria-label="Form progress" className="rounded-lg border border-zinc-300 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between text-xs font-bold text-zinc-500"><span>Step {step} of {labels.length}</span><span>{labels[step - 1]}</span></div>
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
        {labels.map((label, index) => {
          const number = index + 1;
          return <li aria-current={number === step ? "step" : undefined} className="min-w-0" key={label}><span className={`block h-1.5 rounded-full transition-colors ${number <= step ? "bg-[#8a1f2d]" : "bg-zinc-200"}`} /><span className={`mt-2 hidden truncate text-[11px] font-bold sm:block ${number === step ? "text-zinc-950" : "text-zinc-500"}`}>{label}</span></li>;
        })}
      </ol>
    </nav>
  );
}

export function StepPanel({ children, step }: { children: ReactNode; step: number }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [step]);

  return <div className="records-step-enter outline-none" key={step} ref={panelRef} tabIndex={-1}>{children}</div>;
}

export function WizardActions({
  finalLabel,
  nextDisabled = false,
  onBack,
  onNext,
  pending = false,
  step,
  totalSteps,
}: {
  finalLabel: string;
  nextDisabled?: boolean;
  onBack: () => void;
  onNext: () => void;
  pending?: boolean;
  step: number;
  totalSteps: number;
}) {
  return (
    <div className="z-20 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-2 rounded-lg border border-zinc-300 bg-white/95 p-3 shadow-lg backdrop-blur sm:sticky sm:bottom-3 sm:flex sm:items-center sm:justify-between">
      <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 text-sm font-bold text-zinc-700 hover:border-zinc-950 disabled:opacity-40 sm:w-auto sm:px-4" disabled={step === 1 || pending} onClick={onBack} type="button"><ArrowLeft className="size-4" /> Back</button>
      {step < totalSteps ? (
        <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-bold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:px-5" disabled={nextDisabled || pending} onClick={onNext} type="button">Continue <ArrowRight className="size-4" /></button>
      ) : (
        <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#8a1f2d] px-3 text-sm font-bold text-white transition hover:bg-[#711826] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-5" disabled={pending} type="submit">{pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Check className="size-4" />} {pending ? "Saving preview…" : finalLabel}</button>
      )}
    </div>
  );
}
