/* eslint-disable no-console */
/**
 * Opt-in integration check against the REAL parish and NWS services.
 * Excluded from the default run (see vite.config.ts) because a third party
 * being slow must never look like our bug. Run it by hand when an upstream
 * feed changes shape:
 *
 *   npx vitest run tests/live --exclude ''
 *
 * It prints the list rather than only asserting, because the useful output
 * is whether the doors look real to someone who knows Baton Rouge.
 */
import { describe, expect, it } from 'vitest'
import { runLeadEngine, DEFAULT_SETTINGS } from '@/features/leads/engine'

describe('live lead engine', () => {
  it('produces a ranked door list from real public data', async () => {
    const run = await runLeadEngine({ ...DEFAULT_SETTINGS, stormMonths: 36, radiusMiles: 3, minHailInches: 1 })
    console.log('\n=== RUN =================================')
    console.log('storms:', run.counts.stormsConsidered,
                '| candidate roofs:', run.counts.candidatesConsidered,
                '| reroof permits:', run.counts.reroofPermits)
    console.log('suppressed — already replaced:', run.counts.suppressedAlreadyReplaced,
                '| roof too new:', run.counts.suppressedRoofTooNew,
                '| no hail:', run.counts.suppressedNoHail)
    console.log('notes:', run.notes)
    console.log('\n=== TOP 12 DOORS ========================')
    for (const l of run.leads.slice(0, 12)) {
      console.log(`${String(l.score).padStart(3)}  ${l.address.slice(0, 40).padEnd(40)} ${l.components.hailSizeInches}" @ ${l.components.distanceMiles}mi  roof ${l.components.roofAgeYears}y`)
      console.log(`     ${l.reasons[1]}`)
    }
    console.log('\n=== COMPETITORS =========================')
    for (const c of run.competitors.slice(0, 8)) {
      console.log(`${String(c.permits).padStart(4)}  ${c.contractorName.slice(0, 44)}`)
    }
    expect(run.counts.stormsConsidered).toBeGreaterThan(0)
  }, 180000)
})
