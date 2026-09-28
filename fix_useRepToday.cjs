const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/features/dashboard/useRepToday.ts';
let content = fs.readFileSync(path, 'utf8');

const regex = /const \{ data: appts \} = await supabase[\s\S]*?\}\n      \}/m;

const replacement = `const { data: appts } = await supabase
        .from('appointments')
        .select('id, scheduled_start, lead_id, status, leads(address)')
        .eq('assigned_to', user.id)
        .gte('scheduled_start', nowIso)
        .not('status', 'in', '("cancelled","completed","no_show")')
        .order('scheduled_start', { ascending: true })
        .limit(1)

      let nextAppointment: RepTodayData['nextAppointment'] = null
      if (appts && appts.length > 0 && appts[0]) {
        const appt = appts[0]
        const appointmentTime = (appt as any).scheduled_start
        const leadJoin = appt.leads as any
        const leadAddress = Array.isArray(leadJoin) && leadJoin[0]
          ? (leadJoin[0] as any).address as string
          : typeof leadJoin === 'object' && leadJoin !== null
            ? (leadJoin as any).address as string
            : 'Address unavailable'
        
        nextAppointment = {
          time: new Date(appointmentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          address: leadAddress || 'Address unavailable',
          confirmed: appt.status === 'confirmed',
          leadId: appt.lead_id
        }
      }`;

content = content.replace(regex, replacement);
fs.writeFileSync(path, content);
console.log('Fixed useRepToday.ts');
