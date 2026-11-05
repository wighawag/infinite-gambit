# A non-pawn piece's `forward` is its army's facing, not North

2026-11-05. `UsingGameTypes.Piece.forward` documents "North for every other piece" (non-pawns), but `ChessRules.layout` rotates every piece's canonical North by the army's facing, so an East-facing army's knights, rooks and king carry `forward: East`. Nothing reads it for a non-pawn today; either the doc or the layout should change (spotted while writing `contracts/test/js/Moves.test.ts`).
