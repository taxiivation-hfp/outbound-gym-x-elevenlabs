"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import AppShell, { type FirstRunStep } from "@/components/shell/AppShell";
import { CALL_TYPE_TINT } from "@/components/calls/format";
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
import DemoReset from "./DemoReset";
import DocumentReader, { type ReadResult } from "./DocumentReader";
import GymForm, { SaveControls, SaveNotices, type SaveState } from "./GymForm";
import PromptPreview, { PREVIEW_TITLE_ID } from "./PromptPreview";
import SetupSteps, { SamplesHint } from "./SetupSteps";
import { AdminDetail, Button, Card, CardHeader, Pill, buttonClass, focusRing } from "./ui";

/**
 * The configuration screen, start to saved.
 *
 *   ┌ Start from a document ┐  upload → read → extract → check → "Fill the form from it"
 *   │ The gym's details     │  typed by hand, or prefilled and shown with provenance
 *   │ Offer limits          │                                   ┌ What the agent will say ┐
 *   └ Member data           ┘                                   └ (compiled as you type)  ┘
 *                              Save (header) ─→ saved ─→ member data
 *
 * Both ways in land in the same form; a document only ever prefills it, and a
 * person presses Save. There is no way from a document to a saved config that
 * does not pass through someone reading the form.
 */

type DocState = { kind: "idle" } | { kind: "reading"; file: File };

const ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

const SAVE_OFF_TITLE = "Saving is switched off here";
const SAVE_OFF_BODY =
  "Gyms can't be saved until your admin switches saving on. You can still fill in the form and read exactly what Charlie would be told.";

/** Fields plus schedule that differ between two drafts: what "unsaved changes" counts. */
function changedCount(a: Draft, b: Draft): number {
  const fields = GYM_FIELD_KEYS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).length;
  return fields + (JSON.stringify(a.offer_schedule) !== JSON.stringify(b.offer_schedule) ? 1 : 0);
}

export default function OnboardingFlow({
  saveAvailable,
  saveAdminDetail,
  extractionAvailable,
  extractionAdminDetail,
  existingGyms,
  defaultGym,
  maxUploadMb,
  editing = null,
  firstRunStep = null,
  editingMembersDone = false,
}: {
  /**
   * Editing an existing gym: the form opens prefilled with its current values
   * and saves with PATCH. The same form, compiler and validator.
   */
  editing?: GymConfig | null;
  saveAvailable: boolean;
  saveAdminDetail: string | null;
  extractionAvailable: boolean;
  extractionAdminDetail: string | null;
  /** Saved gyms, with how many members each has (null when it couldn't be counted). */
  existingGyms: Array<{ gym_id: string; gym_name: string; members: number | null }>;
  /** Editing only: whether that gym already has member data, for the setup steps. */
  editingMembersDone?: boolean;
  /** The gym the call queue places calls as (`listGyms().default_gym_id`). */
  defaultGym: { gym_id: string; gym_name: string } | null;
  /** The document route's upload limit, from lib/extraction/documentText.ts. */
  maxUploadMb: number;
  /** Set on a first run (lib/firstRun.ts): the nav is hidden and the step named. */
  firstRunStep?: FirstRunStep | null;
}) {
  const [baseline] = useState<Draft>(() =>
    editing ? { ...draftFromValues(editing), offer_schedule: scheduleToDraft(editing.offer_schedule) } : emptyDraft()
  );
  const [draft, setDraft] = useState<Draft>(baseline);
  const [doc, setDoc] = useState<DocState>({ kind: "idle" });
  // With gyms already saved, the page opens on them; the new-gym form (and its
  // preview and Save button) appears only when someone asks for it.
  const [creating, setCreating] = useState(false);
  const [read, setRead] = useState<ReadResult | null>(null);
  const [saved, setSaved] = useState<{ gym: GymConfig; incentives: Record<CallType, string> } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Preview warnings wait until someone has left the field they're typing in,
  // so a half-typed "39." doesn't flash a notice mid-keystroke.
  const [settled, setSettled] = useState(false);
  // The form's own state (fields touched, suggestions used, save attempts, a
  // site typed but not added) belongs to one set of answers. A new document or
  // a cleared form is a new set, so the form remounts with fresh state.
  const [formGeneration, setFormGeneration] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const readingHeading = useRef<HTMLHeadingElement>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null);

  const onChange = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSettled(false);
    setSaveState((s) => (s.kind === "error" ? { kind: "idle" } : s));
  }, []);

  const deferredDraft = useDeferredValue(draft);
  const preview = useMemo(() => previewDraft(deferredDraft), [deferredDraft]);
  const validation = useMemo(() => validateDraft(draft), [draft]);
  const answered = GYM_FIELD_KEYS.filter((k) => !isDraftBlank(draft, k)).length;

  // A view change removes the control that had focus; put focus where the page
  // went, so keyboard and screen-reader users land where the page did.
  useEffect(() => {
    if (doc.kind === "reading") readingHeading.current?.focus();
  }, [doc]);
  useEffect(() => {
    if (saved) savedHeading.current?.focus();
  }, [saved]);

  const focusFirstField = () =>
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-field="gym_name"] input')?.focus());

  const startReading = (file: File) => {
    setConfirmingDiscard(false);
    setDoc({ kind: "reading", file });
  };

  const onRead = (result: ReadResult) => {
    setRead(result);
    setDraft(draftFromValues(result.review.values));
    setFormGeneration((g) => g + 1);
    setSaveState({ kind: "idle" });
    setSettled(true);
    setDoc({ kind: "idle" });
    requestAnimationFrame(() => formHeading.current?.focus());
  };

  const startAgain = () => {
    if (answered > 0 && !confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    setConfirmingDiscard(false);
    setRead(null);
    setDraft(emptyDraft());
    setFormGeneration((g) => g + 1);
    setSaveState({ kind: "idle" });
    focusFirstField();
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
      setSaved({ gym: body.gym, incentives: body.incentives });
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

  if (saved) {
    return (
      // Saving the first gym finishes step one; members are still to come.
      <AppShell current="setup" title={saved.gym.gym_name} eyebrow="Configuration" firstRunStep={firstRunStep ? "members" : undefined}>
        <div className="min-h-0 flex-1 overflow-auto">
          <Saved
            gym={saved.gym}
            incentives={saved.incentives}
            headingRef={savedHeading}
            edited={Boolean(editing)}
            defaultGym={defaultGym}
            membersDone={Boolean(editing) && editingMembersDone}
          />
        </div>
      </AppShell>
    );
  }

  if (!editing && !creating && existingGyms.length > 0) {
    return (
      <AppShell current="setup" title="Retention Router" eyebrow="Configuration" firstRunStep={firstRunStep ?? undefined}>
        <div className="min-h-0 flex-1 overflow-auto pr-0.5">
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
            <YourGyms gyms={existingGyms} defaultGymId={defaultGym?.gym_id ?? null} />
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3.5">
              <span className="text-[13px] text-ink-2">Adding another gym?</span>
              <Button className="ml-auto" onClick={() => setCreating(true)}>
                Set up a new gym
              </Button>
            </div>
            <DemoReset available={saveAvailable} adminDetail={saveAdminDetail} />
          </div>
        </div>
      </AppShell>
    );
  }

  const changes = editing ? changedCount(draft, baseline) : 0;
  const saveStatus: { text: string; tone: "ink" | "dim" | "flag" } =
    saveState.kind === "saving"
      ? { text: "Checking every answer", tone: "dim" }
      : saveState.kind === "error"
        ? { text: "Not saved", tone: "flag" }
        : !saveAvailable
          ? { text: "Saving is off here", tone: "dim" }
          : editing
            ? changes === 0
              ? { text: "No unsaved changes", tone: "dim" }
              : { text: `${changes} unsaved change${changes === 1 ? "" : "s"}`, tone: "ink" }
            : answered === 0
              ? { text: "Nothing entered yet", tone: "dim" }
              : { text: "Not saved yet", tone: "ink" };

  const docStatus = doc.kind === "reading" ? `reading ${doc.file.name}` : read ? `read ${read.fileName}` : "nothing read yet";

  return (
    <AppShell
      current="setup"
      title={editing ? editing.gym_name : "Retention Router"}
      eyebrow="Configuration"
      // A gym being set up has no navigation until Save gym, first run or not:
      // the new-gym form is met alone, and "← Your gyms" is its way back.
      firstRunStep={firstRunStep ?? (editing ? undefined : "gym")}
      headerActions={
        <SaveControls
          saveAvailable={saveAvailable}
          saveState={saveState}
          label={editing ? "Save changes" : "Save gym"}
          stateText={saveStatus.text}
          stateTone={saveStatus.tone}
        />
      }
    >
      <div className="min-h-0 flex-1 overflow-auto pr-0.5">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_430px]">
          <div className="flex min-w-0 flex-col gap-4">
            {editing ? (
              <SetupSteps current="gym" gymId={editing.gym_id} gymDone membersDone={editingMembersDone} />
            ) : existingGyms.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="quiet" onClick={() => setCreating(false)}>
                  <span aria-hidden="true">←</span> Your gyms
                </Button>
                <h2 className="m-0 font-display text-[19px] font-bold tracking-[-0.02em] text-ink">Set up a new gym</h2>
              </div>
            ) : (
              <SetupSteps current="gym" gymId={null} gymDone={false} membersDone={false} />
            )}

            <SaveNotices
              saveAvailable={saveAvailable}
              saveTitle={SAVE_OFF_TITLE}
              saveBody={SAVE_OFF_BODY}
              saveAdminDetail={saveAdminDetail}
              saveState={saveState}
            />

            {!editing && (
              <Card labelledBy="doc-title" prominent className="@container">
                <CardHeader id="doc-title" title="Start from a document" note="or fill in the form below" aside={docStatus} />
                <p className="mb-4 text-[13px] text-muted">Upload a price list or membership agreement. We fill in the form; you check it.</p>

                {doc.kind === "reading" ? (
                  <DocumentReader
                    key={`${doc.file.name}-${doc.file.lastModified}-${doc.file.size}`}
                    file={doc.file}
                    headingRef={readingHeading}
                    replacing={answered}
                    onDone={onRead}
                    onManual={() => {
                      setDoc({ kind: "idle" });
                      focusFirstField();
                    }}
                    onChooseAnother={() => {
                      setDoc({ kind: "idle" });
                      requestAnimationFrame(() => fileInput.current?.click());
                    }}
                  />
                ) : extractionAvailable ? (
                  <>
                    {read && (
                      <p className="mb-3 text-[12.5px] text-ink-2">
                        <strong className="text-ink">Filled from {read.fileName}:</strong> {read.review.summary.filled} from the
                        document, {read.review.summary.blank} not in it
                        {read.review.summary.unsupported + read.review.summary.rejected > 0
                          ? `, ${read.review.summary.unsupported + read.review.summary.rejected} flagged for you below`
                          : ""}
                        .
                      </p>
                    )}
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
                      className={`flex flex-col items-center justify-center gap-3.5 rounded-[14px] border-[1.5px] border-dashed px-[22px] py-[30px] text-center transition-colors duration-150 motion-reduce:transition-none ${
                        dragging ? "border-accent-line bg-accent-wash" : "border-line-strong bg-canvas"
                      }`}
                    >
                      <div className="flex flex-col items-center gap-[7px]">
                        <span aria-hidden="true" className={`text-[22px] leading-none ${dragging ? "text-accent-ink" : "text-dim"}`}>
                          ⇪
                        </span>
                        <span className="text-[14px] font-bold text-ink">
                          {read ? "Drop another file here" : "Drop a PDF, Word or text file here"}
                        </span>
                        <span className="text-[12.5px] text-dim">PDF, Word or text, up to {maxUploadMb} MB.</span>
                      </div>
                      <Button variant="primary" onClick={() => fileInput.current?.click()}>
                        Choose a file
                      </Button>
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
                      <SamplesHint />
                    </div>
                  </>
                ) : (
                  <div className="rounded-[14px] border-[1.5px] border-dashed border-line-strong bg-canvas px-[22px] py-5 text-[12.5px] leading-relaxed text-ink-2">
                    <p>
                      <strong className="text-ink">Reading documents is off here.</strong> Fill in the form below.
                    </p>
                    {extractionAdminDetail && <AdminDetail>{extractionAdminDetail}</AdminDetail>}
                  </div>
                )}

                {doc.kind === "idle" && answered > 0 && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                    {confirmingDiscard ? (
                      <div role="group" aria-label="Clear the form?" className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-ink-2">
                        <span>
                          This clears {answered} answer{answered === 1 ? "" : "s"}
                          {read ? ` and the document's provenance` : ""}.
                        </span>
                        <Button onClick={startAgain}>Clear the form</Button>
                        <Button variant="quiet" onClick={() => setConfirmingDiscard(false)}>
                          Keep editing
                        </Button>
                      </div>
                    ) : (
                      <Button variant="quiet" className="ml-auto" onClick={startAgain} aria-expanded={confirmingDiscard}>
                        Clear and start over
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            )}

            <h2 ref={formHeading} tabIndex={-1} className="sr-only">
              {read ? `Check the answers from ${read.fileName}` : "Fill in the gym's answers"}
            </h2>
            <div onBlurCapture={() => setSettled(true)} className="min-w-0">
              <GymForm
                key={formGeneration}
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

            {!editing && existingGyms.length === 0 && <DemoReset available={saveAvailable} adminDetail={saveAdminDetail} />}
            <div aria-hidden="true" className="h-1.5" />
          </div>

          <section
            aria-labelledby={PREVIEW_TITLE_ID}
            tabIndex={0}
            className={`min-w-0 rounded-2xl lg:sticky lg:top-0 lg:max-h-[calc(100dvh-98px)] lg:overflow-y-auto lg:overscroll-contain ${focusRing}`}
          >
            <PromptPreview
              preview={preview}
              draft={deferredDraft}
              showWarnings={settled}
              discount={numericDiscount}
              tierName={deferredDraft.cheaper_tier_name.trim() || null}
              tierPrice={numericPrice}
            />
          </section>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Every saved gym, first on the page, with the two places a gym is continued
 * from as buttons. A gym with no members yet has importing them as its primary
 * action: that is the step it is waiting on.
 */
function YourGyms({
  gyms,
  defaultGymId,
}: {
  gyms: Array<{ gym_id: string; gym_name: string; members: number | null }>;
  defaultGymId: string | null;
}) {
  return (
    <Card labelledBy="gyms-title" prominent>
      <CardHeader id="gyms-title" title="Your gyms" note="pick up where you left off" />
      <ul className="m-0 mt-3 flex list-none flex-col overflow-hidden rounded-xl border border-line p-0">
        {gyms.map((g) => {
          const needsMembers = g.members === 0;
          return (
            <li key={g.gym_id} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-row-line bg-canvas px-3.5 py-3 last:border-b-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold text-ink wrap-anywhere">{g.gym_name}</span>
                  {g.gym_id === defaultGymId && <Pill tone="accent">calls go out as this gym</Pill>}
                </span>
                <span className="text-[12px] text-dim">
                  {g.members === null
                    ? "Member data not readable"
                    : g.members === 0
                      ? "No members yet"
                      : `${g.members.toLocaleString("en-AU")} members`}
                </span>
              </div>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <Link href={`/onboarding/${g.gym_id}/edit`} className={buttonClass("secondary")}>
                  Settings<span className="sr-only"> for {g.gym_name}</span>
                </Link>
                <Link href={`/onboarding/${g.gym_id}/members`} className={buttonClass(needsMembers ? "primary" : "secondary")}>
                  {needsMembers ? "Import members" : "Member data"}
                  <span className="sr-only"> for {g.gym_name}</span>
                  {needsMembers && <span aria-hidden="true">→</span>}
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Saved({
  gym,
  incentives,
  headingRef,
  edited,
  defaultGym,
  membersDone,
}: {
  edited: boolean;
  gym: GymConfig;
  incentives: Record<CallType, string>;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  defaultGym: { gym_id: string; gym_name: string } | null;
  membersDone: boolean;
}) {
  const callTypes = Object.keys(incentives) as CallType[];
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4">
      <SetupSteps current="gym" gymId={gym.gym_id} gymDone membersDone={membersDone} status={edited ? "Changes saved." : "Gym saved."} />
      <Card labelledBy="saved-title" prominent>
        <h2 ref={headingRef} id="saved-title" tabIndex={-1} className="m-0 outline-none">
          <Pill tone="accent">{edited ? "Changes saved" : "Saved"}</Pill>
          <span className="mt-2 block font-display text-[26px] font-bold leading-tight tracking-[-0.03em] text-ink wrap-anywhere">
            {gym.gym_name}
          </span>
        </h2>
        {defaultGym && defaultGym.gym_id !== gym.gym_id && (
          <p className="mt-2 text-[13px] text-muted">Calls still go out as {defaultGym.gym_name}.</p>
        )}
        <details className="group mt-4">
          <summary className={`w-fit cursor-pointer rounded-sm text-[13px] font-semibold text-accent-ink underline decoration-accent-line underline-offset-2 hover:text-ink ${focusRing}`}>
            What Charlie will offer
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {callTypes.map((callType) => {
              const tint = CALL_TYPE_TINT[callType];
              return (
                <div key={callType} className="flex flex-col gap-2 rounded-xl border border-line bg-canvas p-3.5">
                  <h3 className={`m-0 w-fit rounded-md px-[9px] py-[3px] text-[10.5px] font-bold uppercase tracking-[0.11em] ${tint.bg} ${tint.ink}`}>
                    {callTypeLabel[callType]} call
                  </h3>
                  <p className="m-0 rounded-[9px] border border-line bg-surface px-3 py-2.5 text-[13px] leading-[1.6] text-ink-2 text-pretty wrap-anywhere">
                    {incentives[callType]}
                  </p>
                </div>
              );
            })}
          </div>
        </details>
      </Card>
    </div>
  );
}
