"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createFormDraftEnvelope,
  canPersistFormDraft,
  findLatestIdentityDraftConflict,
  formDraftIntentConflict,
  formDraftStorageKey,
  parseFormDraftEnvelope,
  type FormDraftEnvelope,
  type FormDraftIntent,
  type FormDraftWorkflow,
} from "./form-draft-lifecycle";

type LifecycleOptions<T> = {
  workflow: FormDraftWorkflow;
  ownerScope: string;
  origin: string;
  intent?: FormDraftIntent;
  identity?: string;
  initialData: T;
  isValidData: (value: unknown) => value is T;
};

export type FormDraftLifecycle<T> = {
  data: T;
  setData: Dispatch<SetStateAction<T>>;
  hydrated: boolean;
  dirty: boolean;
  restored: boolean;
  conflict: FormDraftEnvelope<T> | null;
  conflictIsDifferentIdentity: boolean;
  recoveryMessage: string | null;
  discard: () => void;
  reset: () => void;
  resumePrevious: () => void;
  startNew: () => void;
};

export function useFormDraftLifecycle<T>({
  workflow,
  ownerScope,
  origin,
  intent = { kind: "none", id: null },
  identity,
  initialData,
  isValidData,
}: LifecycleOptions<T>): FormDraftLifecycle<T> {
  const storageKey = useMemo(
    () => formDraftStorageKey(workflow, ownerScope, identity),
    [identity, ownerScope, workflow],
  );
  const incomingIntent = useMemo<FormDraftIntent>(
    () => ({ kind: intent.kind, id: intent.id, label: intent.label }),
    [intent.id, intent.kind, intent.label],
  );
  const initialSerialized = useMemo(() => JSON.stringify(initialData), [initialData]);
  const initialRef = useRef(initialData);
  const [data, setData] = useState(initialData);
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [conflict, setConflict] = useState<FormDraftEnvelope<T> | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [activeIntent, setActiveIntent] = useState<FormDraftIntent>(incomingIntent);
  const envelopeRef = useRef<FormDraftEnvelope<T> | null>(null);
  // A changed key makes this false during render, immediately closing the
  // boundary before a child can see another owner's/workflow's/Copy's data.
  // The effect below subsequently resets and hydrates the new key.
  const hydrated = hydratedScope === storageKey;

  useEffect(() => {
    initialRef.current = initialData;
  }, [initialData]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setHydratedScope(null);
      setRestored(false);
      setConflict(null);
      setRecoveryMessage(null);
      setActiveIntent(incomingIntent);
      envelopeRef.current = null;
      setData(initialRef.current);
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed = parseFormDraftEnvelope<T>(JSON.parse(raw), { ownerScope, workflow });
          if (!parsed || !isValidData(parsed.data)) {
            window.sessionStorage.removeItem(storageKey);
            setRecoveryMessage("An older or damaged draft could not be restored. A fresh draft is ready.");
          } else if (formDraftIntentConflict(parsed.intent, incomingIntent)) {
            envelopeRef.current = parsed;
            setConflict(parsed);
          } else {
            envelopeRef.current = parsed;
            setData(parsed.data);
            setRestored(true);
          }
        } else if (identity && incomingIntent.kind === "copy" && incomingIntent.id) {
          // Individual listing drafts are keyed by their exact Copy so their
          // contents cannot leak. When another Copy is opened in this tab,
          // surface the newest saved Copy draft as a decision instead of
          // silently hiding it or transplanting it into this Copy's key.
          const previous = findLatestIdentityDraftConflict({
            incomingIntent,
            isValidData,
            ownerScope,
            storage: window.sessionStorage,
            storageKey,
            workflow,
          });
          if (previous) {
            envelopeRef.current = previous;
            setConflict(previous);
          }
        }
      } catch {
        window.sessionStorage.removeItem(storageKey);
        setRecoveryMessage("The saved draft could not be read. A fresh draft is ready.");
      } finally {
        setHydratedScope(storageKey);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [identity, incomingIntent, initialSerialized, isValidData, ownerScope, storageKey, workflow]);

  useEffect(() => {
    const returnedToInitialData =
      hydratedScope === storageKey
      && !conflict
      && JSON.stringify(data) === JSON.stringify(initialRef.current);
    if (returnedToInitialData && envelopeRef.current) {
      try {
        window.sessionStorage.removeItem(storageKey);
        envelopeRef.current = null;
      } catch {
        queueMicrotask(() => {
          setRecoveryMessage("This draft returned to its starting state, but the older saved draft could not be cleared.");
        });
      }
      return;
    }
    if (!canPersistFormDraft({
      conflict,
      data,
      hydratedScope,
      initialData: initialRef.current,
      storageKey,
    })) return;
    // Do not create an empty generic draft just by visiting a form. A draft
    // exists only after the user changes it (or when an already saved one is
    // restored), preventing an untouched generic visit from shadowing a later
    // explicit route target.
    const envelope = createFormDraftEnvelope({
      data,
      existing: envelopeRef.current,
      intent: activeIntent,
      origin,
      ownerScope,
      workflow,
    });
    envelopeRef.current = envelope;
    window.sessionStorage.setItem(storageKey, JSON.stringify(envelope));
  }, [activeIntent, conflict, data, hydrated, hydratedScope, origin, ownerScope, storageKey, workflow]);

  const dirty = useMemo(
    () => JSON.stringify(data) !== initialSerialized,
    [data, initialSerialized],
  );
  // While a new scope is restoring, callers receive that scope's defaults
  // rather than the old state's object. The visible boundary is closed too,
  // but this prevents an eager effect in a caller from reading stale values.
  const scopedData = hydrated ? data : initialData;

  useEffect(() => {
    if (!hydrated || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, hydrated]);

  const clearStored = useCallback(() => {
    window.sessionStorage.removeItem(storageKey);
    envelopeRef.current = null;
    setRestored(false);
    setConflict(null);
  }, [storageKey]);

  const reset = useCallback(() => {
    clearStored();
    setActiveIntent(incomingIntent);
    setData(initialRef.current);
    setRecoveryMessage(null);
  }, [clearStored, incomingIntent]);

  return {
    data: scopedData,
    setData,
    hydrated,
    dirty,
    restored: restored && dirty,
    conflict,
    conflictIsDifferentIdentity: Boolean(
      identity
      && conflict?.intent.kind === "copy"
      && conflict.intent.id
      && conflict.intent.id !== identity,
    ),
    recoveryMessage,
    discard: reset,
    reset,
    resumePrevious: () => {
      if (!conflict) return;
      if (identity && conflict.intent.kind === "copy" && conflict.intent.id !== identity) return;
      envelopeRef.current = conflict;
      setActiveIntent(conflict.intent);
      setData(conflict.data);
      setConflict(null);
      setRestored(true);
    },
    startNew: reset,
  };
}
