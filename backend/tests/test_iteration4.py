"""Iteration 4 features:
- Like idempotency + unlike
- Apply re-apply cleanup
- Palette size guard
- User shape: is_pro + airline_profiles
- Free trip cap (402)
- Publish requires Pro
- /me/pro upgrade/downgrade
- /me/airlines add/remove (Pro-only)
"""
import io
import base64
import uuid
import pytest
import requests
from PIL import Image


def _login(api_url, session, email, password):
    r = session.post(f"{api_url}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _register(api_url, session, email, password="secret1234", name="Tester"):
    r = session.post(f"{api_url}/auth/register",
                     json={"email": email, "password": password, "name": name})
    assert r.status_code == 200, r.text
    return r.json()


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============== USER SHAPE ==============
class TestUserShape:
    def test_register_returns_pro_and_airlines(self, api_url, session):
        email = f"TEST_shape_{uuid.uuid4().hex[:6]}@packr.app"
        data = _register(api_url, session, email)
        u = data["user"]
        assert u["is_pro"] is False
        assert isinstance(u["airline_profiles"], list)
        assert len(u["airline_profiles"]) >= 2
        ids = [a.get("id") for a in u["airline_profiles"]]
        assert "carry-on" in ids and "iata" in ids

    def test_me_returns_pro_and_airlines(self, api_url, session):
        email = f"TEST_me_{uuid.uuid4().hex[:6]}@packr.app"
        data = _register(api_url, session, email)
        r = session.get(f"{api_url}/auth/me", headers=_hdr(data["token"]))
        assert r.status_code == 200
        u = r.json()
        assert "is_pro" in u and "airline_profiles" in u
        assert u["is_pro"] is False


# ============== LIKE IDEMPOTENCY ==============
class TestLikeIdempotency:
    def test_double_like_no_increment(self, api_url, session):
        # Fresh user so we know they haven't liked yet
        data = _register(api_url, session, f"TEST_like_{uuid.uuid4().hex[:6]}@packr.app")
        h = _hdr(data["token"])
        templates = requests.get(f"{api_url}/templates").json()
        tid = next(t["id"] for t in templates if t.get("is_official"))
        before = next(t["likes"] for t in templates if t["id"] == tid)

        r1 = session.post(f"{api_url}/templates/{tid}/like", headers=h)
        assert r1.status_code == 200
        after1 = r1.json()["likes"]
        assert after1 == before + 1

        r2 = session.post(f"{api_url}/templates/{tid}/like", headers=h)
        assert r2.status_code == 200
        after2 = r2.json()["likes"]
        assert after2 == after1, f"Expected idempotent like, got {after1}->{after2}"

        # Unlike
        r3 = session.delete(f"{api_url}/templates/{tid}/like", headers=h)
        assert r3.status_code == 200
        assert r3.json()["likes"] == before

        # Unlike again — still idempotent (no error, count unchanged)
        r4 = session.delete(f"{api_url}/templates/{tid}/like", headers=h)
        assert r4.status_code == 200
        assert r4.json()["likes"] == before


# ============== APPLY RE-APPLY CLEANUP ==============
class TestApplyCleanup:
    def test_repeat_apply_keeps_wardrobe_bounded(self, api_url, session):
        # Register + upgrade so trip cap doesn't hit
        data = _register(api_url, session, f"TEST_apply_{uuid.uuid4().hex[:6]}@packr.app")
        h = _hdr(data["token"])
        session.post(f"{api_url}/me/pro", headers=h)

        # Create trip
        r = session.post(f"{api_url}/trips",
                         json={"destination": "TEST_Apply", "start_date": "2026-10-01", "end_date": "2026-10-05"},
                         headers=h)
        assert r.status_code == 200
        trip_id = r.json()["id"]

        templates = requests.get(f"{api_url}/templates").json()
        tid = next(t["id"] for t in templates if t.get("is_official"))

        before = len(session.get(f"{api_url}/wardrobe", headers=h).json())

        # Apply 3x in a row
        for _ in range(3):
            r = session.post(f"{api_url}/templates/{tid}/apply",
                             json={"trip_id": trip_id}, headers=h)
            assert r.status_code == 200, r.text

        after = len(session.get(f"{api_url}/wardrobe", headers=h).json())
        # Should be bounded: only 9 from-template items (cleanup of prior on each re-apply)
        assert after - before == 9, f"Wardrobe ballooned: {before}->{after}"

        # Verify all 9 grid items have from-template tag
        trip = session.get(f"{api_url}/trips/{trip_id}", headers=h).json()
        wardrobe = session.get(f"{api_url}/wardrobe", headers=h).json()
        wmap = {w["id"]: w for w in wardrobe}
        for sid in trip["grid"]:
            assert sid in wmap, f"Slot {sid} not in wardrobe"
            assert "from-template" in wmap[sid]["tags"]


# ============== PALETTE GUARD ==============
class TestPaletteGuard:
    def test_small_image_works(self, api_url, session, test_user_headers):
        img = Image.new('RGB', (32, 32), (40, 200, 80))
        buf = io.BytesIO()
        img.save(buf, format='JPEG')
        b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
        r = session.post(f"{api_url}/palette", json={"image": b64}, headers=test_user_headers)
        assert r.status_code == 200

    def test_oversized_payload_rejected(self, api_url, session, test_user_headers):
        # Build > 8MB base64 string (will trip payload guard before decode)
        big_b64 = "A" * (9 * 1024 * 1024)
        r = session.post(f"{api_url}/palette", json={"image": big_b64}, headers=test_user_headers)
        assert r.status_code == 413, f"Expected 413, got {r.status_code}: {r.text[:200]}"


# ============== V1 PUBLIC LAUNCH: NO FREE TRIP CAP ==============
class TestFreeTripCap:
    def test_free_user_can_create_more_than_two_trips_when_pro_disabled(self, api_url, session):
        data = _register(api_url, session, f"TEST_cap_{uuid.uuid4().hex[:6]}@packr.app")
        h = _hdr(data["token"])
        for i in range(3):
            r = session.post(f"{api_url}/trips",
                             json={"destination": f"T{i}", "start_date": "2026-09-01", "end_date": "2026-09-05"},
                             headers=h)
            assert r.status_code == 200, r.text


# ============== V1 PUBLIC LAUNCH: PUBLISHING IS NOT PRO-GATED ==============
class TestPublishProGate:
    def _nine_items(self):
        slot_categories = ["top", "bottom", "layer", "bottom", "layer", "top", "layer", "top", "bottom"]
        return [{"name": f"i{i}", "category": slot_categories[i],
                 "colors": [], "tags": []} for i in range(9)]

    def test_publish_allowed_when_pro_disabled(self, api_url, session):
        data = _register(api_url, session, f"TEST_pub_{uuid.uuid4().hex[:6]}@packr.app")
        h = _hdr(data["token"])
        payload = {"title": "TEST_t", "description": "d", "destination": "X",
                   "days": 3, "season": "Summer", "climate": "warm",
                   "items": self._nine_items()}
        r = session.post(f"{api_url}/templates", json=payload, headers=h)
        assert r.status_code == 200, r.text
        assert r.json()["is_official"] is False


# ============== /me/pro DISABLED & /me/airlines AVAILABLE ==============
class TestMeProAirlines:
    def test_upgrade_downgrade_disabled_for_public_launch(self, api_url, session):
        data = _register(api_url, session, f"TEST_pro_{uuid.uuid4().hex[:6]}@packr.app")
        h = _hdr(data["token"])
        assert data["user"]["is_pro"] is False

        r = session.post(f"{api_url}/me/pro", headers=h)
        assert r.status_code == 404

        r = session.delete(f"{api_url}/me/pro", headers=h)
        assert r.status_code == 404

    def test_add_airline_allowed_when_pro_disabled(self, api_url, session):
        data = _register(api_url, session, f"TEST_air_{uuid.uuid4().hex[:6]}@packr.app")
        h = _hdr(data["token"])
        # Add an airline while Pro is disabled
        r = session.post(f"{api_url}/me/airlines",
                         json={"name": "TEST_Air", "max_kg": 8.0}, headers=h)
        assert r.status_code == 200, r.text

        # Add another airline profile
        r = session.post(f"{api_url}/me/airlines",
                         json={"name": "TEST_Ryanair", "max_kg": 10.0}, headers=h)
        assert r.status_code == 200, r.text
        airlines = r.json()["airline_profiles"]
        assert any(a["name"] == "TEST_Ryanair" and a["max_kg"] == 10.0 for a in airlines)
        added_id = next(a["id"] for a in airlines if a["name"] == "TEST_Ryanair")

        # Delete it
        r = session.delete(f"{api_url}/me/airlines/{added_id}", headers=h)
        assert r.status_code == 200
        ids_after = [a["id"] for a in r.json()["airline_profiles"]]
        assert added_id not in ids_after
        # Defaults still present
        assert "carry-on" in ids_after and "iata" in ids_after
