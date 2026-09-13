/**
 * Owns: the registry of committed files a visitor may download as samples on the configuration screens.
 * Not here: reading them (app/api/samples/[file]/route.ts) — this file stays free of fs so the
 * client components that link to the samples can import it.
 */

/**
 * Each sample is served straight from the file the rest of the repo already
 * relies on, never a copy that could drift: the price list is the PDF whose
 * extracted text the `pdf-documents-keep-their-facts` guard checks, and the
 * CSVs are the raw tables the pipeline builds the synthetic dataset from (and
 * `data:verify-port` and `db:verify` read).
 */
export interface SampleFile {
  /** The URL segment and the downloaded file's name. */
  name: string;
  /** Path from the project root. Also listed in next.config.ts so it is traced into the deployment. */
  path: string;
  contentType: string;
  label: string;
}

export const SAMPLE_PRICE_LIST: SampleFile = {
  name: "sample-price-list.pdf",
  path: "evals/documents/pdf/sample-price-list.pdf",
  contentType: "application/pdf",
  label: "Sample price list (PDF)",
};

export const SAMPLE_CSVS: SampleFile[] = [
  { name: "sample-members.csv", path: "pipeline/data/members.csv", contentType: "text/csv; charset=utf-8", label: "members.csv" },
  { name: "sample-contracts.csv", path: "pipeline/data/contracts.csv", contentType: "text/csv; charset=utf-8", label: "contracts.csv" },
  { name: "sample-checkins.csv", path: "pipeline/data/checkins.csv", contentType: "text/csv; charset=utf-8", label: "checkins.csv" },
];

export const SAMPLE_FILES: SampleFile[] = [SAMPLE_PRICE_LIST, ...SAMPLE_CSVS];

export function sampleHref(file: SampleFile): string {
  return `/api/samples/${file.name}`;
}
