export function applyGuardrails(message: string): { isValid: boolean; flaggedReason?: string } {
  const flaggedPhrases = [
    /insurance will pay/i,
    /we will negotiate/i,
    /you are covered/i,
    /waive your deductible/i,
    /free roof/i,
    /guarantee approval/i,
    /we handle the insurance/i,
    /file a claim for you/i,
    /roof (is|has) damaged?/i,
    /damage to your roof/i
  ];

  for (const regex of flaggedPhrases) {
    if (regex.test(message)) {
      return { isValid: false, flaggedReason: `Flagged phrase detected: ${regex.source}` };
    }
  }

  return { isValid: true };
}
