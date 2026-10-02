import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://joblens-app.vercel.app"),
  title: "JobLens · AI job matcher",
  description: "Match your CV to real job offers across Europe and generate tailored cover letters, CVs and sourced salary estimates.",
  // Link previews (LinkedIn, Slack, WhatsApp…)
  openGraph: {
    title: "JobLens · AI job matcher",
    description: "Upload your CV, get the real job offers that fit you best across Europe, and generate tailored applications.",
    url: "https://joblens-app.vercel.app",
    siteName: "JobLens",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
