/**
 * Official resources for every parish in the service area.
 *
 * Every URL below was opened and confirmed against the official parish,
 * assessor or state site on 2026-10-09. Where a parish has no online service,
 * the field is null and the card says so, rather than linking a look-alike
 * (sthelenaparish.org is a church in New Mexico; pcpolicejury.org now redirects
 * to a gambling site).
 *
 * Cities inside a parish may issue their own permits (Baker, Zachary, Central,
 * St. George in EBR; Gonzales; Denham Springs; Walker; Hammond…). The card
 * reminds the rep to confirm the issuer for addresses inside city limits.
 */

export interface ParishResources {
  readonly parish: string
  readonly assessor: string | null
  readonly permits: { readonly url: string; readonly issuer: string; readonly phone: string | null }
  readonly gis: string | null
  readonly note?: string
}

export const PARISHES: readonly ParishResources[] = [
  {
    parish: 'East Baton Rouge',
    assessor: 'https://eastbatonrouge.smartcama.com/Assessments/Search',
    permits: {
      url: 'https://www.brla.gov/2688/Permits-Inspections',
      issuer: 'City-Parish Permits & Inspections (MyGovernmentOnline). St. George permits through the City of St. George since Oct 16, 2024.',
      phone: '225-389-3205',
    },
    gis: 'https://city.brla.gov/gis/propertylookup.asp',
  },
  {
    parish: 'West Baton Rouge',
    assessor: 'https://www.wbrassessor.org/assessments/',
    permits: { url: 'https://www.wbrparish.org/673/Permits', issuer: 'WBR Community Planning & Development permit office (Port Allen)', phone: '225-383-4755' },
    gis: 'https://pa.totaland.com/WestBatonRouge',
  },
  {
    parish: 'Ascension',
    assessor: 'https://beacon.schneidercorp.com/Application.aspx?App=AscensionParishLA&PageType=Search',
    permits: { url: 'https://www.ascensionparish.net/departments/building/permitting', issuer: 'Ascension Parish Building Permitting — has a dedicated reroof permit application', phone: '225-450-1002' },
    gis: 'https://gis.ascensionparishla.gov/portal/apps/sites/#/ascension-parish-gis-site',
  },
  {
    parish: 'Livingston',
    assessor: 'https://livingston.smartcama.com/Assessments/Search',
    permits: { url: 'https://www.livingstonparishla.gov/building-permits', issuer: 'Livingston Parish Permit Department (MyGovernmentOnline)', phone: '225-686-3021' },
    gis: 'https://livingstonla.mapgeo.io/',
  },
  {
    parish: 'Iberville',
    assessor: 'https://iberville.smartcama.com/Assessments/Search',
    permits: { url: 'https://www.ibervilleparish.com/permits', issuer: 'Iberville Parish Permits & Inspections (Plaquemine)', phone: '225-687-5150' },
    gis: 'http://www.efsedge.com/Iberville',
  },
  {
    parish: 'East Feliciana',
    assessor: 'https://efassessor.com/SearchForm.aspx',
    permits: { url: 'https://efparish.org/inspections-and-permits/', issuer: 'East Feliciana Parish Building Department (MyGovernmentOnline)', phone: '225-683-8577' },
    gis: 'https://eastfelicianamaps.azurewebsites.net/',
    note: "The assessor site's security certificate had expired as of Oct 2026, so the browser may show a warning.",
  },
  {
    parish: 'West Feliciana',
    assessor: 'https://westfeliciana.smartcama.com/Assessments/Search',
    permits: { url: 'https://www.wfparish.org/buildings-and-permits', issuer: 'West Feliciana Permits & Inspections — roofing permit listed', phone: '225-784-3725' },
    gis: 'https://maps.smartcama.com/westfeliciana',
  },
  {
    parish: 'St. Helena',
    assessor: null,
    permits: { url: 'https://www.sthelenaparish.la.gov/apps/pages/index.jsp?uREC_ID=522389&type=d', issuer: 'St. Helena Police Jury Building Department (Greensburg) — in person', phone: '225-222-4549' },
    gis: null,
    note: 'No online assessor search or parcel map exists. Call the assessor or visit in Greensburg.',
  },
  {
    parish: 'Tangipahoa',
    assessor: 'https://search.tangiassessor.com/',
    permits: { url: 'https://tangipahoa.org/permits/', issuer: 'Tangipahoa Parish Permit Office (Hammond and Amite offices)', phone: '985-542-2117' },
    gis: 'https://tangiassessor.com/gis-mapping',
  },
  {
    parish: 'Pointe Coupee',
    assessor: 'https://pointecoupeeassessor.azurewebsites.net/searchonly',
    permits: { url: 'https://pcparish.org/apply-for-permit/', issuer: 'Pointe Coupee Parish Government permits (New Roads)', phone: '225-638-9556' },
    gis: 'https://atlas.geoportalmaps.com/ptcoupee',
  },
]

export interface StatewideResource {
  readonly name: string
  readonly url: string
  readonly why: string
}

export const STATEWIDE: readonly StatewideResource[] = [
  { name: 'Contractor license lookup (LSLBC)', url: 'https://lslbc.gov/contractor-search/', why: 'Show the homeowner your license, or check a competitor.' },
  { name: 'Louisiana building code (LSUCCC)', url: 'https://lsuccc.la/', why: '2021 IRC in force; 2024 codes from Jan 1, 2027. Reroofs are permitted and inspected to IRC Ch. 8–9.' },
  { name: 'Wind-mitigation surveyor search', url: 'https://arlspublic.lslbc.louisiana.gov/LUCCC/Search/Wind', why: 'For homeowners chasing a wind-mitigation insurance discount.' },
  { name: 'Filing a claim after a storm (LDI)', url: 'https://ldi.la.gov/consumers/insurance-type/homeowners/filing-a-claim-after-a-storm', why: 'Neutral state guidance to hand the homeowner. We document; the insurer decides.' },
  { name: 'Fortify Homes roof grant (LDI)', url: 'https://ldi.la.gov/fortifyhomes', why: 'Up to $10,000 toward a FORTIFIED roof, paid to the contractor. Registration closed as of Oct 2026 — check for new rounds.' },
  { name: 'NOAA Storm Events Database', url: 'https://www.ncei.noaa.gov/access/storm-events-database/', why: 'Official record of hail and wind reports by date and parish.' },
  { name: 'NWS New Orleans/Baton Rouge storm reports', url: 'https://forecast.weather.gov/product.php?site=LIX&issuedby=LIX&product=LSR', why: 'Latest local storm reports, usually within hours of a storm.' },
]

const ALIASES: Record<string, string> = {
  ebr: 'East Baton Rouge',
  wbr: 'West Baton Rouge',
  'st helena': 'St. Helena',
  'saint helena': 'St. Helena',
  tangi: 'Tangipahoa',
  'pt coupee': 'Pointe Coupee',
}

/** Cities that sit wholly in one parish, for addresses with no parish on file. */
const CITY_PARISH: Record<string, string> = {
  'baton rouge': 'East Baton Rouge', baker: 'East Baton Rouge', zachary: 'East Baton Rouge', central: 'East Baton Rouge',
  'st george': 'East Baton Rouge', 'greenwell springs': 'East Baton Rouge', pride: 'East Baton Rouge',
  'port allen': 'West Baton Rouge', brusly: 'West Baton Rouge', addis: 'West Baton Rouge',
  gonzales: 'Ascension', prairieville: 'Ascension', sorrento: 'Ascension', geismar: 'Ascension', 'st amant': 'Ascension', donaldsonville: 'Ascension',
  'denham springs': 'Livingston', walker: 'Livingston', watson: 'Livingston', livingston: 'Livingston', 'french settlement': 'Livingston', albany: 'Livingston', springfield: 'Livingston',
  plaquemine: 'Iberville', 'st gabriel': 'Iberville', 'white castle': 'Iberville',
  clinton: 'East Feliciana', jackson: 'East Feliciana', slaughter: 'East Feliciana',
  'st francisville': 'West Feliciana',
  greensburg: 'St. Helena',
  hammond: 'Tangipahoa', ponchatoula: 'Tangipahoa', amite: 'Tangipahoa',
  'new roads': 'Pointe Coupee',
}

function key(s: string): string {
  return s.toLowerCase().replace(/\bparish\b/g, '').replace(/[.\s]+/g, ' ').trim()
}

/** Resolves a parish from what is on file, falling back to the city. */
export function findParish(parish: string | null | undefined, city?: string | null): { resources: ParishResources; inferred: boolean } | null {
  if (parish) {
    const k = key(parish)
    const name = ALIASES[k] ?? k
    const hit = PARISHES.find((p) => key(p.parish) === key(name))
    if (hit) return { resources: hit, inferred: false }
  }
  if (city) {
    const name = CITY_PARISH[key(city)]
    const hit = name ? PARISHES.find((p) => p.parish === name) : undefined
    if (hit) return { resources: hit, inferred: true }
  }
  return null
}

/** FEMA's map viewer accepts an address query directly. */
export function femaFloodMapUrl(address: string): string {
  return `https://msc.fema.gov/portal/search?AddressQuery=${encodeURIComponent(address)}`
}
