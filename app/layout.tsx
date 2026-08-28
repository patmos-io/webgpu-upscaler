import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebGPU Upscaler — Scale images & video free with your GPU",
  description:
    "Real-time image and video upscaling using WebGPU and your local GPU. 100% free, 100% in your browser. No server, no upload, no limits.",
  openGraph: {
    title: "WebGPU Upscaler — Scale free with your GPU",
    description:
      "AI image and video upscaling with WebGPU. Runs in your browser, uses your local GPU. No server, no costs.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
