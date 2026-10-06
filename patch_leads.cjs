const fs = require('fs');
let code = fs.readFileSync('src/pages/LeadsPage.tsx', 'utf8');

// Fix filter chip contrast
code = code.replace("bg-text-primary text-bg-base", "bg-brand-primary text-white shadow-sm");
code = code.replace("bg-bg-elevated text-text-secondary hover:bg-border-subtle", "bg-bg-elevated text-text-secondary hover:bg-border-subtle hover:text-text-primary");

// Fix distance unavailable reason
code = code.replace(
  '<span className="text-text-muted italic">Distance unavailable</span>',
  `{status === 'REQUESTING_PERMISSION' ? <span className="text-text-muted italic">Locating...</span> : <span className="text-text-muted italic">Distance unavailable &middot; {status === 'PERMISSION_DENIED' ? 'Location permission denied' : status === 'TIMEOUT' ? 'GPS timed out' : status === 'POSITION_UNAVAILABLE' ? 'GPS unavailable' : !p.lat || !p.lng ? 'Property coordinates missing' : 'Location unknown'}</span>}`
);

// Fix Phone and Email not found reasons
code = code.replace(
  '{p.primary_phone ? p.primary_phone : <span className="text-text-muted italic">Phone not found</span>}',
  '{p.primary_phone ? p.primary_phone : <span className="text-text-muted italic">Phone {p.phone_status ? p.phone_status.toLowerCase().replace(/_/g, " ") : "not checked"}</span>}'
);
code = code.replace(
  '{p.primary_email ? p.primary_email : <span className="text-text-muted italic">Email not found</span>}',
  '{p.primary_email ? p.primary_email : <span className="text-text-muted italic">Email {p.email_status ? p.email_status.toLowerCase().replace(/_/g, " ") : "not checked"}</span>}'
);

// Don't show redundant badge if we already show the status text
code = code.replace(
  '{p.phone_status && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.phone_status}</span>}',
  '{p.phone_status && p.phone_status !== "NOT_FOUND" && p.phone_status !== "NOT_CHECKED" && p.phone_status !== "PROVIDER_NOT_CONFIGURED" && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.phone_status}</span>}'
);
code = code.replace(
  '{p.email_status && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.email_status}</span>}',
  '{p.email_status && p.email_status !== "NOT_FOUND" && p.email_status !== "NOT_CHECKED" && p.email_status !== "PROVIDER_NOT_CONFIGURED" && <span className="text-[10px] uppercase font-bold text-brand-primary/70 bg-brand-primary/10 px-1.5 py-0.5 rounded">{p.email_status}</span>}'
);

fs.writeFileSync('src/pages/LeadsPage.tsx', code);
