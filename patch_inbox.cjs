const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/features/social/components/InboxView.tsx';
let content = fs.readFileSync(path, 'utf8');

const regexAssign = /const handleAssign = async \(\) => \{[\s\S]*?catch \(err\) \{ \r?\n?console\.error\('Assign error', err\); \} \};/m;
const replacementAssign = `const handleAssign = async () => {
    if (!selectedConvId) return;
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const { data, error } = await supabase.functions.invoke('assign-social-lead', {
        body: { conversation_id: selectedConvId }
      });
      if (error) throw error;
      console.log('Assigned to new lead: ' + data.id);
    } catch (err) {
      console.error('Assign error', err);
    }
  };`;
content = content.replace(regexAssign, replacementAssign);

const regexBook = /const handleBook = async \(\) => \{[\s\S]*?catch\(err\) \{ \r?\n?console\.error\('Book error', err\); \} \};/m;
const replacementBook = `const handleBook = async () => {
    if (!selectedConvId || !selectedConv) return;
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const { error } = await supabase.functions.invoke('auto-book-appointment', {
        body: { conversation_id: selectedConvId, date: new Date(Date.now() + 86400000).toISOString() }
      });
      if (error) throw error;
      console.log('Appointment booked for tomorrow!');
    } catch(err) {
      console.error('Book error', err);
    }
  };`;
content = content.replace(regexBook, replacementBook);

// Manually replace handleSendReply
const sendStart = content.indexOf("const handleSendReply = async () => {");
if (sendStart !== -1) {
  const sendEnd = content.indexOf("};", sendStart) + 2;
  const originalSend = content.substring(sendStart, sendEnd);
  
  const replacementSend = `const handleSendReply = async () => {
    if (!selectedConvId || !replyText.trim()) return;
    const supabase = getSupabase();
    if (!supabase) return;
    try {
      const { error } = await supabase.functions.invoke('send-social-message', {
        body: { conversation_id: selectedConvId, content: replyText }
      });
      if (error) throw error;
      setReplyText('');
    } catch (err) {
      console.error('Send error', err);
    }
  };`;
  content = content.substring(0, sendStart) + replacementSend + content.substring(sendEnd);
}

fs.writeFileSync(path, content);
console.log('Patched InboxView.tsx');
