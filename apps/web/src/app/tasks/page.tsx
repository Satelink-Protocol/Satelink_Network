// apps/web/src/app/tasks/page.tsx
//
// Standalone landing page for the task-commerce product. No nested layout —
// inherits only the bare root layout (no nav/dashboard chrome), same pattern
// as /status and /docs. Isolated from the rest of the site: this is the only
// page that links here, and nothing else links to it (yet).
//
// The form is a plain HTML POST (no client JS) to /api/tasks/start, which
// writes a pending task_orders row and redirects to the Dodo checkout link.
//
// Flag-gated (TASKS_PRODUCT_ENABLED, default OFF): this is a separate,
// unrelated business (lead-data brokerage) from the RPC/intelligence
// products under merchant review — see isTasksProductEnabled().

import { notFound } from "next/navigation";
import { isTasksProductEnabled } from "@/lib/tasks-product";

export const metadata = {
  title: "500 Verified Local Business Leads — Satelink",
  description:
    "We extract 500 verified local business leads from Google Maps for your target city and category. Pay once, get your list by email within 24 hours.",
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_city: "Please enter a city.",
  invalid_category: "Please enter a business category.",
  invalid_email: "Please enter a valid email address.",
  invalid_form: "Something went wrong submitting the form — please try again.",
  order_failed: "We couldn't start your order — please try again in a moment.",
};

export default async function TasksLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!isTasksProductEnabled()) notFound();

  const { error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] ?? "Please check your details and try again." : null;

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <p className="text-sm font-medium text-muted-foreground">Satelink Tasks</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        500 Verified Local Business Leads
      </h1>
      <p className="mt-4 text-base text-muted-foreground">
        Tell us a city and a business category. We extract 500 verified leads
        from Google Maps — name, address, phone, rating, and website — and
        email you the list.
      </p>

      {errorMessage && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <div className="mt-6 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">₹499</span>
        <span className="text-sm text-muted-foreground">one-time</span>
      </div>
      <p className="mt-1 text-sm font-medium">Pay → get your list by email within 24h.</p>

      <form method="POST" action="/api/tasks/start" className="mt-8 space-y-4">
        <div>
          <label htmlFor="city" className="block text-sm font-medium">
            City
          </label>
          <input
            id="city"
            name="city"
            type="text"
            required
            maxLength={100}
            placeholder="e.g. Austin"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="category" className="block text-sm font-medium">
            Business category
          </label>
          <input
            id="category"
            name="category"
            type="text"
            required
            maxLength={100}
            placeholder="e.g. plumbers"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email (your list is sent here)
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={254}
            placeholder="you@company.com"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="mt-2 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
        >
          Pay ₹499 and order
        </button>
      </form>

      <p className="mt-6 text-xs text-muted-foreground">
        Payment is handled by Dodo Payments. Fulfillment is manual for the
        first orders — you&rsquo;ll receive your list by email, typically
        within 24 hours.
      </p>
    </div>
  );
}
