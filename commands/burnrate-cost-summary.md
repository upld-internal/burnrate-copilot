# /burnrate:burnrate-cost-summary

Show session cost summary grouped by project for the current or a specified month.

Use when the user asks: "show my costs", "cost summary", "how much have I spent", "monthly spend", "usage report", `/burnrate-cost-summary`.

## Instructions

Run the following command and present the output exactly as described in
`${PLUGIN_ROOT}/skills/burnrate-cost-summary/reference/OUTPUT_FORMAT.md`.

```bash
node "${PLUGIN_ROOT}/skills/burnrate-cost-summary/scripts/summarize-costs.js" $ARGUMENTS --by-project --by-jira
```

If `$ARGUMENTS` is empty, the script defaults to the current month.
The user may pass a specific month (e.g. `2026-04`) or a month plus date range
(e.g. `2026-05 2026-05-01 2026-05-15`) as arguments.
