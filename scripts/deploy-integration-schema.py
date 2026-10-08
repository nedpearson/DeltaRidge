"""Apply only the integration operations migration through Supabase Management API."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

project = os.environ['SUPABASE_PROJECT_REF']
token = os.environ['SUPABASE_ACCESS_TOKEN']
path = Path(__file__).resolve().parent.parent / 'supabase/migrations/20261008010000_integration_operations.sql'
sql = path.read_text()
# Keep CLI migration history consistent without applying unrelated pending migrations.
tracking = """
do $$ begin
 if to_regclass('supabase_migrations.schema_migrations') is not null then
  insert into supabase_migrations.schema_migrations(version,name,statements)
  values ('20261008010000','integration_operations',array[]::text[]) on conflict(version) do nothing;
 end if;
end $$;
"""
sql = sql.replace('commit;',tracking+'\ncommit;')
request = Request('https://api.supabase.com/v1/projects/'+project+'/database/query',data=json.dumps({'query':sql}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},method='POST')
try:
 with urlopen(request,timeout=60) as response:
  response.read()
 print('Integration operations schema applied successfully.')
except HTTPError as error:
 raise SystemExit(f'Schema deployment failed: HTTP {error.code}. Check project access in Supabase.') from None
