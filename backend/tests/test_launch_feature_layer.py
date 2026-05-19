import base64
import io
import uuid
from PIL import Image


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _register(api_url, session):
    email = f"TEST_launch_{uuid.uuid4().hex[:8]}@packr.app"
    r = session.post(api_url + "/auth/register", json={"email": email, "password": "secret1234", "name": "Launch"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _trip_with_grid(api_url, session, headers):
    r = session.post(
        api_url + "/trips",
        json={"destination": "Tokyo", "start_date": "2026-10-01", "end_date": "2026-10-05"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    trip_id = r.json()["id"]

    categories = ["top", "bottom", "layer", "bottom", "layer", "top", "layer", "top", "bottom"]
    tags = ["casual", "formal", "cold", "casual", "business", "linen", "tropical", "modest", "denim"]
    grid = []
    for index, category in enumerate(categories):
        item = {
            "name": f"Launch item {index}",
            "category": category,
            "image": "",
            "colors": ["#8DA399" if index % 2 == 0 else "#111827"],
            "weight_kg": 0.3,
            "tags": [tags[index]],
        }
        r = session.post(api_url + "/wardrobe", json=item, headers=headers)
        assert r.status_code == 200, r.text
        grid.append(r.json()["id"])

    r = session.put(api_url + f"/trips/{trip_id}/grid", json={"grid": grid}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _image_payload():
    img = Image.new("RGB", (96, 120), (141, 163, 153))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def test_suggestions_stats_invites_and_reflections(api_url, session):
    headers = _headers(_register(api_url, session))
    trip = _trip_with_grid(api_url, session, headers)

    r = session.get(
        api_url + f"/trips/{trip['id']}/outfit-suggestions",
        params={"date": "2026-10-02", "occasion": "Formal"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    suggestions = r.json()
    assert len(suggestions) == 5
    assert suggestions[0]["score"] >= suggestions[-1]["score"]

    r = session.get(api_url + f"/trips/{trip['id']}/stats", headers=headers)
    assert r.status_code == 200, r.text
    stats = r.json()
    assert stats["completed_grid"] is True
    assert stats["outfit_variety"] == 27

    r = session.post(api_url + f"/trips/{trip['id']}/invites", json={}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["code"]

    r = session.post(
        api_url + f"/trips/{trip['id']}/reflections",
        json={"worn_outfit_keys": [suggestions[0]["outfit_key"]], "unused_item_ids": [], "notes": "worked"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["trip_id"] == trip["id"]


def test_challenges_trending_and_votes(api_url, session):
    headers = _headers(_register(api_url, session))
    trip = _trip_with_grid(api_url, session, headers)

    r = session.post(api_url + "/uploads/community-post-image", json={"image": _image_payload()}, headers=headers)
    assert r.status_code == 200, r.text
    upload = r.json()

    r = session.post(
        api_url + "/community/posts",
        json={
            "trip_id": trip["id"],
            "title": "Launch screenshot",
            "caption": "challenge",
            "image_url": upload["url"],
            "image_width": upload["width"],
            "image_height": upload["height"],
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    post = r.json()
    post_id = post["id"]
    assert post["image_url"] == upload["url"]

    r = session.get(api_url + "/community/challenges", headers=headers)
    assert r.status_code == 200, r.text
    challenge = r.json()[0]
    assert challenge["id"]

    r = session.post(api_url + f"/community/challenges/{challenge['id']}/posts/{post_id}/vote", headers=headers)
    assert r.status_code == 200, r.text

    r = session.get(api_url + "/community/trending", params={"destination": "Tokyo"}, headers=headers)
    assert r.status_code == 200, r.text
    assert any(post["id"] == post_id for post in r.json())


def test_grid_index_checklist_keys_are_removed(api_url, session):
    headers = _headers(_register(api_url, session))
    trip = _trip_with_grid(api_url, session, headers)
    item_id = trip["grid"][0]

    r = session.put(api_url + f"/trips/{trip['id']}/checklist", json={"item_key": "grid:0", "checked": True}, headers=headers)
    assert r.status_code == 200, r.text
    r = session.put(api_url + f"/trips/{trip['id']}/checklist", json={"item_key": f"grid:{item_id}", "checked": True}, headers=headers)
    assert r.status_code == 200, r.text

    r = session.delete(api_url + f"/wardrobe/{item_id}", headers=headers)
    assert r.status_code == 200, r.text

    r = session.get(api_url + f"/trips/{trip['id']}", headers=headers)
    assert r.status_code == 200, r.text
    state = r.json()["checklist_state"]
    assert "grid:0" not in state
    assert f"grid:{item_id}" not in state
