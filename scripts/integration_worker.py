"""Decode NOAA MRMS grids and deliver opted-in Web Push alerts. No secrets are logged."""
import argparse
import gzip
import json
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

MRMS_BASE = 'https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/'


def request_json(url, key, method='GET', body=None, prefer=None):
    headers = {'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json'}
    if prefer:
        headers['Prefer'] = prefer
    request = Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
    with urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


class Backend:
    def __init__(self):
        self.url = os.environ['SUPABASE_URL'].rstrip('/')
        self.key = os.environ['SUPABASE_SERVICE_ROLE_KEY']

    def rest(self, table, query=None, method='GET', body=None, prefer=None):
        return request_json(self.url + '/rest/v1/' + table + ('?' + urlencode(query) if query else ''), self.key, method, body, prefer)

    def record(self, org, integration, status, detail):
        self.rest('integration_runs', method='POST', body={'organization_id': org, 'integration': integration, 'status': status, 'detail': detail[:200]})


def latest_file(index):
    matches = re.findall(r'href="(MRMS_MESH_Max_1440min_00\.50_(\d{8}-\d{6})\.grib2\.gz)"', index)
    if not matches:
        raise ValueError('NOAA returned no MRMS files')
    filename, stamp = max(matches, key=lambda item: item[1])
    observed = datetime.strptime(stamp, '%Y%m%d-%H%M%S').replace(tzinfo=timezone.utc)
    if abs((datetime.now(timezone.utc)-observed).total_seconds()) > 7200:
        raise ValueError('Latest NOAA MRMS grid is more than two hours old')
    return filename, observed


def crop_grid(lats, lons, values, bounds, missing_value=9999):
    import numpy as np
    west, south, east, north = bounds
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90 and east-west <= 5 and north-south <= 5):
        raise ValueError('MRMS bounds must cover a territory no larger than five degrees per side')
    lats, lons, values = np.asarray(lats), np.asarray(lons), np.asarray(values)
    lons = ((lons + 180) % 360) - 180
    if lats.shape != lons.shape or lats.shape != values.shape:
        raise ValueError('MRMS coordinate and data shapes do not match')
    in_area = (lats >= south) & (lats <= north) & (lons >= west) & (lons <= east)
    valid = in_area & np.isfinite(values) & (values >= 0) & (values <= 250) & (values != missing_value)
    valid_count = int(valid.sum())
    if not int(in_area.sum()):
        raise ValueError('MRMS grid does not cover this territory')
    missing_count = int(in_area.sum()) - valid_count
    # Store all nonzero cells, in inches. Zeros are accounted for by valid_cell_count.
    selected = valid & (values > 0)
    cells = [[round(float(lon), 4), round(float(lat), 4), round(float(mm)/25.4, 3)]
             for lon, lat, mm in zip(lons[selected], lats[selected], values[selected])]
    if len(cells) > 300000:
        raise ValueError('MRMS territory is too large to import safely')
    return cells, valid_count, missing_count


def decode_grid(compressed, bounds):
    from eccodes import codes_grib_new_from_file, codes_get_array, codes_get, codes_release
    with tempfile.TemporaryFile() as stream:
        raw = gzip.decompress(compressed)
        if not raw.startswith(b'GRIB') or len(raw) > 100_000_000:
            raise ValueError('NOAA response is not a supported GRIB grid')
        stream.write(raw)
        stream.seek(0)
        handle = codes_grib_new_from_file(stream)
        if handle is None:
            raise ValueError('Could not decode the MRMS grid')
        try:
            return crop_grid(codes_get_array(handle, 'latitudes'), codes_get_array(handle, 'longitudes'),
                             codes_get_array(handle, 'values'), bounds, codes_get(handle, 'missingValue'))
        finally:
            codes_release(handle)


def ingest_mrms(db):
    orgs = db.rest('organizations', {'select': 'id'})
    try:
        with urlopen(MRMS_BASE, timeout=30) as response:
            filename, observed = latest_file(response.read(2_000_000).decode())
        if db.rest('mrms_grids', {'id': 'eq.' + filename, 'select': 'id'}):
            print('MRMS: current grid already imported')
            return
        with urlopen(MRMS_BASE + filename, timeout=60) as response:
            compressed = response.read(20_000_001)
        if len(compressed) > 20_000_000:
            raise ValueError('MRMS download exceeds the safe size limit')
        bounds = json.loads(os.getenv('MRMS_BOUNDS', '[-91.7,29.9,-90.5,31.1]'))
        cells, valid_count, missing_count = decode_grid(compressed, bounds)
        db.rest('mrms_grids', method='POST', body={'id': filename, 'observed_at': observed.isoformat(), 'bounds': bounds,
                'cells': cells, 'valid_cell_count': valid_count, 'missing_cell_count': missing_count, 'source_url': MRMS_BASE+filename}, prefer='resolution=merge-duplicates')
        for org in orgs:
            db.record(org['id'], 'mrms', 'success', f'Grid imported: {valid_count} valid cells; {missing_count} cells have missing radar data; {len(cells)} contain estimated hail.')
        db.rest('mrms_grids', {'observed_at': 'lt.'+(datetime.now(timezone.utc)-timedelta(days=7)).isoformat()}, method='DELETE')
        print(f'MRMS: imported {valid_count} valid cells')
    except Exception:
        for org in orgs:
            db.record(org['id'], 'mrms', 'failed', 'Grid download, decoding or database import failed. Check the integration worker run.')
        raise RuntimeError('MRMS import failed; no success was recorded') from None


def safe_push_endpoint(endpoint):
    parsed = urlparse(endpoint)
    host = parsed.hostname or ''
    return parsed.scheme == 'https' and parsed.port in (None,443) and parsed.username is None and (host in {'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns.windows.com'} or host.endswith('.wns.windows.com'))


def deliver_push(db):
    from pywebpush import webpush, WebPushException
    subscriptions = db.rest('push_subscriptions', {'active': 'eq.true', 'select': '*'})
    private_key, subject = os.getenv('VAPID_PRIVATE_KEY'), os.getenv('VAPID_SUBJECT')
    if not private_key or not subject:
        for org in {s['organization_id'] for s in subscriptions}:
            db.record(org, 'push', 'not_configured', 'Add the server VAPID key pair and contact address.')
        raise RuntimeError('Push server keys are missing')
    since = (datetime.now(timezone.utc)-timedelta(hours=24)).isoformat()
    sent = 0
    for subscription in subscriptions:
        org = subscription['organization_id']
        member = db.rest('organization_members', {'organization_id': 'eq.'+org, 'user_id': 'eq.'+subscription['user_id'], 'is_active': 'eq.true', 'select': 'user_id', 'limit': '1'})
        if not member or not safe_push_endpoint(subscription['endpoint']):
            db.rest('push_subscriptions', {'id':'eq.'+subscription['id']}, method='PATCH', body={'active':False})
            continue
        notifications = db.rest('notifications', {'organization_id': 'eq.'+org, 'or': '(user_id.is.null,user_id.eq.'+subscription['user_id']+')',
            'created_at': 'gte.'+max(since, subscription['created_at']), 'read_at': 'is.null', 'resolved_at': 'is.null', 'order': 'created_at.asc', 'limit': '100'})
        for notification in notifications:
            if notification.get('snoozed_until') and datetime.fromisoformat(notification['snoozed_until'].replace('Z','+00:00')) > datetime.now(timezone.utc):
                continue
            receipt = {'notification_id': notification['id'], 'subscription_id': subscription['id'], 'status': 'sending'}
            claimed = db.rest('push_deliveries', method='POST', body=receipt, prefer='resolution=ignore-duplicates,return=representation')
            if not claimed:
                continue
            where = {'notification_id':'eq.'+notification['id'],'subscription_id':'eq.'+subscription['id']}
            try:
                webpush(subscription_info={'endpoint':subscription['endpoint'], 'keys':{'p256dh':subscription['p256dh'],'auth':subscription['auth_key']}},
                    data=json.dumps({'id':notification['id'],'title':notification['title'],'body':notification['body'],'url':notification.get('link_url') or '/'}),
                    vapid_private_key=private_key, vapid_claims={'sub':subject}, ttl=3600, timeout=15)
                db.rest('push_deliveries',where,method='PATCH',body={'status':'delivered'})
                db.record(org,'push','success','Push service accepted a device alert. Device display depends on browser settings.')
                sent += 1
            except WebPushException as error:
                status_code = error.response.status_code if error.response is not None else None
                if status_code in (404,410):
                    db.rest('push_subscriptions',{'id':'eq.'+subscription['id']},method='PATCH',body={'active':False})
                db.rest('push_deliveries',where,method='PATCH',body={'status':'failed' if status_code else 'unknown'})
                db.record(org,'push','failed','Push service refused an alert or did not confirm delivery. Re-enable device alerts if the subscription expired.')
            except Exception:
                db.rest('push_deliveries',where,method='PATCH',body={'status':'unknown'})
                db.record(org,'push','failed','Push delivery was not confirmed. It was not resent to avoid duplicate alerts.')
    print(f'Push: {sent} alerts accepted by push services')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mrms',action='store_true')
    parser.add_argument('--push',action='store_true')
    args = parser.parse_args()
    if not args.mrms and not args.push:
        parser.error('Select --mrms or --push')
    backend = Backend()
    if args.mrms:
        ingest_mrms(backend)
    if args.push:
        deliver_push(backend)
