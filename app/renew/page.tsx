import LinkLanding from "@/components/LinkLanding";

export const metadata = { title: "Retention Router" };

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <LinkLanding kind="renewal" searchParams={searchParams} />;
}
