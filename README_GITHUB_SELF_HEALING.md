# GFTSH 10-Wallet Observer — GitHub Self-Healing 5-Minute Scheduler

This package keeps the existing RR<0.50 observer logic unchanged and changes only the GitHub scheduling layer.

## What changed

- GitHub cron remains enabled as a backup/bootstrap trigger.
- The cron is offset to `2-59/5 * * * *` to avoid exact top-of-hour contention.
- Each successful/failed workflow run schedules the next run with `workflow_dispatch` after 5 minutes from the start of the current run.
- `actions: write` permission is enabled for the built-in `GITHUB_TOKEN` so the workflow can dispatch itself.
- `concurrency.cancel-in-progress: true` prevents a delayed GitHub cron event from building a queue; a cron-triggered run replaces the currently running chain run.
- The observer remains read-only: no orders and no auto-copy.

## Bootstrap

After replacing the workflow file on the repository default branch, run `GFTSH 10 Wallet Observer` once with **Run workflow**. That starts the self-healing chain. After that, each run dispatches the next run automatically every 5 minutes, while the cron remains a recovery mechanism.

## Important

GitHub scheduled events are not a real-time guarantee; GitHub documents that schedule events can be delayed or dropped during high load. The self-dispatch chain removes the dependency on the scheduled event for every 5-minute cycle. A runner failure/cancellation can still break the chain; the backup cron/manual dispatch can restart it.
