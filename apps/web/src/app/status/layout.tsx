export default function StatusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-950 text-zinc-100 min-h-screen p-8">{children}</div>
  );
}
