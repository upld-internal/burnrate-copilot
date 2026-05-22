# /burnrate:burnrate-report

Package burnrate-copilot user data into a zip file for bug reports.
Collects monthly cost records, session files, config, and settings into a
single zip the user can share with support.

Use when the user asks: "report a bug", "something is wrong with burnrate", "send debug info", "create a support report", `/burnrate-report`.

## Instructions

Run the following command and present the output to the user.

```bash
node "${PLUGIN_ROOT}/skills/burnrate-report/scripts/report.js" $ARGUMENTS
```

If `$ARGUMENTS` is empty, the zip is written to the current working directory as
`burnrate-report-YYYY-MM-DD.zip`. The user may pass `--output /path/to/file.zip`
to choose a different location.

After the output, tell the user the exact path of the zip file and ask them to
share it with support along with a brief description of the issue they are seeing.
