import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Shipyard", template: "%s · Shipyard" },
  description: "Shipyard - private control panel for the VPS",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#151514" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = (await cookies()).get("shipyard-theme")?.value;
  const attr = theme === "light" || theme === "dark" ? theme : undefined;
  return (
    <html lang="en" className="h-full antialiased" data-theme={attr}>
      <body className="min-h-full bg-bg text-fg">{children}</body>
    </html>
  );
}
