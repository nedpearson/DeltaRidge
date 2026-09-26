import type { StormEvent, StormEvidenceTier } from '@/integrations/storm/types'

export function determineStormTier(storm: StormEvent | null, miles: number): StormEvidenceTier {
  if (!storm) return 'NO_EVIDENCE'
  if (miles > 5) return 'POSSIBLE_EXPOSURE'
  
  if ((storm.observation ?? 'official_report') === 'official_report') {
    // If we have an official report and it's large, it's strong.
    // Ideally we check if radar corroborated it, but for now:
    if ((storm.hailSizeInches ?? 0) >= 1.75) return 'MULTI_SOURCE_STRONG'
    return 'OFFICIAL_REPORT'
  }
  
  return storm.radarConfidence === 'corroborated' ? 'MULTI_SOURCE_STRONG' : 'RADAR_ONLY'
}
