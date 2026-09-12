// Small two-tone circular avatar, stand-in for a photo — no images used.
// The color pair is derived from member_id so the same person always
// gets the same avatar without storing anything extra in the data file.

const PALETTE: [string, string][] = [
  ["#F4F4F5", "#7C3AED"],
  ["#F4F4F5", "#2563EB"],
  ["#F4F4F5", "#DB2777"],
  ["#F4F4F5", "#059669"],
  ["#F4F4F5", "#EA580C"],
  ["#F4F4F5", "#0EA5E9"],
];

function hashToIndex(id: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) % length;
  }
  return Math.abs(hash);
}

export default function Avatar({
  id,
  size = "md",
}: {
  id: string;
  size?: "sm" | "md";
}) {
  const [a, b] = PALETTE[hashToIndex(id, PALETTE.length)];
  const dimension = size === "sm" ? "h-9 w-9" : "h-10 w-10";

  return (
    <span
      className={`inline-block flex-shrink-0 rounded-full ${dimension}`}
      style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }}
      aria-hidden="true"
    />
  );
}
