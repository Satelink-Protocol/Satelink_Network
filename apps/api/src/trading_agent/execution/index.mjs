// Trading agent — execution subdomain (Stage 09 skeleton; no runtime behaviour yet).
// See ./README.md.
export const DOMAIN = "execution";
export const TABLES = Object.freeze(["fills"]);
export const FLAGS = Object.freeze(["LIVE_TRADING","LIVE_SMALL"]);
export const STATUS = "skeleton";
