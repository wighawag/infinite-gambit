<!-- dorfl-sidecar: item=task:chess-camera-minimap type=task slug=chess-camera-minimap allAnswered=false -->

## Q1

**'task:chess-camera-minimap' was bounced — how should we proceed?**

> prepare (env-prep) failed (exit 1) on the rebased tip

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
keep. The gate failed in prepare on the known hardhat compile race (two concurrent compiles from the install prepare scripts, see work/notes/observations/prepare-races-two-hardhat-compiles.md), not on the work. The committed work on work/task-chess-camera-minimap is complete: do not redo it; the conductor rebases the branch onto main, check it is still green and finish.
