/**
 * DEPRECATED — legacy EJS/static HTML UI.
 *
 * All UI is served by the Next.js app (apps/web/, app.satelink.network).
 * The Express API must never serve HTML: this module was the only
 * express.static / EJS mount point and is intentionally a no-op so it
 * cannot be re-mounted by accident. The legacy implementation is gated
 * behind LEGACY_EJS_UI=1 strictly for local archaeology.
 */
import express from "express";
import path from "path";

export function attachUI(app, db) {
    if (process.env.LEGACY_EJS_UI !== "1") {
        console.warn("[UI] attachUI is deprecated — UI is served by Next.js (apps/web). Skipping EJS/static mounts.");
        return;
    }

    app.set("view engine", "ejs");
    app.set("views", path.join(process.cwd(), "views"));
    app.use("/legacy-static", express.static(path.join(process.cwd(), "public")));
}
