<!-- dorfl-sidecar: item=task:chess-camera-minimap type=task slug=chess-camera-minimap allAnswered=false -->

## Q1

**'task:chess-camera-minimap' was bounced — how should we proceed?**

> prepare (env-prep) failed (exit 1) on the rebased tip

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
keep. Same hardhat compile race in prepare, twice in a row; the conductor runs the verify gate itself in a scratch clone with the prepare steps run one after another, and re-integrates the kept work.
