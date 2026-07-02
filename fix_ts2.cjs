const fs = require('fs');

function replace(file, from, to) {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');
    content = content.split(from).join(to);
    fs.writeFileSync(file, content);
}

replace('apps/web/src/app/(admin)/admin/diagnostics/incidents/page.tsx', 'title=', 'label=');
replace('apps/web/src/app/(admin)/admin/diagnostics/self-tests/page.tsx', 'title=', 'label=');
replace('apps/web/src/app/(admin)/admin/page.tsx', 'title=', 'label=');
replace('apps/web/src/app/(admin)/admin/revenue/page.tsx', 'title=', 'label=');

replace('apps/web/src/app/(builder)/builder/page.tsx', '<div title=', '<Panel title=');
replace('apps/web/src/app/(builder)/builder/projects/page.tsx', '<div title=', '<Panel title=');
replace('apps/web/src/app/(distributor)/distributor/page.tsx', '<div title=', '<Panel title=');
replace('apps/web/src/app/(distributor)/distributor/referrals/page.tsx', '<div title=', '<Panel title=');

replace('apps/web/src/app/(builder)/builder/page.tsx', '</div>', '</Panel>');
replace('apps/web/src/app/(builder)/builder/projects/page.tsx', '</div>', '</Panel>');
replace('apps/web/src/app/(distributor)/distributor/page.tsx', '</div>', '</Panel>');
replace('apps/web/src/app/(distributor)/distributor/referrals/page.tsx', '</div>', '</Panel>');

replace('apps/web/src/app/admin/command-center/page.tsx', '<EmptyState title=', '<EmptyState label=');
replace('apps/web/src/app/admin/command-center/page.tsx', 'variant="ghost"', 'tone="muted"');

console.log("Done");
