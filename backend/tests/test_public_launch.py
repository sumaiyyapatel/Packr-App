import base64
import io
import uuid

import requests
from PIL import Image


SLOT_CATEGORIES = ["top", "bottom", "layer", "bottom", "layer", "top", "layer", "top", "bottom"]


def _jpeg_b64(color=(80, 120, 170), size=(48, 48)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _cutout_fixture_b64():
    img = Image.new("RGB", (96, 96), "white")
    for x in range(30, 66):
        for y in range(24, 78):
            img.putpixel((x, y), (190, 40, 35))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _register(api_url, session, name):
    email = f"TEST_launch_{uuid.uuid4().hex[:8]}@packr.app"
    r = session.post(
        f"{api_url}/auth/register",
        json={"email": email, "password": "secret1234", "name": name},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "id": data["user"]["id"],
        "headers": {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"},
    }


def _make_complete_trip(api_url, session, headers):
    r = session.post(
        f"{api_url}/trips",
        json={"destination": "Kyoto", "start_date": "2026-10-01", "end_date": "2026-10-03"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    trip = r.json()

    item_ids = []
    for slot, category in enumerate(SLOT_CATEGORIES):
        r = session.post(
            f"{api_url}/wardrobe",
            json={
                "name": f"Launch item {slot}",
                "category": category,
                "image": "data:image/jpeg;base64," + _jpeg_b64(),
                "colors": ["#5078AA"],
                "tags": ["test"],
                "weight_kg": 0.2,
            },
            headers=headers,
        )
        assert r.status_code == 200, r.text
        item_ids.append(r.json()["id"])

    r = session.put(f"{api_url}/trips/{trip['id']}/grid", json={"grid": item_ids}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json(), item_ids


def test_wardrobe_image_upload_returns_remote_url(api_url, session, test_user_headers):
    image = "data:image/jpeg;base64," + _jpeg_b64(size=(96, 64))
    r = session.post(f"{api_url}/uploads/wardrobe-image", json={"image": image}, headers=test_user_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"].startswith("/uploads/") or body["url"].startswith("https://")
    assert body["width"] <= 96
    assert body["height"] <= 64
    assert body["content_type"] == "image/jpeg"


def test_legacy_base64_wardrobe_image_still_persists(api_url, session, test_user_headers):
    legacy_image = "data:image/jpeg;base64," + _jpeg_b64()
    r = session.post(
        f"{api_url}/wardrobe",
        json={
            "name": "Legacy base64 top",
            "category": "top",
            "image": legacy_image,
            "colors": ["#5078AA"],
            "tags": ["legacy"],
            "weight_kg": 0.2,
        },
        headers=test_user_headers,
    )
    assert r.status_code == 200, r.text
    item = r.json()
    try:
        assert item["image"] == legacy_image
    finally:
        session.delete(f"{api_url}/wardrobe/{item['id']}", headers=test_user_headers)


def test_cutout_removes_edge_background_and_preserves_subject(api_url, session, test_user_headers):
    image = "data:image/png;base64," + _cutout_fixture_b64()
    r = session.post(f"{api_url}/cutout", json={"image": image}, headers=test_user_headers)
    assert r.status_code == 200, r.text
    encoded = r.json()["image"].split(",", 1)[1]
    out = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")
    assert out.getpixel((4, 4))[3] < 20
    assert out.getpixel((48, 48))[3] > 220


def test_outfit_plan_persists_and_validates_trip_dates(api_url, session):
    user = _register(api_url, session, "Planner")
    trip, item_ids = _make_complete_trip(api_url, session, user["headers"])
    outfit_key = "|".join([item_ids[0], item_ids[1], item_ids[2]])

    r = session.put(
        f"{api_url}/trips/{trip['id']}/outfit-plan",
        json={"date": "2026-10-02", "outfit_key": outfit_key},
        headers=user["headers"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["outfit_plan"]["2026-10-02"] == outfit_key

    r = session.put(
        f"{api_url}/trips/{trip['id']}/outfit-plan",
        json={"date": "2026-10-09", "outfit_key": outfit_key},
        headers=user["headers"],
    )
    assert r.status_code == 400

    r = session.put(
        f"{api_url}/trips/{trip['id']}/outfit-plan",
        json={"date": "2026-10-02", "outfit_key": "missing|missing|missing"},
        headers=user["headers"],
    )
    assert r.status_code == 400


def test_template_launch_filters(api_url):
    r = requests.get(f"{api_url}/templates", params={"q": "Tokyo", "source": "official"})
    assert r.status_code == 200, r.text
    assert r.json()
    assert all(t["is_official"] and "tokyo" in t["title"].lower() for t in r.json())

    r = requests.get(f"{api_url}/templates", params={"climate": "warm", "days_min": 5, "days_max": 7})
    assert r.status_code == 200, r.text
    assert r.json()
    assert all(t["climate"] == "warm" and 5 <= t["days"] <= 7 for t in r.json())


def test_report_post_and_comment_are_idempotent(api_url, session):
    author = _register(api_url, session, "Report Author")
    viewer = _register(api_url, session, "Report Viewer")
    trip, _item_ids = _make_complete_trip(api_url, session, author["headers"])

    r = session.post(
        f"{api_url}/community/posts",
        json={"trip_id": trip["id"], "title": "Reportable grid", "caption": "Needs review."},
        headers=author["headers"],
    )
    assert r.status_code == 200, r.text
    post = r.json()
    assert post["image_url"].startswith("/uploads/community/")

    for _ in range(2):
        r = session.post(
            f"{api_url}/community/posts/{post['id']}/report",
            json={"reason": "Spam"},
            headers=viewer["headers"],
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "reported"

    r = session.post(
        f"{api_url}/community/posts/{post['id']}/comments",
        json={"text": "Please review this."},
        headers=viewer["headers"],
    )
    assert r.status_code == 200, r.text
    comment_id = r.json()["latest_comments"][0]["id"]

    for _ in range(2):
        r = session.post(
            f"{api_url}/community/posts/{post['id']}/comments/{comment_id}/report",
            json={"reason": "Harassment"},
            headers=author["headers"],
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "reported"
