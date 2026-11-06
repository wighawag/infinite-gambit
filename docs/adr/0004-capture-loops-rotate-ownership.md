# Capture loops rotate ownership instead of destroying the armies

> Superseded by `docs/adr/0014-a-capture-whose-captor-falls-the-same-cycle-leaves-a-stone.md`: a ring of captures in one cycle leaves stones; nothing rotates.

When kings capture each other in a ring within one cycle (A takes B while B takes A, or longer), the pieces that captured the kings die, every king survives where it stood, and each owner takes over the army and stake it captured. We rejected refunding the stakes because one person owning two armies could arrange a mutual capture and recover a stake anywhere on the board, skipping the exits. We rejected burning the stakes because it is a dead end, and rotating ownership gives each captor exactly what it captured, as in a normal capture, while giving a single owner of both armies nothing. The capturing pieces die rather than bouncing back so that resolution stays lazy (`docs/adr/0002-order-free-lazy-resolution.md`).
