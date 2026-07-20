"""One-time seed of official templates into Firestore (project packr-inkspace).

Usage (from E:\\packr):
    python scripts/seed_firestore_templates.py

Reads FIREBASE_CREDENTIALS_PATH from backend/.env (the Admin SDK service
account key). Idempotent: skips templates whose title already exists.

Reuses DEFAULT_TEMPLATES from backend/server.py so the data never diverges.
"""
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'backend'))

from dotenv import load_dotenv

load_dotenv(ROOT / 'backend' / '.env')

import firebase_admin
from firebase_admin import credentials, firestore

# Import the canonical template data (server.py runs its module-level env
# checks on import; backend/.env satisfies them in development).
from server import DEFAULT_TEMPLATES, normalize_template_items  # noqa: E402


def main() -> None:
    creds_path = os.environ.get('FIREBASE_CREDENTIALS_PATH', '').strip('"')
    if not creds_path or not Path(creds_path).exists():
        raise SystemExit(f'Service account key not found: {creds_path!r} (check backend/.env)')

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(creds_path))
    db = firestore.client()

    existing_titles = {
        doc.to_dict().get('title')
        for doc in db.collection('templates').where('is_official', '==', True).stream()
    }

    created = 0
    for template in DEFAULT_TEMPLATES:
        if template['title'] in existing_titles:
            print(f"skip (exists): {template['title']}")
            continue
        doc = {
            **template,
            'items': normalize_template_items(template['items']),
            'author_id': None,
            'created_at': datetime.now(timezone.utc),
        }
        db.collection('templates').document(str(uuid.uuid4())).set(doc)
        created += 1
        print(f"seeded: {template['title']}")

    print(f'Done. {created} template(s) created, {len(existing_titles)} already present.')


if __name__ == '__main__':
    main()
