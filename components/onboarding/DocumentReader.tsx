"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExtractionReview } from "@/lib/extraction/sanitize";
import StageProgress, { type StageKey, type StageState } from "./StageProgress";
import { Button, Notice } from "./ui";

/**
 * Upload → Read → Extract → Check, as four real requests.
 *
 * Upload and Read are one request (the file has to arrive before it can be
 * read), split by the browser's own events: the upload stage finishes when the
 * last byte is sent, the read stage when the server's answer comes back. Extract
 * is the model call. Check is the deterministic sanitiser. A failed stage stops
 * the row, says what failed, and offers the manual path — never a partial
 * prefill presented as if it worked.
 *
 * Rendered inside the "Start from a document" card, above the form it fills.
 * Finishing doesn't touch the form: a person presses "Fill the form from it",
 * and is told first if that replaces answers already typed.
 */

export interface ReadResult {
  fileName: string;
  review: ExtractionReview;
  model: string;
}

interface DocumentResponse {
  kind: string;
  file_name: string;
  bytes: number;
  pages: number | null;
  characters: number;
  text: string;
}

const INITIAL: StageState[] = [
  { key: "upload", label: "Upload", status: "waiting" },
  { key: "read", label: "Read", status: "waiting" },
  { key: "extract", label: "Extract", status: "waiting" },
  { key: "check", label: "Check", status: "waiting" },
];

class StageError extends Error {
  constructor(
    readonly stage: StageKey,
    message: string
  ) {
    super(message);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : `${fallback} (HTTP ${res.status}).`;
}

export default function DocumentReader({
  file,
  headingRef,
  onDone,
  onManual,
  onChooseAnother,
  replacing,
}: {
  file: File;
  /** Answers already in the form, which filling it from the document would replace. */
  replacing: number;
  headingRef?: React.RefObject<HTMLHeadingElement | null>;
  onDone: (result: ReadResult) => void;
  onManual: () => void;
  onChooseAnother: () => void;
}) {
  const [stages, setStages] = useState<StageState[]>(INITIAL);
  const [failure, setFailure] = useState<{ stage: StageKey; message: string } | null>(null);
  const [result, setResult] = useState<ReadResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const failureRef = useRef<HTMLDivElement>(null);

  // When the row finishes, move focus to what happens next — the button that
  // opens the review, or the failure and its way out — instead of leaving it on
  // a "Stop" button that has just disappeared.
  useEffect(() => {
    if (result) reviewButton.current?.focus();
  }, [result]);
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);

  const update = useCallback((key: StageKey, patch: Partial<StageState>) => {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    let timer: ReturnType<typeof setInterval> | null = null;

    const uploadAndRead = () =>
      new Promise<DocumentResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        const form = new FormData();
        form.append("file", file);
        xhr.open("POST", "/api/onboarding/document");
        xhr.responseType = "json";
        // Progress events can arrive every few milliseconds; the bar only needs
        // the latest one per frame.
        let pendingProgress: ProgressEvent | null = null;
        let frame = 0;
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return;
          pendingProgress = event;
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            const latest = pendingProgress;
            if (!latest) return;
            update("upload", {
              progress: latest.loaded / latest.total,
              fact: `${formatBytes(latest.loaded)} of ${formatBytes(latest.total)}`,
            });
          });
        };
        xhr.upload.onload = () => {
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          pendingProgress = null;
          update("upload", { status: "done", progress: 1, fact: `${formatBytes(file.size)} sent` });
          update("read", { status: "working" });
        };
        xhr.onerror = () => reject(new StageError("upload", "The upload didn't reach the server. Check the connection and try again."));
        xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
        xhr.onload = () => {
          // The server answered, so the request arrived — even if it was refused
          // before the last byte, which is what a too-large file looks like.
          update("upload", { status: "done", progress: 1, fact: `${formatBytes(file.size)} sent` });
          const body = xhr.response as (DocumentResponse & { error?: string }) | null;
          if (xhr.status >= 200 && xhr.status < 300 && body && typeof body.text === "string") {
            resolve(body);
          } else {
            reject(new StageError("read", body?.error ?? `The file couldn't be read (HTTP ${xhr.status}).`));
          }
        };
        update("upload", { status: "working", progress: 0, fact: `0 B of ${formatBytes(file.size)}` });
        xhr.send(form);
      });

    (async () => {
      try {
        const doc = await uploadAndRead();
        // A file small enough to upload in one event can skip the progress
        // callbacks; make sure the upload stage reads as done either way.
        update("upload", { status: "done", progress: 1, fact: `${formatBytes(file.size)} sent` });
        update("read", {
          status: "done",
          fact: `${doc.pages ? `${doc.pages} page${doc.pages === 1 ? "" : "s"} · ` : ""}${doc.characters.toLocaleString("en-AU")} characters`,
        });

        const started = performance.now();
        update("extract", { status: "working", elapsed: 0 });
        timer = setInterval(() => update("extract", { elapsed: Math.floor((performance.now() - started) / 1000) }), 1000);
        const extractRes = await fetch("/api/onboarding/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: doc.text, file_name: doc.file_name }),
          signal: controller.signal,
        });
        if (timer) clearInterval(timer);
        if (!extractRes.ok) throw new StageError("extract", await errorMessage(extractRes, "Extraction failed"));
        const extracted = (await extractRes.json()) as { model: string; output: unknown };
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        update("extract", { status: "done", elapsed: undefined, fact: `${extracted.model} · ${seconds}s` });

        update("check", { status: "working" });
        const checkRes = await fetch("/api/onboarding/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ output: extracted.output, text: doc.text }),
          signal: controller.signal,
        });
        if (!checkRes.ok) throw new StageError("check", await errorMessage(checkRes, "Checking the extraction failed"));
        const review = (await checkRes.json()) as ExtractionReview;
        const flagged = review.summary.unsupported + review.summary.rejected;
        update("check", {
          status: "done",
          fact: `${review.summary.filled} of ${Object.keys(review.outcomes).length} backed by the document${flagged ? ` · ${flagged} to check` : ""}`,
        });
        setResult({ fileName: doc.file_name, review, model: extracted.model });
      } catch (err) {
        if (timer) clearInterval(timer);
        if (err instanceof DOMException && err.name === "AbortError") return;
        const stage = err instanceof StageError ? err.stage : "check";
        const message = err instanceof Error ? err.message : String(err);
        update(stage, { status: "failed", elapsed: undefined });
        setFailure({ stage, message });
      }
    })();

    return () => {
      if (timer) clearInterval(timer);
      controller.abort();
      xhrRef.current?.abort();
    };
  }, [file, update]);

  const inFlight = !failure && !result;
  const flagged = result ? result.review.summary.unsupported + result.review.summary.rejected : 0;

  return (
    <div aria-labelledby="reading-title" role="group" className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 ref={headingRef} tabIndex={-1} id="reading-title" className="m-0 text-[14px] font-bold text-ink outline-none">
          {result ? "Read " : failure ? "Couldn't finish reading " : "Reading "}
          <span className="font-mono text-[12.5px] font-semibold text-ink-2 wrap-anywhere">{file.name}</span>
        </h3>
        <span className="text-[12px] text-dim">Nothing is saved from this. Every answer is checked against the document itself.</span>
      </div>

      <StageProgress stages={stages} failureMessage={failure?.message ?? null} />

      {failure && (
        <div ref={failureRef} tabIndex={-1} className="flex flex-col gap-3 outline-none">
          <Notice tone="fault" title={`${stages.find((s) => s.key === failure.stage)?.label} failed`}>
            {failure.message}
          </Notice>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary" onClick={onManual}>
              Fill it in by hand
            </Button>
            <Button onClick={onChooseAnother}>Choose a different file</Button>
          </div>
        </div>
      )}

      {result && (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line pt-4">
          <span className="text-[13px] font-bold text-ink">
            {result.review.summary.filled} filled from the document, {result.review.summary.blank} not in it
            {flagged > 0 ? `, ${flagged} to check` : ""}
          </span>
          <span className="text-[12.5px] text-dim">
            {replacing > 0
              ? `This replaces the ${replacing} answer${replacing === 1 ? "" : "s"} in the form below. Nothing is saved yet.`
              : "Each answer shows the sentence it came from. Nothing is saved yet."}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="quiet" onClick={onChooseAnother}>
              Choose another file
            </Button>
            <Button ref={reviewButton} variant="primary" onClick={() => onDone(result)}>
              Fill the form from it
            </Button>
          </div>
        </div>
      )}

      {inFlight && (
        <div>
          <Button variant="quiet" onClick={onManual}>
            Stop reading
          </Button>
        </div>
      )}
    </div>
  );
}
