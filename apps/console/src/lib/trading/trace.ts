// Stage 29 — "Why did Satelink do this?" → the full trace. The receipt carries a W3C traceparent
// (Stage 19); the link target comes from a server-side template (CONSOLE_TRACE_URL_TEMPLATE, e.g. a
// Grafana/Tempo explore URL containing {traceId}). Only https templates are accepted; with no
// template the page shows the trace id alone (support can look it up).
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function traceLink(traceparent: string | null | undefined, template: string | null | undefined): { traceId: string; url: string | null } | null {
  const m = typeof traceparent === "string" ? TRACEPARENT.exec(traceparent) : null;
  if (!m || /^0+$/.test(m[1])) return null;
  const ok = typeof template === "string" && /^https:\/\/[^\s]+$/.test(template) && template.includes("{traceId}");
  return { traceId: m[1], url: ok ? template!.split("{traceId}").join(m[1]) : null };
}
