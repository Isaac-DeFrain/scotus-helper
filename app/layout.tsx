import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { themeInitScript } from "@/src/libs/theme";

export const metadata: Metadata = {
  title: "U.S. Supreme Court Helper",
  description:
    "Ask questions about U.S. Supreme Court opinions, rulings, cases, or related legal topics.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
