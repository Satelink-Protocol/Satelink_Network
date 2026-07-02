const fs = require('fs');

function replace(file, from, to) {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');
    content = content.split(from).join(to);
    fs.writeFileSync(file, content);
}

replace('apps/web/src/app/(admin)/admin/diagnostics/incidents/page.tsx', 'label=', 'title=');
replace('apps/web/src/app/(admin)/admin/diagnostics/self-tests/page.tsx', 'label=', 'title=');
replace('apps/web/src/app/(admin)/admin/diagnostics/self-tests/page.tsx', '("failed" as const)', '("failed" as any)');
replace('apps/web/src/app/(admin)/admin/page.tsx', 'label=', 'title=');
replace('apps/web/src/app/(admin)/admin/revenue/page.tsx', 'label=', 'title=');
replace('apps/web/src/app/(admin)/admin/rewards/epochs/page.tsx', 'variant="secondary"', 'variant="neutral"');
replace('apps/web/src/app/(admin)/admin/security/page.tsx', 'loading={busy}', 'loading={busy || false}');

replace('apps/web/src/app/(builder)/builder/page.tsx', '<DashboardSection', '<div');
replace('apps/web/src/app/(builder)/builder/page.tsx', '</DashboardSection>', '</div>');
replace('apps/web/src/app/(builder)/builder/projects/page.tsx', '<DashboardSection', '<div');
replace('apps/web/src/app/(builder)/builder/projects/page.tsx', '</DashboardSection>', '</div>');

replace('apps/web/src/app/(distributor)/distributor/page.tsx', '<DashboardSection', '<div');
replace('apps/web/src/app/(distributor)/distributor/page.tsx', '</DashboardSection>', '</div>');
replace('apps/web/src/app/(distributor)/distributor/referrals/page.tsx', '<DashboardSection', '<div');
replace('apps/web/src/app/(distributor)/distributor/referrals/page.tsx', '</DashboardSection>', '</div>');

replace('apps/web/src/app/admin/command-center/page.tsx', 'className="flex items-center gap-1"', '');
replace('apps/web/src/app/admin/command-center/page.tsx', 'tone={s.status === "operational" ? "success" : "warning"}', 'tone={s.status === "operational" ? "success" : "warn"}');
replace('apps/web/src/app/admin/command-center/page.tsx', 'gap="xs"', 'gap="sm"');
replace('apps/web/src/app/admin/command-center/page.tsx', 'style={{ width: "100%" }}', '');
replace('apps/web/src/app/admin/command-center/page.tsx', 'style={{ width: "100%", marginTop: "4px" }}', '');
replace('apps/web/src/app/admin/command-center/page.tsx', 'icon={DollarSign}', '');
replace('apps/web/src/app/admin/command-center/page.tsx', 'className="mb-3"', '');
replace('apps/web/src/app/admin/command-center/page.tsx', 'variant="ghost"', 'tone="muted"');

console.log("Done");
