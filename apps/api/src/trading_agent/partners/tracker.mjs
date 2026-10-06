// Partner-validation tracker (Stage 32). The tracker (docs/trading-agent/partners/partners.json) records
// each broker's partner programme state and the founder-provided, WRITTEN evidence behind every change.
// Rules:
//   * every state change cites evidence ids; no evidence, no change;
//   * evidence is a reference to a document the founder holds (email Message-ID, signed agreement id,
//     portal record, ticket number), never the document itself, and never verbal (Stage 32 STOP);
//   * PARTNER_APPROVED needs a written confirmation; for Binance also the Link ID fingerprint and the
//     rebate-API answer;
//   * the Link ID value never appears here; only its fingerprint (see link_id.mjs).
export const PARTNER_STATES = Object.freeze(['UNVERIFIED', 'APPLIED', 'IN_REVIEW', 'PARTNER_APPROVED', 'DECLINED']);
const TRANSITIONS = Object.freeze({
  UNVERIFIED: ['APPLIED'],
  APPLIED: ['IN_REVIEW', 'PARTNER_APPROVED', 'DECLINED'],
  IN_REVIEW: ['PARTNER_APPROVED', 'DECLINED'],
  PARTNER_APPROVED: [],
  DECLINED: ['APPLIED'],
});
/** Written evidence kinds. Anything else (verbal, call, meeting …) is refused. */
export const WRITTEN_KINDS = Object.freeze(['signed_agreement', 'email', 'letter', 'portal_record', 'ticket']);
const VERBAL = /^(verbal|phone|call|meeting|conversation|oral|chat_unrecorded)/i;
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const FORBIDDEN_KEYS = /^(link_?id|linkIdValue|api_?key|secret|password|token)$/i;

/** Validate the whole tracker. Returns a list of problems (empty = valid). */
export function validateTracker(tracker) {
  const problems = [];
  if (tracker?.schema !== 'partner-tracker/1.0') problems.push('schema must be partner-tracker/1.0');
  const partners = Array.isArray(tracker?.partners) ? tracker.partners : [];
  if (!partners.length) problems.push('no partners');
  walkKeys(tracker, (k, path) => { if (FORBIDDEN_KEYS.test(k)) problems.push(`${path}: key "${k}" is not allowed (no Link ID values or secrets in git)`); });
  for (const p of partners) problems.push(...validatePartner(p).map((m) => `${p?.id ?? '?'}: ${m}`));
  return problems;
}

export function validatePartner(p) {
  const out = [];
  const ev = new Map();
  for (const e of p.evidence ?? []) {
    if (!/^EV-[A-Z]{3}-\d{3}$/.test(e.id ?? '')) out.push(`evidence id "${e.id}" must look like EV-BIN-001`);
    if (ev.has(e.id)) out.push(`duplicate evidence id ${e.id}`);
    ev.set(e.id, e);
    if (VERBAL.test(e.kind ?? '')) out.push(`${e.id}: verbal evidence is not accepted; a written document reference is required`);
    else if (!WRITTEN_KINDS.includes(e.kind)) out.push(`${e.id}: kind must be one of ${WRITTEN_KINDS.join(', ')}`);
    if (e.providedBy !== 'founder') out.push(`${e.id}: providedBy must be "founder"`);
    if (typeof e.documentRef !== 'string' || e.documentRef.trim().length < 4 || e.documentRef.length > 200) out.push(`${e.id}: documentRef (4–200 chars) required`);
    if (Number.isNaN(Date.parse(e.receivedAt ?? ''))) out.push(`${e.id}: receivedAt date required`);
  }
  const cite = (ids, where) => {
    if (!Array.isArray(ids) || !ids.length) { out.push(`${where}: cites no evidence`); return []; }
    return ids.map((id) => { if (!ev.has(id)) out.push(`${where}: unknown evidence ${id}`); return ev.get(id); }).filter(Boolean);
  };
  const items = new Map((p.items ?? []).map((i) => [i.id, i]));
  for (const i of p.items ?? []) {
    if (!['NO_EVIDENCE', 'EVIDENCED'].includes(i.status)) out.push(`item ${i.id}: status must be NO_EVIDENCE or EVIDENCED`);
    if (i.status === 'EVIDENCED') cite(i.evidence, `item ${i.id}`);
    if (i.status === 'NO_EVIDENCE' && (i.evidence?.length || i.answer || i.linkIdFingerprint)) out.push(`item ${i.id}: NO_EVIDENCE items carry no evidence, answer or fingerprint`);
    if (i.id === 'link_id' && i.status === 'EVIDENCED' && !FINGERPRINT_RE.test(i.linkIdFingerprint ?? '')) out.push('item link_id: linkIdFingerprint (16 hex) required');
    if (i.id === 'rebate_api' && i.status === 'EVIDENCED' && !(typeof i.answer === 'string' && i.answer.trim())) out.push('item rebate_api: the written answer summary is required');
  }
  let state = 'UNVERIFIED';
  for (const [n, h] of (p.history ?? []).entries()) {
    const where = `history[${n}] ${h.from}→${h.to}`;
    if (h.from !== state) out.push(`${where}: from must be ${state}`);
    if (!(TRANSITIONS[state] ?? []).includes(h.to)) out.push(`${where}: transition not allowed`);
    const cited = cite(h.evidence, where);
    if (h.to === 'PARTNER_APPROVED' || h.to === 'DECLINED') {
      if (!cited.some((e) => ['signed_agreement', 'email', 'letter'].includes(e.kind))) out.push(`${where}: needs a written confirmation (signed agreement, email or letter) from the broker`);
    }
    if (h.to === 'PARTNER_APPROVED') {
      for (const req of p.approvalRequires ?? []) if (items.get(req)?.status !== 'EVIDENCED') out.push(`${where}: item ${req} must be EVIDENCED first`);
    }
    state = h.to;
  }
  if (p.state !== state) out.push(`state "${p.state}" must equal the history result "${state}"`);
  if (!PARTNER_STATES.includes(p.state)) out.push(`unknown state ${p.state}`);
  return out;
}

function walkKeys(v, fn, path = '$') {
  if (Array.isArray(v)) v.forEach((x, i) => walkKeys(x, fn, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { fn(k, `${path}.${k}`); walkKeys(x, fn, `${path}.${k}`); }
}

export function partnerById(tracker, id) { return (tracker?.partners ?? []).find((p) => p.id === id) ?? null; }
