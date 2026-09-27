import InboxView from '@/features/social/components/InboxView';

export default function InboxPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-app">
      <div className="px-6 py-4 border-b border-border-subtle bg-bg-card flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Social Command Center</h1>
          <p className="text-sm text-text-secondary mt-1">Manage inbound leads, AI conversations, and reputation.</p>
        </div>
      </div>
      
      {/* Inbox View Component takes the remaining height */}
      <InboxView />
    </div>
  );
}

