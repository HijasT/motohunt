import type { MetadataRoute } from "next";

// Makes the app installable ("Add to Home Screen") so it opens full-screen like a
// native app. No service worker: the data is live from Supabase, so offline
// support wouldn't have anything useful to show.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MotoHunt",
    short_name: "MotoHunt",
    description: "Tracks UAE used-car listings against your saved searches.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#f97316",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
