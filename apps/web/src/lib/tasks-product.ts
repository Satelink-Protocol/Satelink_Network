// apps/web/src/lib/tasks-product.ts
//
// The task-commerce ("500 Verified Local Business Leads") product is a
// separate, unrelated business from the RPC/intelligence products this
// merchant account is being reviewed for. Flag-gated OFF by default so it
// doesn't surface during that review; the page and its checkout route both
// 404 while the flag is off. Server-only var (no NEXT_PUBLIC_ prefix) since
// both call sites are server components / route handlers.
export function isTasksProductEnabled(): boolean {
  return process.env.TASKS_PRODUCT_ENABLED === "true";
}
