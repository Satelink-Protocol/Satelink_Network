import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
        background: "var(--bg-base, #0A0A0B)",
        color: "var(--text-primary, #FAFAFA)",
      }}
    >
      <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, opacity: 0.6, margin: 0 }}>
        HTTP 404
      </p>
      <h1 style={{ fontSize: 32, margin: 0, letterSpacing: "-0.02em" }}>Page not found</h1>
      <p style={{ maxWidth: 420, opacity: 0.7, lineHeight: 1.6, margin: 0 }}>
        The page you&apos;re looking for doesn&apos;t exist or has moved. If a
        link on our site brought you here, please{" "}
        <a href="https://github.com/Satelink-Protocol/Satelink_Network/issues" style={{ color: "#2DD4BF" }}>
          report it
        </a>
        .
      </p>
      <nav style={{ display: "flex", gap: 20, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <Link href="/" style={{ color: "#2DD4BF" }}>Home</Link>
        <Link href="/docs" style={{ color: "#2DD4BF" }}>Documentation</Link>
        <Link href="/status" style={{ color: "#2DD4BF" }}>Status</Link>
        <Link href="/satelink/os/keys" style={{ color: "#2DD4BF" }}>Get API Key</Link>
      </nav>
    </div>
  );
}
