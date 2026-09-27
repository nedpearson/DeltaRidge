import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { MessageSquare, User, Bot } from 'lucide-react';
import type { SocialConversation, SocialMessage } from '../types';

export default function InboxView() {
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  // Fetch open conversations
  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ['social_conversations'],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('social_conversations')
        .select(`
          *,
          profile:social_profiles(*),
          account:social_accounts(*)
        `)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data as SocialConversation[];
    }
  });

  // Fetch messages for selected conversation
  const { data: messages = [] } = useQuery({
    queryKey: ['social_messages', selectedConvId],
    queryFn: async () => {
      if (!selectedConvId) return [];
      const supabase = getSupabase();
      if (!supabase) throw new Error('Supabase not configured');
      const { data, error } = await supabase
        .from('social_messages')
        .select('*')
        .eq('conversation_id', selectedConvId)
        .order('sent_at', { ascending: true });

      if (error) throw error;
      return data as SocialMessage[];
    },
    enabled: !!selectedConvId
  });

  const selectedConv = conversations.find(c => c.id === selectedConvId);

  const handleSendReply = async () => {
    if (!selectedConvId || !selectedConv || !replyText.trim()) return;
    
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      // 1. Insert message
      await supabase.from('social_messages').insert({
        organization_id: selectedConv.organization_id,
        conversation_id: selectedConvId,
        platform_message_id: `man_${crypto.randomUUID()}`,
        direction: 'outbound',
        message_type: 'text',
        content: replyText,
        is_ai_generated: false,
        sent_at: new Date().toISOString()
      });

      // 2. Clear input
      setReplyText('');

      // Note: A robust system would also dispatch this to the Meta API via an Edge Function
      // For Phase 2, we just persist it locally as if sent.

    } catch (err) {
      console.error('Failed to send reply:', err);
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)] bg-white overflow-hidden">
      {/* Left List */}
      <div className="w-1/3 border-r border-border flex flex-col bg-surface-50">
        <div className="p-4 border-b border-border bg-white flex justify-between items-center">
          <h2 className="text-lg font-medium text-text">Unified Inbox</h2>
          <span className="bg-brand-50 text-brand-600 text-xs font-medium px-2 py-1 rounded-full">
            {conversations.length} Active
          </span>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-text-secondary text-sm">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">
              <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p>No active conversations</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {conversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConvId(conv.id)}
                  className={`w-full text-left p-4 hover:bg-white transition-colors ${
                    selectedConvId === conv.id ? 'bg-white border-l-2 border-brand-500' : 'border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium text-text truncate">
                      {conv.profile?.display_name || 'Unknown User'}
                    </span>
                    <span className="text-xs text-text-secondary whitespace-nowrap ml-2">
                      {new Date(conv.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center text-xs text-text-secondary gap-2">
                    <span className="capitalize px-1.5 py-0.5 bg-surface-100 rounded">
                      {conv.account?.platform || 'Social'}
                    </span>
                    {conv.intent_category && (
                      <span className={`capitalize px-1.5 py-0.5 rounded ${
                        conv.intent_category === 'hot' || conv.intent_category === 'emergency' 
                          ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                      }`}>
                        {conv.intent_category}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Detail Pane */}
      <div className="flex-1 flex flex-col bg-surface-50">
        {selectedConv ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-border bg-white flex justify-between items-center shadow-sm z-10">
              <div>
                <h3 className="font-medium text-text">{selectedConv.profile?.display_name}</h3>
                <p className="text-xs text-text-secondary">
                  Via {selectedConv.account?.platform} • {selectedConv.account?.account_name}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="px-3 py-1.5 text-sm font-medium border border-border rounded shadow-sm bg-white hover:bg-surface-50">
                  Assign to Rep
                </button>
                <button className="px-3 py-1.5 text-sm font-medium bg-brand-600 text-white rounded shadow-sm hover:bg-brand-700">
                  Book Appointment
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map(msg => {
                const isOutbound = msg.direction === 'outbound';
                return (
                  <div key={msg.id} className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}>
                    <div className="flex items-center gap-1 mb-1 text-[10px] text-text-secondary">
                      {isOutbound ? (
                        <>
                          {msg.is_ai_generated ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                          {msg.is_ai_generated ? 'AI Assistant' : 'Delta Ridge'}
                        </>
                      ) : (
                        <>
                          <User className="w-3 h-3" />
                          {selectedConv.profile?.display_name}
                        </>
                      )}
                      <span className="mx-1"> </span>
                      {new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className={`max-w-[75%] p-3 rounded-lg text-sm ${
                      isOutbound 
                        ? 'bg-brand-600 text-white rounded-tr-none' 
                        : 'bg-white border border-border text-text rounded-tl-none'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reply Box */}
            <div className="p-4 bg-white border-t border-border">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendReply()}
                  placeholder="Type a manual reply to take over from AI..." 
                  className="flex-1 px-3 py-2 border border-border rounded focus:outline-none focus:border-brand-500 text-sm"
                />
                <button 
                  onClick={handleSendReply}
                  disabled={!replyText.trim()}
                  className="px-4 py-2 bg-brand-600 text-white rounded font-medium text-sm hover:bg-brand-700 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-text-secondary opacity-50">
            <MessageSquare className="w-12 h-12 mb-4" />
            <p>Select a conversation to view</p>
          </div>
        )}
      </div>
    </div>
  );
}
