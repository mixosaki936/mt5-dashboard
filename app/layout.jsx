import "./globals.css";

export const metadata = {
  title: "MT5 Portfolio Dashboard",
  description: "Live MT5 account dashboard — whole portfolio and per-pair breakdown",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d0d0d",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" className="dark">
      <body className="min-h-screen bg-page font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
