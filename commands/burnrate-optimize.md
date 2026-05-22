# /burnrate:burnrate-optimize

Analyze your Copilot CLI session history for cost patterns and usage inefficiencies.
Produces a prioritized health report with actionable recommendations to reduce spend.

Use when the user asks: "optimize my usage", "find token waste", "why am I spending so much", "analyze my sessions", `/burnrate-optimize`.

## Instructions

Run the optimize script and present the output to the user.

```bash
node "${PLUGIN_ROOT}/skills/burnrate-optimize/scripts/optimize.js" $ARGUMENTS
```

Pass any arguments the user provided (e.g., `--days 7`, `--project foo`) directly through to the script.

After the output, briefly explain the top finding if any recommendations are present, and offer to help apply the top fix.
