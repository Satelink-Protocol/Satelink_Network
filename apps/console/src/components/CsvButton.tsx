"use client";

export function CsvButton({ rows, filename }: { rows: (string | number)[][]; filename: string }) {
  return (
    <button
      type="button"
      className="h-7 rounded border border-sl-border px-2.5 text-xs text-sl-text hover:border-sl-accent"
      onClick={() => {
        const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }}
    >
      Export CSV
    </button>
  );
}
