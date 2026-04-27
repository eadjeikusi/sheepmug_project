# Reports Builder QA Checklist

## Scope
- Platforms: mobile and web
- Report types: branch, group, membership, leader
- Flows: generate, save definition, run saved definition, export

## Smoke Cases
- Open Reports screen/page: empty state appears and no auto-generation occurs.
- Select each report type and generate report with default filters.
- Group report: select multiple groups and verify output updates.
- Membership report: pick one member and verify drilldown contains that member only.
- Leader report: pick leader and verify metrics are scoped to leader-owned groups.
- Save report definition and verify it appears in saved list.
- Run saved report definition and verify generated output.
- Export CSV succeeds for users with `export_data`.
- Export action is denied for users without `export_data`.

## Performance Cases
- Generate branch report with 365-day range and confirm response is returned.
- Generate group report with many groups selected.
- Generate report with attendance filters and ensure response is stable.

## Regression Checks
- Existing `/api/reports/summary` endpoint still returns payload.
- Mobile dashboard Reports quick-access chip opens reports.
- Web sidebar Reports item opens reports page.
