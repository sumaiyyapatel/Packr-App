"""Shared fixtures for Packr API tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_url():
    return API


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def test_user_token(session):
    """Login the seeded test user."""
    r = session.post(f"{API}/auth/login", json={"email": "test@packr.app", "password": "test1234"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def test_user_headers(test_user_token):
    return {"Authorization": f"Bearer {test_user_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def secondary_user(session):
    """Register a fresh secondary user (for isolation tests)."""
    email = f"TEST_iso_{uuid.uuid4().hex[:8]}@packr.app"
    r = session.post(f"{API}/auth/register", json={"email": email, "password": "secret1234", "name": "Iso"})
    assert r.status_code == 200, f"Secondary register failed: {r.text}"
    data = r.json()
    return {"email": email, "token": data["token"], "id": data["user"]["id"],
            "headers": {"Authorization": f"Bearer {data['token']}", "Content-Type": "application/json"}}
