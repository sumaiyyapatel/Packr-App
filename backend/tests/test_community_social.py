import uuid
import requests


SLOT_CATEGORIES = ["top", "bottom", "layer", "bottom", "layer", "top", "layer", "top", "bottom"]


def _register(api_url, session, name):
    email = f"TEST_social_{uuid.uuid4().hex[:8]}@packr.app"
    r = session.post(
        f"{api_url}/auth/register",
        json={"email": email, "password": "secret1234", "name": name},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    return {
        "id": data["user"]["id"],
        "token": data["token"],
        "headers": {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"},
    }


def _make_grid_trip(api_url, session, headers):
    r = session.post(
        f"{api_url}/trips",
        json={"destination": "Seoul", "start_date": "2026-07-01", "end_date": "2026-07-04"},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    trip = r.json()

    item_ids = []
    for slot, category in enumerate(SLOT_CATEGORIES):
        r = session.post(
            f"{api_url}/wardrobe",
            json={
                "name": f"Social item {slot}",
                "category": category,
                "image": "",
                "colors": ["#8DA399"],
                "tags": ["test"],
                "weight_kg": 0.2,
            },
            headers=headers,
        )
        assert r.status_code == 200, r.text
        item_ids.append(r.json()["id"])

    r = session.put(f"{api_url}/trips/{trip['id']}/grid", json={"grid": item_ids}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _publish_post(api_url, session, headers, trip_id, **overrides):
    payload = {"trip_id": trip_id, "title": "Seoul capsule", "caption": "Four day city grid."}
    payload.update(overrides)
    r = session.post(f"{api_url}/community/posts", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


class TestCommunitySocial:
    def test_post_comment_save_follow_flow(self, api_url, session):
        author = _register(api_url, session, "Ava Author")
        viewer = _register(api_url, session, "Ben Viewer")
        trip = _make_grid_trip(api_url, session, author["headers"])

        r = session.post(
            f"{api_url}/community/posts",
            json={"trip_id": trip["id"], "title": "Seoul capsule", "caption": "Four day city grid."},
            headers=author["headers"],
        )
        assert r.status_code == 200, r.text
        post = r.json()
        assert post["author_name"] == "Ava Author"
        assert post["days"] == 4
        assert post["image_url"].startswith("/uploads/community/")
        assert post["image_width"] == 720
        assert post["image_height"] == 900
        assert post["items_snapshot"] == []
        assert post["grid"] == []

        r = session.get(f"{api_url}/community/posts?scope=public", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert any(item["id"] == post["id"] for item in r.json())

        r = session.post(f"{api_url}/community/posts/{post['id']}/like", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert r.json()["is_liked"] is True
        assert r.json()["likes_count"] == 1

        r = session.post(f"{api_url}/community/posts/{post['id']}/save", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert r.json()["is_saved"] is True

        r = session.get(f"{api_url}/community/posts?scope=saved", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert [item["id"] for item in r.json()].count(post["id"]) == 1

        r = session.post(
            f"{api_url}/community/posts/{post['id']}/comments",
            json={"text": "This works for a city break."},
            headers=viewer["headers"],
        )
        assert r.status_code == 200, r.text
        commented = r.json()
        assert commented["comments_count"] == 1
        assert commented["latest_comments"][0]["user_name"] == "Ben Viewer"
        assert commented["latest_comments"][0]["text"] == "This works for a city break."

        r = session.post(f"{api_url}/users/{author['id']}/follow", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        profile = r.json()
        assert "email" not in profile
        assert profile["is_following"] is True
        assert profile["followers_count"] == 1

        r = session.get(f"{api_url}/community/posts?scope=following", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert any(item["id"] == post["id"] and item["is_following_author"] for item in r.json())

        r = session.delete(f"{api_url}/users/{author['id']}/follow", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert r.json()["is_following"] is False

    def test_private_post_is_hidden_from_other_users(self, api_url, session):
        author = _register(api_url, session, "Private Author")
        viewer = _register(api_url, session, "Private Viewer")
        trip = _make_grid_trip(api_url, session, author["headers"])

        r = session.post(
            f"{api_url}/community/posts",
            json={"trip_id": trip["id"], "title": "Private grid", "visibility": "private"},
            headers=author["headers"],
        )
        assert r.status_code == 200, r.text
        post_id = r.json()["id"]

        r = session.get(f"{api_url}/community/posts/{post_id}", headers=viewer["headers"])
        assert r.status_code == 404

        r = session.get(f"{api_url}/community/posts?scope=public", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert all(item["id"] != post_id for item in r.json())

    def test_social_actions_are_idempotent_and_comments_can_be_deleted(self, api_url, session):
        author = _register(api_url, session, "Count Author")
        viewer = _register(api_url, session, "Count Viewer")
        stranger = _register(api_url, session, "Count Stranger")
        trip = _make_grid_trip(api_url, session, author["headers"])
        post = _publish_post(api_url, session, author["headers"], trip["id"])

        for _ in range(2):
            r = session.post(f"{api_url}/community/posts/{post['id']}/like", headers=viewer["headers"])
            assert r.status_code == 200, r.text
            assert r.json()["likes_count"] == 1
        for _ in range(2):
            r = session.delete(f"{api_url}/community/posts/{post['id']}/like", headers=viewer["headers"])
            assert r.status_code == 200, r.text
            assert r.json()["likes_count"] == 0

        for _ in range(2):
            r = session.post(f"{api_url}/community/posts/{post['id']}/save", headers=viewer["headers"])
            assert r.status_code == 200, r.text
            assert r.json()["saves_count"] == 1
        for _ in range(2):
            r = session.delete(f"{api_url}/community/posts/{post['id']}/save", headers=viewer["headers"])
            assert r.status_code == 200, r.text
            assert r.json()["saves_count"] == 0

        r = session.post(
            f"{api_url}/community/posts/{post['id']}/comments",
            json={"text": "   Clean spacing please.   "},
            headers=viewer["headers"],
        )
        assert r.status_code == 200, r.text
        commented = r.json()
        comment_id = commented["latest_comments"][0]["id"]
        assert commented["comments_count"] == 1
        assert commented["latest_comments"][0]["text"] == "Clean spacing please."

        r = session.delete(
            f"{api_url}/community/posts/{post['id']}/comments/{comment_id}",
            headers=stranger["headers"],
        )
        assert r.status_code == 403

        r = session.delete(
            f"{api_url}/community/posts/{post['id']}/comments/{comment_id}",
            headers=author["headers"],
        )
        assert r.status_code == 200, r.text
        assert r.json()["comments_count"] == 0
        assert r.json()["latest_comments"] == []

    def test_followers_post_visibility_tracks_follow_state(self, api_url, session):
        author = _register(api_url, session, "Followers Author")
        viewer = _register(api_url, session, "Followers Viewer")
        trip = _make_grid_trip(api_url, session, author["headers"])
        post = _publish_post(
            api_url,
            session,
            author["headers"],
            trip["id"],
            title="Followers only",
            visibility="followers",
        )

        r = session.get(f"{api_url}/community/posts/{post['id']}", headers=viewer["headers"])
        assert r.status_code == 404

        r = session.post(f"{api_url}/users/{author['id']}/follow", headers=viewer["headers"])
        assert r.status_code == 200, r.text

        r = session.get(f"{api_url}/community/posts/{post['id']}", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert r.json()["is_following_author"] is True

        r = session.post(f"{api_url}/community/posts/{post['id']}/save", headers=viewer["headers"])
        assert r.status_code == 200, r.text

        r = session.delete(f"{api_url}/users/{author['id']}/follow", headers=viewer["headers"])
        assert r.status_code == 200, r.text

        r = session.get(f"{api_url}/community/posts/{post['id']}", headers=viewer["headers"])
        assert r.status_code == 404

        r = session.get(f"{api_url}/community/posts?scope=saved", headers=viewer["headers"])
        assert r.status_code == 200, r.text
        assert all(item["id"] != post["id"] for item in r.json())

    def test_incomplete_grid_cannot_be_shared(self, api_url, session):
        author = _register(api_url, session, "Incomplete Author")
        r = session.post(
            f"{api_url}/trips",
            json={"destination": "Paris", "start_date": "2026-08-01", "end_date": "2026-08-03"},
            headers=author["headers"],
        )
        assert r.status_code == 200, r.text

        r = session.post(
            f"{api_url}/community/posts",
            json={"trip_id": r.json()["id"], "title": "Not ready"},
            headers=author["headers"],
        )
        assert r.status_code == 400
        assert "Complete all 9 grid slots" in r.text
