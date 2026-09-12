"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Queue" },
  { href: "/intelligence", label: "Why they leave" },
  { href: "/evals", label: "Evals" },
  { href: "/members", label: "All members" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-20 border-b border-zinc-900 bg-black/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-1 px-6 py-3 sm:px-8">
        <Link href="/" className="mr-4 flex items-center gap-2 whitespace-nowrap">
          <span className="h-2 w-2 rounded-full bg-[#D6FF3D]" />
          <span className="text-sm font-black uppercase tracking-tight text-white">
            Retention Router
          </span>
        </Link>
        <div className="flex items-center gap-1 overflow-x-auto">
          {links.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  active
                    ? "bg-zinc-900 text-[#D6FF3D]"
                    : "text-zinc-500 hover:text-zinc-200"
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
