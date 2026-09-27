export type SocialPlatform = 'meta' | 'google_business' | 'tiktok' | 'linkedin' | 'youtube';

export type IntentCategory = 
  | 'emergency' 
  | 'hot' 
  | 'warm' 
  | 'storm' 
  | 'research' 
  | 'nurture' 
  | 'existing' 
  | 'unqualified';

export interface SocialAccount {
  id: string;
  organization_id: string;
  platform: SocialPlatform;
  platform_account_id: string;
  account_name: string;
  is_active: boolean;
  health_status: 'healthy' | 'degraded' | 'disconnected' | 'rate_limited';
  last_sync_at: string | null;
}

export interface SocialProfile {
  id: string;
  organization_id: string;
  platform: SocialPlatform;
  platform_user_id: string;
  platform_username: string | null;
  display_name: string | null;
  profile_url: string | null;
  customer_id: string | null;
  confidence_score: number;
}

export interface SocialConversation {
  id: string;
  organization_id: string;
  social_account_id: string;
  social_profile_id: string;
  lead_id: string | null;
  status: 'open' | 'snoozed' | 'resolved' | 'bot_handling';
  intent_category: IntentCategory | null;
  assigned_to: string | null;
  updated_at: string;
  created_at: string;
  
  // Joined fields for UI
  profile?: SocialProfile;
  account?: SocialAccount;
  messages?: SocialMessage[];
}

export interface SocialMessage {
  id: string;
  conversation_id: string;
  platform_message_id: string;
  direction: 'inbound' | 'outbound';
  message_type: 'text' | 'image' | 'video' | 'system';
  content: string | null;
  attachments: Record<string, unknown>[] | null;
  is_ai_generated: boolean;
  sent_at: string;
  read_at: string | null;
}
