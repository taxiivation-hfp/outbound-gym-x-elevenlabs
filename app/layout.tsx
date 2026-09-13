import type { Metadata } from "next";
import { Archivo, Figtree } from "next/font/google";
import { THEME_STORAGE_KEY } from "@/components/shell/theme";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Retention Router — outbound gym retention",
  description:
    "Calls the gym members worth calling, and leaves alone the ones a call would cost you.",
};

/**
 * Applies the remembered theme before first paint, so a light-theme user never
 * sees a dark flash. Dark is the default. The toggle writes the same key.
 */
const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${archivo.variable} ${figtree.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
