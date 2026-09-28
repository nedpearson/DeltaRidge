const fs = require('fs');
let content = fs.readFileSync('src/features/social/components/InboxView.tsx', 'utf8');

content = content.replace('const handleSendReply = async', 
  "const handleAssign = async () => { if (!selectedConvId || !selectedConv) return; const supabase = getSupabase(); if (!supabase) return; try { const { data: leadData, error: leadErr } = await supabase.from('leads').insert({ organization_id: selectedConv.organization_id, first_name: selectedConv.profile?.display_name?.split(' ')[0] || 'Unknown', last_name: selectedConv.profile?.display_name?.split(' ').slice(1).join(' ') || 'User', lead_source: 'Social', status: 'New' }).select().single(); if (leadData) { await supabase.from('social_conversations').update({ lead_id: leadData.id }).eq('id', selectedConvId); alert('Assigned to new lead: ' + leadData.id); } } catch (err) { console.error('Assign error', err); } };\n\n  const handleBook = async () => { if (!selectedConvId || !selectedConv) return; const supabase = getSupabase(); if (!supabase) return; try { const { data: eventData, error } = await supabase.from('events').insert({ organization_id: selectedConv.organization_id, title: 'Appointment with ' + selectedConv.profile?.display_name, event_type: 'appointment', start_time: new Date(Date.now() + 86400000).toISOString(), end_time: new Date(Date.now() + 90000000).toISOString(), status: 'scheduled' }); if (!error) { alert('Appointment booked for tomorrow!'); } } catch(err) { console.error('Book error', err); } };\n\n  const handleSendReply = async"
);

content = content.replace(
  '<button className="px-3 py-1.5 text-sm font-medium border border-border-subtle rounded shadow-sm bg-bg-card hover:bg-bg-app">\n                  Assign to Rep\n                </button>',
  '<button onClick={handleAssign} className="px-3 py-1.5 text-sm font-medium border border-border-subtle rounded shadow-sm bg-bg-card hover:bg-bg-app">\n                  Assign to Rep\n                </button>'
);

content = content.replace(
  '<button className="px-3 py-1.5 text-sm font-medium bg-brand-primary text-white rounded shadow-sm hover:bg-brand-primary">\n                  Book Appointment\n                </button>',
  '<button onClick={handleBook} className="px-3 py-1.5 text-sm font-medium bg-brand-primary text-white rounded shadow-sm hover:bg-brand-primary">\n                  Book Appointment\n                </button>'
);

fs.writeFileSync('src/features/social/components/InboxView.tsx', content);
