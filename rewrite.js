import { readFileSync, writeFileSync } from 'fs';

const file = 'src/pages/LeadPage.tsx';
let content = readFileSync(file, 'utf8');

const targetLogic = `    let found = localFound
    if (!found) {
      const { getSupabase } = await import('@/lib/supabase')
      const supa = getSupabase()
      if (supa) {
        const { data } = await supa.from('properties').select('*, leads(*)').eq('normalized_address', decodeURIComponent(leadId)).maybeSingle()
        if (data) {
          const l = data.leads?.[0]
          found = {
            id: l?.id || data.id,
            addressKey: data.normalized_address,
            address: data.address,
            latitude: data.latitude,
            longitude: data.longitude,
            status: l?.status || 'new',
            reasons: l?.reasons || [],
            score: l?.score || 0,
            createdAt: l?.created_at || new Date().toISOString(),
            updatedAt: l?.updated_at || new Date().toISOString(),
            knockCount: l?.knock_count || 0
          } as ManagedLead
        }
      }
    }`;

const newLogic = `    let found = localFound
    if (!found) {
      const { getSupabase } = await import('@/lib/supabase')
      const supa = getSupabase()
      if (supa) {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId);
        if (isUUID) {
          let { data: leadData } = await supa.from('leads').select('*, properties(*)').eq('id', leadId).maybeSingle();
          if (leadData && leadData.properties) {
            found = {
              id: leadData.id,
              addressKey: leadData.properties.normalized_address,
              address: leadData.properties.address_line1,
              latitude: leadData.properties.latitude,
              longitude: leadData.properties.longitude,
              status: leadData.status || 'new',
              reasons: leadData.reasons || [],
              score: leadData.score || 0,
              createdAt: leadData.created_at || new Date().toISOString(),
              updatedAt: leadData.updated_at || new Date().toISOString(),
              knockCount: leadData.knock_count || 0
            } as ManagedLead;
          } else {
            let { data: pData } = await supa.from('properties').select('*, leads(*)').eq('id', leadId).maybeSingle();
            if (pData) {
              const l = pData.leads?.[0];
              found = {
                id: l?.id || pData.id,
                addressKey: pData.normalized_address,
                address: pData.address_line1,
                latitude: pData.latitude,
                longitude: pData.longitude,
                status: l?.status || 'new',
                reasons: l?.reasons || [],
                score: l?.score || 0,
                createdAt: l?.created_at || new Date().toISOString(),
                updatedAt: l?.updated_at || new Date().toISOString(),
                knockCount: l?.knock_count || 0
              } as ManagedLead;
            }
          }
        } else {
          // Fallback backward compatibility redirect
          const { data } = await supa.from('properties').select('*, leads(*)').eq('normalized_address', decodeURIComponent(leadId)).maybeSingle();
          if (data) {
            const canonicalId = data.leads?.[0]?.id || data.id;
            navigate(\`/leads/\${canonicalId}\`, { replace: true });
            return;
          }
        }
      }
    }`;

content = content.replace(targetLogic, newLogic);
writeFileSync(file, content);
