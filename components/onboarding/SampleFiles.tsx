import { SAMPLE_CSVS, SAMPLE_PRICE_LIST, sampleHref, type SampleFile } from "@/lib/sampleFiles";
import { focusRing } from "./ui";

/**
 * Something to drag, for a visitor who arrives with no gym's paperwork of their
 * own. Every link serves the committed file itself (lib/sampleFiles.ts).
 */

const LINK = `rounded-sm font-semibold text-accent-ink underline decoration-accent-line underline-offset-2 hover:text-ink ${focusRing}`;

function SampleLink({ file, children }: { file: SampleFile; children?: React.ReactNode }) {
  return (
    <a href={sampleHref(file)} download={file.name} className={LINK}>
      {children ?? file.label}
    </a>
  );
}

export function SamplePriceList() {
  return (
    <p className="mb-4 max-w-[62ch] text-[12.5px] leading-[1.55] text-ink-2 text-pretty">
      <strong className="text-ink">No document to hand?</strong> Download the <SampleLink file={SAMPLE_PRICE_LIST}>sample price list</SampleLink>{" "}
      (PDF) and drop it below. It&apos;s the same file the extraction checks are run against, and its &ldquo;15% off their first month&rdquo;
      should come back flagged for you, not filled in as a renewal discount.
    </p>
  );
}

export function SampleCsvs() {
  return (
    <p className="text-[12.5px] leading-[1.55] text-ink-2 text-pretty">
      <strong className="text-ink">Sample CSVs:</strong>{" "}
      {SAMPLE_CSVS.map((file, i) => (
        <span key={file.name}>
          {i > 0 ? " · " : ""}
          <SampleLink file={file} />
        </span>
      ))}
      . 500 synthetic members with fake phone numbers, their contracts and check-ins. Import them in that order.
    </p>
  );
}
