import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { applyGuardrails } from "./guardrails.ts";

Deno.test("Guardrails allow benign messages", () => {
  const result = applyGuardrails("Property was exposed to conditions during the recent storm.");
  assertEquals(result.isValid, true);
});

Deno.test("Guardrails block physical damage claims", () => {
  const result = applyGuardrails("Your roof is damaged, we can help.");
  assertEquals(result.isValid, false);
});

Deno.test("Guardrails block insurance promises", () => {
  const result1 = applyGuardrails("Don't worry, your insurance will pay for everything.");
  assertEquals(result1.isValid, false);
  
  const result2 = applyGuardrails("We will negotiate with your adjuster.");
  assertEquals(result2.isValid, false);
  
  const result3 = applyGuardrails("We can waive your deductible entirely.");
  assertEquals(result3.isValid, false);
  
  const result4 = applyGuardrails("We'll get you a free roof!");
  assertEquals(result4.isValid, false);
});
