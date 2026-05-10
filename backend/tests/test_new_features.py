"""Tests for iteration 2 new features:
- POST /api/palette (server-side color extraction via Pillow)
- GET/POST /api/templates, GET /api/templates/{id}
- POST /api/templates/{id}/like
- POST /api/templates/{id}/apply
"""
import io
import base64
import uuid
import pytest
import requests
from PIL import Image


# ============== PALETTE ==============
class TestPalette:
    @staticmethod
    def _red_jpeg_b64() -> str:
        img = Image.new('RGB', (64, 64), (180, 60, 60))
        buf = io.BytesIO()
        img.save(buf, format='JPEG')
        return base64.b64encode(buf.getvalue()).decode('utf-8')

    def test_palette_requires_auth(self, api_url):
        r = requests.post(f"{api_url}/palette", json={"image": self._red_jpeg_b64()})
        assert r.status_code in (401, 403)

    def test_palette_extracts_red(self, api_url, session, test_user_headers):
        r = session.post(f"{api_url}/palette",
                         json={"image": self._red_jpeg_b64()}, headers=test_user_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "colors" in body
        assert isinstance(body["colors"], list) and len(body["colors"]) >= 1
        first = body["colors"][0]
        assert first.startswith('#') and len(first) == 7
        # Should be reddish: R component substantially higher than G & B
        r_comp = int(first[1:3], 16)
        g_comp = int(first[3:5], 16)
        b_comp = int(first[5:7], 16)
        assert r_comp > 120 and r_comp > g_comp and r_comp > b_comp, f"Expected red dominant, got {first}"

    def test_palette_with_data_url_prefix(self, api_url, session, test_user_headers):
        b64 = self._red_jpeg_b64()
        r = session.post(f"{api_url}/palette",
                         json={"image": f"data:image/jpeg;base64,{b64}"}, headers=test_user_headers)
        assert r.status_code == 200
        assert len(r.json()["colors"]) >= 1

    def test_palette_invalid_image(self, api_url, session, test_user_headers):
        r = session.post(f"{api_url}/palette",
                         json={"image": "not-a-real-image"}, headers=test_user_headers)
        assert r.status_code == 400


# ============== TEMPLATES (PUBLIC LIST/GET) ==============
class TestTemplatesPublic:
    def test_list_templates_no_auth(self, api_url):
        r = requests.get(f"{api_url}/templates")
        assert r.status_code == 200
        templates = r.json()
        assert isinstance(templates, list)
        # At least 4 official templates
        official = [t for t in templates if t.get("is_official")]
        assert len(official) >= 4, f"Expected >=4 official templates, got {len(official)}"

    def test_official_seed_templates(self, api_url):
        r = requests.get(f"{api_url}/templates")
        assert r.status_code == 200
        templates = r.json()
        titles = [t["title"] for t in templates if t.get("is_official")]
        # Verify the 4 expected destinations show up
        for needle in ("Tokyo", "Bali", "Lisbon", "Reykjavík"):
            assert any(needle in t for t in titles), f"Missing official template for {needle}: titles={titles}"

    def test_each_template_has_9_items_with_required_fields(self, api_url):
        r = requests.get(f"{api_url}/templates")
        assert r.status_code == 200
        for t in r.json():
            if not t.get("is_official"):
                continue
            assert len(t["items"]) == 9, f"Template {t['title']} has {len(t['items'])} items"
            for k in ("climate", "days", "season"):
                assert k in t and t[k], f"Template {t['title']} missing {k}"
            for it in t["items"]:
                assert "name" in it and it["name"]
                assert it["category"] in ("top", "bottom", "layer")
                assert isinstance(it.get("colors", []), list)
                assert isinstance(it.get("tags", []), list)

    def test_get_template_by_id(self, api_url):
        r = requests.get(f"{api_url}/templates")
        tid = r.json()[0]["id"]
        r = requests.get(f"{api_url}/templates/{tid}")
        assert r.status_code == 200
        assert r.json()["id"] == tid

    def test_get_template_404(self, api_url):
        r = requests.get(f"{api_url}/templates/{uuid.uuid4()}")
        assert r.status_code == 404


# ============== TEMPLATES (AUTH-PROTECTED MUTATIONS) ==============
class TestTemplatesAuth:
    @staticmethod
    def _nine_items():
        return [
            {"name": f"TEST_item_{i}",
             "category": ["top", "bottom", "layer"][i % 3],
             "colors": ["#123456"],
             "tags": ["casual"]}
            for i in range(9)
        ]

    def test_publish_requires_auth(self, api_url):
        r = requests.post(f"{api_url}/templates", json={
            "title": "x", "description": "y", "destination": "z",
            "days": 5, "season": "Spring", "climate": "warm",
            "items": self._nine_items()
        })
        assert r.status_code in (401, 403)

    def test_publish_rejects_non_9_items(self, api_url, session, test_user_headers):
        r = session.post(f"{api_url}/templates",
                         json={"title": "TEST_BadLen", "description": "d", "destination": "X",
                               "days": 3, "season": "Summer", "climate": "warm",
                               "items": self._nine_items()[:5]},
                         headers=test_user_headers)
        assert r.status_code == 400

    def test_publish_user_template(self, api_url, session, test_user_headers):
        r = session.post(f"{api_url}/templates",
                         json={"title": "TEST_PublishOk", "description": "d", "destination": "X",
                               "days": 3, "season": "Summer", "climate": "warm",
                               "items": self._nine_items()},
                         headers=test_user_headers)
        assert r.status_code == 200, r.text
        tpl = r.json()
        assert tpl["is_official"] is False
        assert tpl["author_id"]
        assert len(tpl["items"]) == 9

    def test_like_increments(self, api_url, session, test_user_headers):
        r = requests.get(f"{api_url}/templates")
        tid = next(t["id"] for t in r.json() if t.get("is_official"))
        before = next(t["likes"] for t in r.json() if t["id"] == tid)
        r = session.post(f"{api_url}/templates/{tid}/like", headers=test_user_headers)
        assert r.status_code == 200, r.text
        after = r.json()["likes"]
        assert after == before + 1

    def test_like_requires_auth(self, api_url):
        r = requests.get(f"{api_url}/templates")
        tid = r.json()[0]["id"]
        r = requests.post(f"{api_url}/templates/{tid}/like")
        assert r.status_code in (401, 403)


# ============== APPLY TEMPLATE ==============
class TestApplyTemplate:
    @pytest.fixture
    def trip_for_apply(self, api_url, session, test_user_headers):
        r = session.post(f"{api_url}/trips",
                         json={"destination": "TEST_ApplyTrip", "start_date": "2026-09-01", "end_date": "2026-09-05"},
                         headers=test_user_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        yield tid
        session.delete(f"{api_url}/trips/{tid}", headers=test_user_headers)

    def test_apply_fills_grid_and_clones_wardrobe(self, api_url, session, test_user_headers, trip_for_apply):
        # Get an official template
        r = requests.get(f"{api_url}/templates")
        tid = next(t["id"] for t in r.json() if t.get("is_official"))

        # Wardrobe count before
        r = session.get(f"{api_url}/wardrobe", headers=test_user_headers)
        before_count = len(r.json())

        # Apply
        r = session.post(f"{api_url}/templates/{tid}/apply",
                         json={"trip_id": trip_for_apply}, headers=test_user_headers)
        assert r.status_code == 200, r.text
        trip = r.json()
        assert len(trip["grid"]) == 9
        assert all(slot is not None for slot in trip["grid"]), f"Grid not fully filled: {trip['grid']}"

        # Wardrobe count grew by 9
        r = session.get(f"{api_url}/wardrobe", headers=test_user_headers)
        after = r.json()
        assert len(after) == before_count + 9

        # Each cloned item has 'from-template' tag
        new_ids = set(trip["grid"])
        cloned = [w for w in after if w["id"] in new_ids]
        assert len(cloned) == 9
        for w in cloned:
            assert "from-template" in w.get("tags", []), f"Missing from-template tag on {w['name']}"

        # Cleanup wardrobe items created
        for wid in new_ids:
            session.delete(f"{api_url}/wardrobe/{wid}", headers=test_user_headers)

    def test_apply_to_someone_elses_trip_404(self, api_url, session, test_user_headers, secondary_user):
        # Secondary user creates a trip
        r = session.post(f"{api_url}/trips",
                         json={"destination": "TEST_OtherTrip", "start_date": "2026-09-01", "end_date": "2026-09-05"},
                         headers=secondary_user["headers"])
        assert r.status_code == 200
        other_trip_id = r.json()["id"]
        try:
            r = requests.get(f"{api_url}/templates")
            tid = next(t["id"] for t in r.json() if t.get("is_official"))
            # Primary user tries to apply to secondary's trip
            r = session.post(f"{api_url}/templates/{tid}/apply",
                             json={"trip_id": other_trip_id}, headers=test_user_headers)
            assert r.status_code == 404
        finally:
            session.delete(f"{api_url}/trips/{other_trip_id}", headers=secondary_user["headers"])

    def test_apply_unknown_template_404(self, api_url, session, test_user_headers, trip_for_apply):
        r = session.post(f"{api_url}/templates/{uuid.uuid4()}/apply",
                         json={"trip_id": trip_for_apply}, headers=test_user_headers)
        assert r.status_code == 404
