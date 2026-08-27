import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GPU Upscaler — Escalá imágenes y video gratis con tu GPU",
  description:
    "Upscaling de imágenes y video en tiempo real usando WebGPU y tu GPU local. 100% gratis, 100% en tu navegador. Sin servidor, sin upload, sin límites.",
  openGraph: {
    title: "GPU Upscaler — Escalá gratis con tu GPU",
    description:
      "Upscaling AI de imágenes y video con WebGPU. Corre en tu navegador, usa tu GPU local. Sin servidor, sin costos.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
