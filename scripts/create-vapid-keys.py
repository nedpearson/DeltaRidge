"""Generate a Web Push key pair into an ignored, owner-readable secret file."""
import argparse
import base64
import os
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

parser=argparse.ArgumentParser()
parser.add_argument('--subject',required=True,help='A monitored mailto: address for push provider contact')
parser.add_argument('--output',default='supabase/functions/.env.push')
args=parser.parse_args()
if not args.subject.startswith('mailto:') or '@' not in args.subject:
 parser.error('--subject must be a monitored mailto: email address')
key=ec.generate_private_key(ec.SECP256R1())
encode=lambda raw:base64.urlsafe_b64encode(raw).decode().rstrip('=')
private=encode(key.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
public=encode(key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint))
output=Path(args.output)
output.parent.mkdir(parents=True,exist_ok=True)
fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as stream:
 stream.write(f'VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}\nVAPID_SUBJECT={args.subject}\n')
print(f'Push keys saved to {output}. Existing keys were not overwritten.')
