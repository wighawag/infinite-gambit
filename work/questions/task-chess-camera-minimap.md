<!-- dorfl-sidecar: item=task:chess-camera-minimap type=task slug=chess-camera-minimap allAnswered=false -->

## Q1

**'task:chess-camera-minimap' was bounced — how should we proceed?**

> prepare (env-prep) failed (exit 1) on the rebased tip

<!-- q1 fields: id=q1 kind=stuck -->

**Your answer** (write below this line):
keep. The prepare race is fixed on main (#7: the root devDepends on the contracts workspace, so the two compiles no longer run at once). The committed work is complete and reviewed: do not redo it, check it is still green and finish.
