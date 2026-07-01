export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `.satelink-os` applies the @satelink/ui token scope (background,
  // foreground, state colors) so the public status page shares the same
  // visual system as the dashboards.
  return <div className="satelink-os min-h-screen p-8">{children}</div>;
}
