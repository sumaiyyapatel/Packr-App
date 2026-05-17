"""Comprehensive Packr backend API tests.

Covers: auth (register/login/me), wardrobe CRUD with grid cleanup,
trip CRUD, grid update validation, favorite/occasion/checklist/extras,
geocode + weather, auth required on protected endpoints, multi-user isolation.
"""
import uuid
import pytest
import requests


# ============== HEALTH ==============
class TestHealth:
    def test_root(self, api_url, session):
        r = session.get(f"{api_url}/")
        assert r.status_code == 200
        body = r.json()
        assert body.get("service") == "Packr"


# ============== AUTH ==============
class TestAuth:
    def test_register_new_user(self, api_url, session):
        email = f"TEST_reg_{uuid.uuid4().hex[:8]}@packr.app"
        r = session.post(f"{api_url}/auth/register", json={"email": email, "password": "abcd1234", "name": "Reg"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and len(body["token"]) > 20
        assert body["user"]["email"] == email.lower()
        assert body["user"]["name"] == "Reg"
        assert "id" in body["user"]

    def test_register_duplicate_email_rejected(self, api_url, session):
        r = session.post(f"{api_url}/auth/register", json={"email": "test@packr.app", "password": "test1234"})
        assert r.status_code == 400

    def test_login_seeded_user(self, api_url, session):
        r = session.post(f"{api_url}/auth/login", json={"email": "test@packr.app", "password": "test1234"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body
        assert body["user"]["email"] == "test@packr.app"

    def test_login_wrong_password(self, api_url, session):
        r = session.post(f"{api_url}/auth/login", json={"email": "test@packr.app", "password": "wrongpass"})
        assert r.status_code == 401

    def test_me_with_token(self, api_url, session, test_user_headers):
        r = session.get(f"{api_url}/auth/me", headers=test_user_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == "test@packr.app"

    def test_me_without_token(self, api_url, session):
        r = requests.get(f"{api_url}/auth/me")
        assert r.status_code in (401, 403)

    def test_me_invalid_token(self, api_url):
        r = requests.get(f"{api_url}/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status_code == 401


# ============== WARDROBE ==============
class TestWardrobe:
    def test_list_wardrobe(self, api_url, session, test_user_headers):
        r = session.get(f"{api_url}/wardrobe", headers=test_user_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_wardrobe_item(self, api_url, session, test_user_headers):
        payload = {"name": "TEST_Top", "category": "top", "image": "data:image/png;base64,AAAA",
                   "colors": ["black"], "weight_kg": 0.25, "tags": ["casual"]}
        r = session.post(f"{api_url}/wardrobe", json=payload, headers=test_user_headers)
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["name"] == "TEST_Top"
        assert item["category"] == "top"
        assert "id" in item
        # Verify persistence via GET
        r2 = session.get(f"{api_url}/wardrobe", headers=test_user_headers)
        ids = [i["id"] for i in r2.json()]
        assert item["id"] in ids
        # Cleanup
        session.delete(f"{api_url}/wardrobe/{item['id']}", headers=test_user_headers)

    def test_create_wardrobe_invalid_category(self, api_url, session, test_user_headers):
        payload = {"name": "Bad", "category": "shoes", "image": ""}
        r = session.post(f"{api_url}/wardrobe", json=payload, headers=test_user_headers)
        assert r.status_code == 400

    def test_update_wardrobe_item_and_clear_invalid_grid_slot(self, api_url, session, test_user_headers):
        created = []
        for slot, cat in enumerate(["top", "bottom", "layer", "bottom", "layer", "top", "layer", "top", "bottom"]):
            r = session.post(
                f"{api_url}/wardrobe",
                json={"name": f"TEST_Edit_{slot}", "category": cat, "image": "", "tags": [" Casual ", "#Formal"]},
                headers=test_user_headers,
            )
            assert r.status_code == 200, r.text
            created.append(r.json())

        r = session.post(
            f"{api_url}/trips",
            json={"destination": "TEST_EditGrid", "start_date": "2026-09-01", "end_date": "2026-09-04"},
            headers=test_user_headers,
        )
        assert r.status_code == 200, r.text
        trip = r.json()
        grid = [item["id"] for item in created]
        r = session.put(f"{api_url}/trips/{trip['id']}/grid", json={"grid": grid}, headers=test_user_headers)
        assert r.status_code == 200, r.text

        target = created[0]
        r = session.put(
            f"{api_url}/wardrobe/{target['id']}",
            json={"name": "TEST_Edited Layer", "category": "layer", "tags": ["Rain", "rain", "#Work"]},
            headers=test_user_headers,
        )
        assert r.status_code == 200, r.text
        item = r.json()
        assert item["name"] == "TEST_Edited Layer"
        assert item["category"] == "layer"
        assert item["tags"] == ["rain", "work"]

        r = session.get(f"{api_url}/trips/{trip['id']}", headers=test_user_headers)
        assert r.status_code == 200
        assert r.json()["grid"][0] is None

        for item in created:
            session.delete(f"{api_url}/wardrobe/{item['id']}", headers=test_user_headers)
        session.delete(f"{api_url}/trips/{trip['id']}", headers=test_user_headers)

    def test_delete_wardrobe_removes_from_grid(self, api_url, session, test_user_headers):
        # Create 9 items (3 per category) and assign to grid
        ids = {"top": [], "bottom": [], "layer": []}
        for cat in ("top", "bottom", "layer"):
            for i in range(3):
                p = {"name": f"TEST_{cat}_{i}", "category": cat, "image": ""}
                r = session.post(f"{api_url}/wardrobe", json=p, headers=test_user_headers)
                assert r.status_code == 200
                ids[cat].append(r.json()["id"])
        # Create trip
        trip_payload = {"destination": "TEST_GridCity", "start_date": "2026-06-01", "end_date": "2026-06-08"}
        r = session.post(f"{api_url}/trips", json=trip_payload, headers=test_user_headers)
        assert r.status_code == 200
        trip = r.json()
        trip_id = trip["id"]
        grid = [
            ids["top"][0], ids["bottom"][0], ids["layer"][0],
            ids["bottom"][1], ids["layer"][1], ids["top"][1],
            ids["layer"][2], ids["top"][2], ids["bottom"][2],
        ]
        r = session.put(f"{api_url}/trips/{trip_id}/grid", json={"grid": grid}, headers=test_user_headers)
        assert r.status_code == 200
        assert r.json()["grid"] == grid
        # Now delete one item; verify slot becomes None
        target = grid[0]
        r = session.delete(f"{api_url}/wardrobe/{target}", headers=test_user_headers)
        assert r.status_code == 200
        r = session.get(f"{api_url}/trips/{trip_id}", headers=test_user_headers)
        assert r.status_code == 200
        new_grid = r.json()["grid"]
        assert new_grid[0] is None, f"Expected first slot to be None, got {new_grid[0]}"
        # Other slots intact
        assert new_grid[1] == grid[1]
        # Cleanup
        for it in grid[1:]:
            session.delete(f"{api_url}/wardrobe/{it}", headers=test_user_headers)
        session.delete(f"{api_url}/trips/{trip_id}", headers=test_user_headers)

    def test_wardrobe_requires_auth(self, api_url):
        r = requests.get(f"{api_url}/wardrobe")
        assert r.status_code in (401, 403)


# ============== TRIPS ==============
class TestTrips:
    @pytest.fixture
    def trip_id(self, api_url, session, test_user_headers):
        r = session.post(f"{api_url}/trips",
                         json={"destination": "TEST_Paris", "start_date": "2026-07-01", "end_date": "2026-07-05",
                               "latitude": 48.85, "longitude": 2.35},
                         headers=test_user_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        yield tid
        session.delete(f"{api_url}/trips/{tid}", headers=test_user_headers)

    def test_list_trips(self, api_url, session, test_user_headers):
        r = session.get(f"{api_url}/trips", headers=test_user_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_and_get_trip(self, api_url, session, test_user_headers, trip_id):
        r = session.get(f"{api_url}/trips/{trip_id}", headers=test_user_headers)
        assert r.status_code == 200
        t = r.json()
        assert t["destination"] == "TEST_Paris"
        assert len(t["grid"]) == 9
        assert all(s is None for s in t["grid"])

    def test_grid_must_be_length_9(self, api_url, session, test_user_headers, trip_id):
        r = session.put(f"{api_url}/trips/{trip_id}/grid",
                        json={"grid": [None, None, None]}, headers=test_user_headers)
        assert r.status_code == 400

    def test_grid_update_persists(self, api_url, session, test_user_headers, trip_id):
        grid = [None] * 9
        r = session.put(f"{api_url}/trips/{trip_id}/grid", json={"grid": grid}, headers=test_user_headers)
        assert r.status_code == 200
        assert r.json()["grid"] == grid

    def test_favorite_toggle(self, api_url, session, test_user_headers, trip_id):
        r = session.put(f"{api_url}/trips/{trip_id}/favorite",
                        json={"outfit_index": 5, "is_favorite": True}, headers=test_user_headers)
        assert r.status_code == 200
        assert 5 in r.json()["favorites"]
        r = session.put(f"{api_url}/trips/{trip_id}/favorite",
                        json={"outfit_index": 5, "is_favorite": False}, headers=test_user_headers)
        assert r.status_code == 200
        assert 5 not in r.json()["favorites"]

    def test_occasion_tag(self, api_url, session, test_user_headers, trip_id):
        r = session.put(f"{api_url}/trips/{trip_id}/occasion",
                        json={"outfit_index": 2, "occasion": "formal"}, headers=test_user_headers)
        assert r.status_code == 200
        assert r.json()["occasion_tags"].get("2") == "formal"

    def test_checklist_update(self, api_url, session, test_user_headers, trip_id):
        r = session.put(f"{api_url}/trips/{trip_id}/checklist",
                        json={"item_key": "passport", "checked": True}, headers=test_user_headers)
        assert r.status_code == 200
        assert r.json()["checklist_state"].get("passport") is True

    def test_extras_add_and_remove(self, api_url, session, test_user_headers, trip_id):
        r = session.post(f"{api_url}/trips/{trip_id}/extras",
                         json={"name": "TEST_Charger", "category": "chargers", "weight_kg": 0.15},
                         headers=test_user_headers)
        assert r.status_code == 200
        extras = r.json()["extras"]
        assert any(e["name"] == "TEST_Charger" for e in extras)
        extra_id = next(e["id"] for e in extras if e["name"] == "TEST_Charger")
        r = session.delete(f"{api_url}/trips/{trip_id}/extras/{extra_id}", headers=test_user_headers)
        assert r.status_code == 200
        assert not any(e.get("id") == extra_id for e in r.json()["extras"])

    def test_trips_require_auth(self, api_url):
        r = requests.get(f"{api_url}/trips")
        assert r.status_code in (401, 403)


# ============== GEOCODE / WEATHER ==============
class TestGeoWeather:
    def test_geocode_tokyo(self, api_url, session):
        r = session.get(f"{api_url}/geocode", params={"q": "Tokyo"})
        assert r.status_code == 200, r.text
        results = r.json().get("results", [])
        assert len(results) >= 1
        assert len(results) <= 5
        first = results[0]
        for k in ("name", "country", "latitude", "longitude"):
            assert k in first

    def test_weather_14_day(self, api_url, session):
        r = session.get(f"{api_url}/weather", params={"latitude": 35.6895, "longitude": 139.6917})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "daily" in data
        daily = data["daily"]
        for k in ("temperature_2m_max", "temperature_2m_min", "precipitation_sum", "weather_code", "time"):
            assert k in daily, f"missing key {k}"
        assert len(daily["time"]) == 14


# ============== MULTI-USER ISOLATION ==============
class TestIsolation:
    def test_user_b_cannot_see_user_a_trips(self, api_url, session, test_user_headers, secondary_user):
        # User A creates a trip
        r = session.post(f"{api_url}/trips",
                         json={"destination": "TEST_IsoTrip", "start_date": "2026-08-01", "end_date": "2026-08-05"},
                         headers=test_user_headers)
        assert r.status_code == 200
        trip_a = r.json()
        try:
            # User B tries to GET it
            r = session.get(f"{api_url}/trips/{trip_a['id']}", headers=secondary_user["headers"])
            assert r.status_code == 404
            # User B's trip list should not contain it
            r = session.get(f"{api_url}/trips", headers=secondary_user["headers"])
            assert r.status_code == 200
            assert all(t["id"] != trip_a["id"] for t in r.json())
            # User B cannot update grid
            r = session.put(f"{api_url}/trips/{trip_a['id']}/grid",
                            json={"grid": [None] * 9}, headers=secondary_user["headers"])
            # Either 404 (silent no-op then 404 lookup) — server returns 404 since no match
            assert r.status_code == 404
            # User B cannot delete
            r = session.delete(f"{api_url}/trips/{trip_a['id']}", headers=secondary_user["headers"])
            assert r.status_code == 404
        finally:
            session.delete(f"{api_url}/trips/{trip_a['id']}", headers=test_user_headers)

    def test_user_b_cannot_see_user_a_wardrobe(self, api_url, session, test_user_headers, secondary_user):
        r = session.post(f"{api_url}/wardrobe",
                         json={"name": "TEST_IsoTop", "category": "top", "image": ""},
                         headers=test_user_headers)
        assert r.status_code == 200
        item = r.json()
        try:
            r = session.get(f"{api_url}/wardrobe", headers=secondary_user["headers"])
            assert r.status_code == 200
            assert all(i["id"] != item["id"] for i in r.json())
            # User B cannot delete
            r = session.delete(f"{api_url}/wardrobe/{item['id']}", headers=secondary_user["headers"])
            assert r.status_code == 404
        finally:
            session.delete(f"{api_url}/wardrobe/{item['id']}", headers=test_user_headers)
