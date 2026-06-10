/**
 * Process-local spawn counter (design D5). Increments on every Verifier spawn
 * routed through the scripted-verdict double. Phase-3 control-flow tests bind to
 * this to assert "no Verifier call was made" when the procedure short-circuits
 * (antecedent-false `implies`, ambiguous-antecedent errors).
 */
let count = 0;

export const getSpawnCount = (): number => count;
export const resetSpawnCount = (): void => {
  count = 0;
};
export const incrementSpawnCount = (): number => (count += 1);
