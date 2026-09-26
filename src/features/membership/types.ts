export type MembershipTier = 'standard' | 'premium' | 'elite'
export type MembershipStatus = 'active' | 'past_due' | 'canceled' | 'pending'
export type MembershipBillingInterval = 'monthly' | 'annual'

export interface RoofcareMembership {
  id: string
  organization_id: string
  customer_id: string
  property_id: string
  
  tier: MembershipTier
  status: MembershipStatus
  billing_interval: MembershipBillingInterval
  
  locked_price: number
  
  started_at: string | null
  renews_at: string | null
  canceled_at: string | null
  
  notes: string | null
  
  created_at: string
  updated_at: string
  created_by: string | null
}

export type RoofcareServiceType = 'annual_inspection' | 'post_storm_priority' | 'gutter_cleaning' | 'minor_repair'
export type RoofcareServiceStatus = 'scheduled' | 'completed' | 'canceled'

export interface RoofcareService {
  id: string
  organization_id: string
  membership_id: string
  
  service_type: RoofcareServiceType
  status: RoofcareServiceStatus
  
  scheduled_for: string
  completed_at: string | null
  
  inspection_id: string | null
  notes: string | null
  
  created_at: string
  updated_at: string
  assigned_to: string | null
}
