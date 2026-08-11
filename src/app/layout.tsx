import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Equity Compass | FRIEDD SNAKE Evaluator",
  description:
    "Equity Compass — the FRIEDD SNAKE stock evaluation tool for Invest With Bjorn students.",
};

// Phase 3.1 item 15 — dark mode preference, applied before paint. This has to
// run as a blocking inline script in <head>, not a useEffect in a client
// component: React only commits after the initial HTML has painted, so a
// class toggle from an effect would show a flash of the wrong theme on every
// load. localStorage key mirrors what src/components/theme-toggle.tsx reads
// and writes.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("equity-compass-theme");
    var theme = stored === "dark" || stored === "light"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (theme === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmSerifDisplay.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  );
}
