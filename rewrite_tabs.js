import { readFileSync, writeFileSync } from 'fs';

const file = 'src/pages/LeadPage.tsx';
let content = readFileSync(file, 'utf8');

// Change TabID
const oldTabID = `type TabID = 'overview' | 'homeowner_contact' | 'property' | 'permits_roof_age' | 'storm_history' | 'communications' | 'visits' | 'appointments' | 'inspections' | 'eagleview' | 'estimate' | 'proposal' | 'insurance' | 'documents' | 'ai_intelligence' | 'audit'

const TABS: { id: TabID, label: string }[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'homeowner_contact', label: 'HOMEOWNER / CONTACT' },
  { id: 'property', label: 'PROPERTY' },
  { id: 'permits_roof_age', label: 'PERMITS / ROOF AGE' },
  { id: 'storm_history', label: 'STORM HISTORY' },
  { id: 'communications', label: 'COMMUNICATIONS' },
  { id: 'visits', label: 'VISITS' },
  { id: 'appointments', label: 'APPOINTMENTS' },
  { id: 'inspections', label: 'INSPECTIONS' },
  { id: 'eagleview', label: 'EAGLEVIEW' },
  { id: 'estimate', label: 'ESTIMATE' },
  { id: 'proposal', label: 'PROPOSAL' },
  { id: 'insurance', label: 'INSURANCE' },
  { id: 'documents', label: 'DOCUMENTS' },
  { id: 'ai_intelligence', label: 'AI INTELLIGENCE' },
  { id: 'audit', label: 'AUDIT' },
]`;

const newTabID = `type PrimaryTabID = 'overview' | 'contact' | 'property' | 'storm' | 'activity' | 'sales' | 'more';
type SubTabID = 'overview' | 'homeowner_contact' | 'property' | 'permits_roof_age' | 'storm_history' | 'communications' | 'visits' | 'appointments' | 'inspections' | 'eagleview' | 'estimate' | 'proposal' | 'insurance' | 'documents' | 'ai_intelligence' | 'audit';

const PRIMARY_TABS: { id: PrimaryTabID, label: string }[] = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'contact', label: 'CONTACT' },
  { id: 'property', label: 'PROPERTY' },
  { id: 'storm', label: 'STORM' },
  { id: 'activity', label: 'ACTIVITY' },
  { id: 'sales', label: 'SALES' },
  { id: 'more', label: 'MORE' }
];

const SUB_TABS: Record<PrimaryTabID, { id: SubTabID, label: string }[]> = {
  overview: [],
  contact: [{ id: 'homeowner_contact', label: 'Homeowner' }, { id: 'communications', label: 'Communications' }],
  property: [{ id: 'property', label: 'Details' }, { id: 'permits_roof_age', label: 'Permits & Roof Age' }],
  storm: [{ id: 'storm_history', label: 'Storm History' }],
  activity: [{ id: 'visits', label: 'Visits' }, { id: 'audit', label: 'Audit Log' }],
  sales: [
    { id: 'appointments', label: 'Appointments' },
    { id: 'inspections', label: 'Inspections' },
    { id: 'eagleview', label: 'EagleView' },
    { id: 'estimate', label: 'Estimate' },
    { id: 'proposal', label: 'Proposal' }
  ],
  more: [
    { id: 'insurance', label: 'Insurance' },
    { id: 'documents', label: 'Documents' },
    { id: 'ai_intelligence', label: 'AI Intelligence' }
  ]
};`;

content = content.replace(oldTabID, newTabID);

// Update useState
content = content.replace(
  `const [activeTab, setActiveTab] = useState<TabID>('overview')`,
  `const [activePrimaryTab, setActivePrimaryTab] = useState<PrimaryTabID>('overview')
  const [activeSubTab, setActiveSubTab] = useState<SubTabID>('overview')`
);

// We need to fix the Tab UI
const oldTabUI = `        {/* Tab Navigation */}
        <div className="bg-bg-elevated border-b border-border-subtle sticky top-0 z-10 px-3 sm:px-4">
          <div className="flex overflow-x-auto scrollbar-none gap-6">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={\`whitespace-nowrap py-3 text-[11px] font-bold tracking-wider transition-colors border-b-2 \${
                  activeTab === tab.id
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-strong'
                }\`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>`;

const newTabUI = `        {/* Primary Tab Navigation */}
        <div className="bg-bg-elevated border-b border-border-subtle sticky top-0 z-10 px-3 sm:px-4">
          <div className="flex overflow-x-auto scrollbar-none gap-6">
            {PRIMARY_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActivePrimaryTab(tab.id);
                  const subtabs = SUB_TABS[tab.id];
                  if (subtabs.length > 0) {
                    setActiveSubTab(subtabs[0].id);
                  } else {
                    setActiveSubTab('overview');
                  }
                }}
                className={\`whitespace-nowrap py-3 text-[11px] font-bold tracking-wider transition-colors border-b-2 \${
                  activePrimaryTab === tab.id
                    ? 'border-brand-primary text-brand-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-strong'
                }\`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Secondary Tab Navigation */}
        {SUB_TABS[activePrimaryTab].length > 0 && (
          <div className="bg-bg-base border-b border-border-subtle px-3 sm:px-4">
            <div className="flex overflow-x-auto scrollbar-none gap-4">
              {SUB_TABS[activePrimaryTab].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveSubTab(tab.id)}
                  className={\`whitespace-nowrap py-2 text-[12px] font-semibold transition-colors \${
                    activeSubTab === tab.id
                      ? 'text-brand-primary'
                      : 'text-text-secondary hover:text-text-primary'
                  }\`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}`;

content = content.replace(oldTabUI, newTabUI);

// Update the render blocks to check activeSubTab instead of activeTab
content = content.replaceAll(`activeTab === '`, `activeSubTab === '`);
// Wait, the primary overview doesn't have a subtab array really. If activePrimaryTab is overview, activeSubTab is 'overview'.
// We just check activeSubTab everywhere.

writeFileSync(file, content);
