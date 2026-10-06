GFTSH V2.3.2 — GIT-PERSISTENT 30D BEHAVIOR HUNTER
READ-ONLY / NO ORDERS / NO AUTO-COPY

Purpose:
Persist verified pre-pump/pre-dump behavior evidence across GitHub Actions runs.
The repository itself is the durable state store because ubuntu-latest runners are ephemeral.

V2.3.2 changes:
- Persists state/gftsh_global_behavior_v23.json back into the repository after successful runs.
- Persists the rotation cursor, so the next 5-minute cycle continues from the previous batch.
- Uses git add -f so state is persisted even if a repository .gitignore matches state/.
- Persists only after a successful worker run; failed/cancelled runs do not overwrite durable behavior state.
- Verifies the persisted JSON schema before completing the job.
- Keeps the V2.3.1 open-time reconstruction fix.
- Keeps verified-event deduplication and rolling 30D retention.
- Keeps strict quality, copyability, current-position and fresh-entry gates.
- Does not lower any gate to manufacture signals.

Expected rotation:
Run 1: cursor 0 -> 40
Run 2: cursor 40 -> 80
Run 3: cursor 80 -> 120
...
Run N: cursor resumes from the committed state.

Expected behavior database:
loaded=<previous persisted events>
currentVerified=<new events this cycle>
retained30D=<merged rolling 30D events>
repeatable=<traders with >=2 verified events on >=2 distinct coins>

IMPORTANT:
The GitHub workflow requires contents: write and runs in the production environment.
No VPS is required.
