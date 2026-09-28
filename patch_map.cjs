const fs = require('fs');
const path = 'c:/dev/github/business/DeltaRidge/src/components/LeadMapLive.tsx';
let content = fs.readFileSync(path, 'utf8');

const regexMapStyle = /<TileLayer[\s\S]*?\/>/;
const replacementMapStyle = `<TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors - Street view only.'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        {mapStyle === 'satellite' && (
           <div className="absolute inset-0 z-[400] flex items-center justify-center bg-bg-app/80 backdrop-blur-sm">
              <div className="bg-bg-elevated p-4 rounded-lg border border-status-warning/30 text-center shadow-xl">
                 <p className="text-[13px] font-bold text-status-warning mb-1">EagleView Imagery Unavailable</p>
                 <p className="text-[11px] text-text-secondary">Delta Ridge is strictly entitled for EagleView aerial imagery.</p>
                 <p className="text-[11px] text-text-secondary mt-1">Provider configuration required.</p>
              </div>
           </div>
        )}`;

content = content.replace(regexMapStyle, replacementMapStyle);
fs.writeFileSync(path, content);
console.log('Patched LeadMapLive');
