"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Queue" },
  { href: "/intelligence", label: "Gym health" },
  { href: "/evals", label: "Evals" },
  { href: "/members", label: "All members" },
  { href: "/onboarding", label: "Set up a gym" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-20 border-b border-zinc-900 bg-black/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-1 gap-y-2 px-6 py-3 sm:flex-nowrap sm:px-8">
        <Link href="/" className="mr-4 flex items-center gap-2 whitespace-nowrap">
          <span className="h-2 w-2 rounded-full bg-[#D6FF3D]" />
          <span className="text-sm font-black uppercase tracking-tight text-white">
            Retention Router
          </span>
        </Link>
        <div className="order-last flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {links.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D6FF3D] ${
                  active
                    ? "bg-zinc-900 text-[#D6FF3D]"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
