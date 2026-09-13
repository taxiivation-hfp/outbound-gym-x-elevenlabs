"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { GymConfig } from "@/lib/gymConfig";
import { GYM_FIELD_KEYS, hasAtMostTwoDecimals } from "@/lib/gymConfig";
import { callTypeLabel } from "@/lib/labels";
import type { CallType } from "@/lib/callType";
import {
  draftFromValues,
  draftToInput,
  emptyDraft,
  isDraftBlank,
  scheduleToDraft,
  previewDraft,
  validateDraft,
  type Draft,
} from "@/lib/onboardingDraft";
import DocumentReader, { type ReadResult } from "./DocumentReader";
import GymForm, { SaveBar, type SaveState } from "./GymForm";
import PromptPreview, { PREVIEW_TITLE_ID } from "./PromptPreview";
import { AdminDetail, Button, Literal, Notice, SectionTitle, buttonClass, focusRing } from "./ui";

/**
 * Onboarding, start to saved.
 *
 *   start ─┬─ "Fill it in by hand" ───────────────┐
 *          └─ upload ─→ read ─→ extract ─→ check ─┤
 *                                                  ↓
 *                                   review (one screen, one Save)
 *                                                  ↓
 *                                   saved ─→ connect member data
 *
 * Both paths land on the same review screen; manual arrives empty, upload
 * arrives prefilled. There is no way from a document to a saved config that
 * does not pass through a person reading the form.
 */

type Step =
  | { kind: "start" }
  | { kind: "reading"; file: File }
  | { kind: "review" }
  | { kind: "saved"; gym: GymConfig; incentives: Record<CallType, string> };

const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

const SAVE_OFF_TITLE = "Saving is switched off here";
const SAVE_OFF_BODY =
  "New gyms can't be saved until your admin switches saving on. You can still fill in the form and see exactly what Charlie would be told.";

export default function OnboardingFlow({
  saveAvailable,
  saveAdminDetail,
  extractionAvailable,
  extractionAdminDetail,
  existingGyms,
  editing = null,
}: {
  /**
   * Editing an existing gym: the form opens prefilled with its current values
   * and saves with PATCH. The same review screen, compiler and validator.
   */
  editing?: GymConfig | null;
  saveAvailable: boolean;
  saveAdminDetail: string | null;
  extractionAvailable: boolean;
  extractionAdminDetail: string | null;
  existingGyms: Array<{ gym_id: string; gym_name: string }>;
}) {
  const [step, setStep] = useState<Step>(editing ? { kind: "review" } : { kind: "start" });
  const [draft, setDraft] = useState<Draft>(() =>
    editing ? { ...draftFromValues(editing), offer_schedule: scheduleToDraft(editing.offer_schedule) } : emptyDraft()
  );
  const [read, setRead] = useState<ReadResult | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Preview warnings wait until someone has left the field they're typing in,
  // so a half-typed "39." doesn't flash an amber notice mid-keystroke.
  const [settled, setSettled] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const viewHeading = useRef<HTMLHeadingElement>(null);

  const onChange = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSettled(false);
    setSaveState((s) => (s.kind === "error" ? { kind: "idle" } : s));
  }, []);

  const deferredDraft = useDeferredValue(draft);
  const preview = useMemo(() => previewDraft(deferredDraft), [deferredDraft]);
  const validation = useMemo(() => validateDraft(draft), [draft]);
  const answered = GYM_FIELD_KEYS.filter((k) => !isDraftBlank(draft, k)).length;

  // A screen change removes the control that had focus; put focus on the new
  // view's heading so keyboard and screen-reader users land where the page did.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    viewHeading.current?.focus();
  }, [step.kind]);

  const startManual = () => {
    setRead(null);
    setDraft(emptyDraft());
    setSaveState({ kind: "idle" });
    setConfirmingDiscard(false);
    setStep({ kind: "review" });
  };

  const startReading = (file: File) => {
    setRead(null);
    setStep({ kind: "reading", file });
  };

  const onRead = (result: ReadResult) => {
    setRead(result);
    setDraft(draftFromValues(result.review.values));
    setSaveState({ kind: "idle" });
    setSettled(true);
    setStep({ kind: "review" });
  };

  const startAgain = () => {
    if (answered > 0 && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    setConfirmingDiscard(false);
    setStep({ kind: "start" });
  };

  const save = async () => {
    setSaveState({ kind: "saving" });
    try {
      const schedule = validation.ok ? validation.schedule : null;
      const res = editing
        ? await fetch(`/api/gyms/${encodeURIComponent(editing.gym_id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: draftToInput(draft), offer_schedule: schedule }),
          })
        : await fetch("/api/gyms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: draftToInput(draft), offer_schedule: schedule, created_via: read ? "document" : "manual" }),
          });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setSaveState({
          kind: "error",
          message: typeof body?.error === "string" ? body.error : `The gym wasn't saved (HTTP ${res.status}).`,
          errors: body?.errors,
        });
        return;
      }
      setStep({ kind: "saved", gym: body.gym, incentives: body.incentives });
    } catch {
      setSaveState({ kind: "error", message: "Couldn't reach the server, so the gym wasn't saved. Check the connection and try again." });
    }
  };

  const numericDiscount = /^\d+$/.test(deferredDraft.renewal_discount_percent.trim()) ? Number(deferredDraft.renewal_discount_percent) : null;
  const numericPrice = (() => {
    const t = deferredDraft.cheaper_tier_price.trim().replace(/^\$\s*/, "");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    const n = Number(t);
    return hasAtMostTwoDecimals(n) ? n : null;
  })();

  if (step.kind === "saved") {
    return <Saved gym={step.gym} incentives={step.incentives} headingRef={viewHeading} edited={Boolean(editing)} />;
  }

  if (step.kind === "reading") {
    return (
      <DocumentReader
        file={step.file}
        headingRef={viewHeading}
        onDone={onRead}
        onManual={startManual}
        onChooseAnother={() => {
          setStep({ kind: "start" });
          requestAnimationFrame(() => fileInput.current?.click());
        }}
      />
    );
  }

  if (step.kind === "review") {
    return (
      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <h2 ref={viewHeading} tabIndex={-1} className="sr-only">
            {read ? `Check the answers from ${read.fileName}` : "Fill in the gym's answers"}
          </h2>
          <div className="mb-8 space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {editing ? (
                <p className="text-sm text-zinc-400">
                  Editing <Literal>{editing.gym_id}</Literal>. Saving checks every answer again and replaces this gym&apos;s config;
                  its id stays the same. <Link href="/onboarding" className="underline">Leave without saving</Link>
                </p>
              ) : (
                <>
                  <Button variant="quiet" onClick={startAgain} aria-expanded={confirmingDiscard}>
                    <span aria-hidden="true">←</span> Start again
                  </Button>
                  {!read && <p className="text-sm text-zinc-400">Filling in by hand. Only the name is required.</p>}
                </>
              )}
            </div>
            {confirmingDiscard && (
              <div role="group" aria-label="Discard answers?" className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
                <span>
                  This clears {answered} answer{answered === 1 ? "" : "s"}.
                </span>
                <Button onClick={startAgain}>Discard answers</Button>
                <Button variant="quiet" onClick={() => setConfirmingDiscard(false)}>
                  Keep editing
                </Button>
              </div>
            )}
            {!saveAvailable && <p className="text-sm text-amber-300">{SAVE_OFF_TITLE}. You can still fill this in and read the preview.</p>}
          </div>
          <div onBlurCapture={() => setSettled(true)}>
            <GymForm
              draft={draft}
              onChange={onChange}
              validationErrors={validation.ok ? {} : validation.errors}
              review={read?.review ?? null}
              fileName={read?.fileName ?? null}
              saveAvailable={saveAvailable}
              saveState={saveState}
              onSave={save}
              configuredOffers={preview.configured}
              validationFields={preview.fields}
            />
          </div>
        </div>
        <section
          aria-labelledby={PREVIEW_TITLE_ID}
          tabIndex={0}
          className={`min-w-0 max-w-[44rem] rounded-2xl lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain ${focusRing}`}
        >
          <PromptPreview
            preview={preview}
            showWarnings={settled}
            discount={numericDiscount}
            tierName={deferredDraft.cheaper_tier_name.trim() || null}
            tierPrice={numericPrice}
          />
        </section>
        <div className="lg:col-start-1 lg:row-start-2">
          <SaveBar saveAvailable={saveAvailable} saveTitle={SAVE_OFF_TITLE} saveBody={SAVE_OFF_BODY} saveAdminDetail={saveAdminDetail} saveState={saveState} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h2 ref={viewHeading} tabIndex={-1} className="sr-only">
        Choose how to start
      </h2>

      {!saveAvailable && (
        <div className="max-w-3xl">
          <Notice tone="caution" title={SAVE_OFF_TITLE}>
            <p>{SAVE_OFF_BODY}</p>
            {saveAdminDetail && <AdminDetail>{saveAdminDetail}</AdminDetail>}
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-800 lg:grid-cols-2">
        <section aria-labelledby="from-document" className="bg-black p-6">
          <SectionTitle id="from-document">Start from a document</SectionTitle>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-zinc-400">
            Upload the price list, membership agreement or sales handbook you already have. The answers are read out
            of it, each with the sentence it came from, and put in front of you to check. A membership agreement is
            usually the most reliable: prices and terms have to be in it.
          </p>

          {extractionAvailable ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file) startReading(file);
              }}
              className={`mt-5 rounded-xl border border-dashed px-5 py-6 transition-colors duration-150 ease-out motion-reduce:transition-none ${
                dragging ? "border-signal bg-signal/5" : "border-zinc-600"
              }`}
            >
              <div className="flex flex-wrap items-center gap-4">
                <Button variant="primary" onClick={() => fileInput.current?.click()}>
                  Choose a file
                </Button>
                <p className="text-sm text-zinc-400">or drop it here. PDF, Word (.docx) or text, up to 10 MB.</p>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) startReading(file);
                }}
              />
              <p className="mt-3 text-xs leading-relaxed text-zinc-400">
                The file isn&apos;t kept. Nothing is saved until you check the answers and press Save gym.
              </p>
            </div>
          ) : (
            <div className="mt-5 text-sm leading-relaxed text-zinc-300">
              <p>
                <span className="font-semibold text-white">Reading documents isn&apos;t switched on here.</span> Fill the
                form in by hand instead — it&apos;s the same form, starting empty.
              </p>
              {extractionAdminDetail && <AdminDetail>{extractionAdminDetail}</AdminDetail>}
            </div>
          )}
        </section>

        <section aria-labelledby="by-hand" className="bg-black p-6">
          <SectionTitle id="by-hand">Fill it in by hand</SectionTitle>
          <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-zinc-400">
            Eleven questions. Only the gym&apos;s name is required — every other answer can be left as not stated, and
            the form says what Charlie does when it is.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button variant={extractionAvailable ? "secondary" : "primary"} onClick={startManual}>
              Start with an empty form
            </Button>
            {answered > 0 && (
              <Button variant="quiet" onClick={() => setStep({ kind: "review" })}>
                Back to your {answered} answer{answered === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </section>
      </div>

      {existingGyms.length > 0 && (
        <section aria-labelledby="existing">
          <h2 id="existing" className="text-sm font-semibold text-white">
            Gyms already set up
          </h2>
          <ul className="mt-2 divide-y divide-zinc-900 rounded-xl border border-zinc-800">
            {existingGyms.map((g) => (
              <li key={g.gym_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm text-zinc-200">
                  {g.gym_name} <Literal className="ml-1 text-xs text-zinc-400">{g.gym_id}</Literal>
                </span>
                <Link href={`/onboarding/${g.gym_id}/edit`} className={`rounded-sm text-sm text-zinc-400 underline ${focusRing}`}>
                  Edit<span className="sr-only"> {g.gym_name}</span>
                </Link>
                <Link
                  href={`/onboarding/${g.gym_id}/members`}
                  className={`rounded-sm text-sm font-semibold text-zinc-200 underline decoration-zinc-600 underline-offset-4 transition-[color,text-decoration-color] hover:text-white hover:decoration-zinc-300 ${focusRing}`}
                >
                  Connect member data<span className="sr-only"> for {g.gym_name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Saved({
  gym,
  incentives,
  headingRef,
  edited,
}: {
  edited: boolean;
  gym: GymConfig;
  incentives: Record<CallType, string>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const callTypes = Object.keys(incentives) as CallType[];
  return (
    <section aria-labelledby="saved-title" className="max-w-4xl">
      <h2 ref={headingRef} id="saved-title" tabIndex={-1} className="outline-none">
        <span className="block text-sm font-semibold text-signal">{edited ? "Changes saved" : "Saved"}</span>
        <span className="mt-1 block text-2xl font-black uppercase tracking-tight text-white wrap-anywhere">{gym.gym_name}</span>
      </h2>
      <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-zinc-400">
        Stored as <Literal>{gym.gym_id}</Literal>. It&apos;s in the gym switcher on the queue now, and every call placed for
        it from now on is told exactly this:
      </p>
      <div className="mt-5 space-y-3">
        {callTypes.map((callType) => (
          <div key={callType}>
            <p className="text-xs font-semibold text-zinc-300">{callTypeLabel[callType]} call</p>
            <p className="mt-1 rounded-xl border border-zinc-900 bg-black px-3.5 py-3 font-mono text-[0.8125rem] leading-[1.65] text-zinc-300 wrap-anywhere">
              {incentives[callType]}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link href={`/onboarding/${gym.gym_id}/members`} className={buttonClass("primary")}>
          Connect member data
        </Link>
        <Link href="/" className={buttonClass("secondary")}>
          Back to the queue
        </Link>
      </div>
    </section>
  );
}
