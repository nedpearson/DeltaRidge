import { describe, expect, it } from 'vitest'
import { dataHealthIssues, type DataHealthEvidence } from '@/features/leads/data-health'

const BASE: DataHealthEvidence = {
  localContactName: 'Jane Smith',
  recordedOwnerName: 'Jane Smith',
  confirmedPhones: ['2255550101'],
  candidatePhones: [],
  wrongOrDisconnectedPhones: 0,
  doNotContactPhones: 0,
  localOptedOut: false,
  permitRoofAgeYears: 14,
  homeownerStatedRoofAgeYears: 15,
  stormEvidenceCount: 1,
  imageryCapturedAt: '2026-09-01T00:00:00.000Z',
  roofrJobId: null,
  roofrLastEventAt: null,
  pendingSyncItems: 0,
  failedSyncItems: 0,
  now: '2026-09-24T17:00:00.000Z',
}

describe('Lead 360 data health', () => {
  it('does not invent a conflict when sources agree', () => {
    expect(dataHealthIssues(BASE)).toEqual([])
  })

  it('surfaces owner disagreement without choosing a winner', () => {
    const issues = dataHealthIssues({
      ...BASE,
      localContactName: 'Robert Jones',
      recordedOwnerName: 'Jane Smith',
    })
    expect(issues.some((issue) => issue.key === 'owner-name-conflict')).toBe(true)
    expect(issues.find((issue) => issue.key === 'owner-name-conflict')?.target).toBe('contact')
  })

  it('does not call ordinary family-name overlap a contradiction', () => {
    const issues = dataHealthIssues({
      ...BASE,
      localContactName: 'Jane Smith',
      recordedOwnerName: 'JOHN & JANE SMITH',
    })
    expect(issues.some((issue) => issue.key === 'owner-name-conflict')).toBe(false)
  })

  it('makes a suppression a blocker and sorts it first', () => {
    const issues = dataHealthIssues({
      ...BASE,
      localOptedOut: true,
      candidatePhones: ['2255550102'],
      confirmedPhones: [],
    })
    expect(issues[0]?.key).toBe('contact-suppression')
    expect(issues[0]?.severity).toBe('blocker')
  })

  it('surfaces a material roof-age disagreement', () => {
    const issues = dataHealthIssues({
      ...BASE,
      permitRoofAgeYears: 8,
      homeownerStatedRoofAgeYears: 18,
    })
    expect(issues.some((issue) => issue.key === 'roof-age-conflict')).toBe(true)
  })

  it('does not call a small roof-age difference a conflict', () => {
    const issues = dataHealthIssues({
      ...BASE,
      permitRoofAgeYears: 12,
      homeownerStatedRoofAgeYears: 15,
    })
    expect(issues.some((issue) => issue.key === 'roof-age-conflict')).toBe(false)
  })

  it('treats stalled sync as a blocker rather than a healthy record', () => {
    const issues = dataHealthIssues({
      ...BASE,
      failedSyncItems: 2,
    })
    const sync = issues.find((issue) => issue.key === 'sync-failed')
    expect(sync?.severity).toBe('blocker')
    expect(sync?.target).toBe('sync')
  })

  it('states missing imagery as a limitation, not current condition', () => {
    const issues = dataHealthIssues({
      ...BASE,
      imageryCapturedAt: null,
    })
    expect(issues.some((issue) => issue.key === 'imagery-gap')).toBe(true)
  })
})
