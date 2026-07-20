from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, status
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import shutil
import base64
import json
import re
import asyncio
from collections import deque
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any, Union, Literal
import uuid
from datetime import datetime, timedelta, timezone, date
from urllib.parse import unquote, urlparse
import bcrypt
import jwt
import httpx
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps
from pymongo.errors import DuplicateKeyError

try:
    from rembg import remove as rembg_remove
except BaseException:
    rembg_remove = None

try:
    from colorthief import ColorThief
except Exception:
    ColorThief = None

try:
    import firebase_admin
    from firebase_admin import auth as firebase_auth, credentials as firebase_credentials
except Exception:
    firebase_admin = None
    firebase_auth = None
    firebase_credentials = None

ROOT_DIR = Path(__file__).parent
env_path = ROOT_DIR / '.env'
if env_path.exists():
    load_dotenv(env_path, override=True)
else:
    load_dotenv()  # Try loading from system environment

def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.lower() in ('1', 'true', 'yes', 'on')

def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f'{name} must be an integer')

def first_env(*names: str) -> Optional[str]:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None

def database_name_from_uri(uri: str) -> Optional[str]:
    try:
        parsed = urlparse(uri)
    except Exception:
        return None
    name = unquote((parsed.path or '').strip('/'))
    return name or None

def resolve_backend_path(raw_path: str) -> str:
    path = Path(raw_path)
    if path.is_absolute():
        return str(path)
    return str(ROOT_DIR / path)

APP_ENV = os.environ.get('PACKR_ENV') or os.environ.get('APP_ENV') or os.environ.get('ENVIRONMENT') or 'development'
IS_PRODUCTION = APP_ENV.lower() in ('prod', 'production')
FEATURE_PRO_ENABLED = env_bool('FEATURE_PRO_ENABLED', False)
UPLOAD_DIR = Path(os.environ.get('UPLOAD_DIR', ROOT_DIR / 'uploads'))
PUBLIC_UPLOAD_BASE_URL = os.environ.get('PUBLIC_UPLOAD_BASE_URL', '').rstrip('/')

MONGO_URL = first_env('MONGODB_URI', 'MONGO_URL', 'MONGO_URI')
if IS_PRODUCTION and not MONGO_URL:
    raise ValueError('MONGO_URL or MONGODB_URI must be set in production')
MONGO_URL = MONGO_URL or 'mongodb://localhost:27017'
db_name = first_env('DB_NAME', 'MONGODB_DB_NAME', 'MONGO_DB_NAME') or database_name_from_uri(MONGO_URL)
if IS_PRODUCTION and not db_name:
    raise ValueError('DB_NAME or a database name in MONGODB_URI must be set in production')
MONGO_SERVER_SELECTION_TIMEOUT_MS = env_int('MONGO_SERVER_SELECTION_TIMEOUT_MS', 5000)
client = AsyncIOMotorClient(
    MONGO_URL,
    appname=os.environ.get('MONGO_APP_NAME', 'packr-api'),
    serverSelectionTimeoutMS=MONGO_SERVER_SELECTION_TIMEOUT_MS,
    uuidRepresentation='standard',
)
db = client[db_name or 'test_database']
MONGO_PROVIDER = 'mongodb-atlas' if MONGO_URL.startswith('mongodb+srv://') or '.mongodb.net' in MONGO_URL else 'mongodb'

JWT_SECRET = os.environ.get('JWT_SECRET')
FIREBASE_AUTH_STRICT = env_bool('FIREBASE_AUTH_STRICT', IS_PRODUCTION)
ALLOW_LEGACY_AUTH = env_bool('ALLOW_LEGACY_AUTH', not FIREBASE_AUTH_STRICT)
if IS_PRODUCTION and ALLOW_LEGACY_AUTH:
    raise ValueError('ALLOW_LEGACY_AUTH must be disabled in production')
if ALLOW_LEGACY_AUTH and IS_PRODUCTION and not JWT_SECRET:
    raise ValueError('JWT_SECRET environment variable must be set in production')
JWT_SECRET = JWT_SECRET or 'packr-dev-secret-change-in-prod'
JWT_ALG = 'HS256'
JWT_EXPIRE_DAYS = 30
FIREBASE_AUTH_READY = False

CORS_ORIGINS_RAW = os.environ.get('CORS_ORIGINS', '')
if IS_PRODUCTION and (not CORS_ORIGINS_RAW or CORS_ORIGINS_RAW.strip() == '*'):
    raise ValueError('CORS_ORIGINS must list explicit HTTPS origins in production')
CORS_ORIGINS = [origin.strip() for origin in CORS_ORIGINS_RAW.split(',') if origin.strip()] or ['*']
if IS_PRODUCTION and any(not origin.startswith('https://') for origin in CORS_ORIGINS):
    raise ValueError('CORS_ORIGINS must use HTTPS origins in production')

app = FastAPI(title="Packr API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

# ========== RATE LIMITING (in-memory, per-process) ==========
# Enabled by default in production; override with RATE_LIMIT_ENABLED=1/0.
# Good enough for a single Render instance. If you ever scale to multiple
# instances, move the buckets to Redis.
RATE_LIMIT_ENABLED = env_bool('RATE_LIMIT_ENABLED', IS_PRODUCTION)
_RATE_BUCKETS: Dict[str, deque] = {}
_RATE_BUCKETS_MAX = 10_000

def _client_key(request: Request) -> str:
    forwarded = request.headers.get('x-forwarded-for', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.client.host if request.client else 'unknown'

def rate_limited(scope: str, limit: int, window_seconds: int = 60):
    """FastAPI dependency: sliding-window limit per client IP per scope."""
    async def dependency(request: Request) -> None:
        if not RATE_LIMIT_ENABLED:
            return
        now = datetime.now(timezone.utc).timestamp()
        cutoff = now - window_seconds
        key = f'{scope}:{_client_key(request)}'
        bucket = _RATE_BUCKETS.setdefault(key, deque())
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(429, 'Too many requests. Please wait a moment and try again.')
        bucket.append(now)
        if len(_RATE_BUCKETS) > _RATE_BUCKETS_MAX:
            stale = [k for k, v in _RATE_BUCKETS.items() if not v or v[-1] < cutoff]
            for k in stale:
                _RATE_BUCKETS.pop(k, None)
    return dependency

def init_firebase_auth() -> None:
    global FIREBASE_AUTH_READY
    if firebase_admin is None or firebase_auth is None:
        return
    if firebase_admin._apps:
        FIREBASE_AUTH_READY = True
        return
    project_id = os.environ.get('FIREBASE_PROJECT_ID')
    creds_json = os.environ.get('FIREBASE_CREDENTIALS_JSON')
    creds_b64 = os.environ.get('FIREBASE_CREDENTIALS_BASE64')
    creds_path = os.environ.get('FIREBASE_CREDENTIALS_PATH') or os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
    try:
        cred = None
        if creds_json:
            cred = firebase_credentials.Certificate(json.loads(creds_json))
        elif creds_b64:
            raw = base64.b64decode(creds_b64).decode('utf-8')
            cred = firebase_credentials.Certificate(json.loads(raw))
        elif creds_path:
            cred = firebase_credentials.Certificate(resolve_backend_path(creds_path))
        options = {'projectId': project_id} if project_id else None
        if cred:
            firebase_admin.initialize_app(cred, options)
            FIREBASE_AUTH_READY = True
        elif project_id or os.environ.get('GOOGLE_APPLICATION_CREDENTIALS'):
            firebase_admin.initialize_app(options=options)
            FIREBASE_AUTH_READY = True
    except Exception as e:
        logging.getLogger(__name__).warning(f'Firebase Auth init skipped: {e}')

init_firebase_auth()
if IS_PRODUCTION and FIREBASE_AUTH_STRICT and not FIREBASE_AUTH_READY:
    raise ValueError('Firebase Auth credentials must be configured in production')

# ========== MODELS ==========
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserPublic(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    is_pro: bool = False
    airline_profiles: List[Dict[str, Any]] = []
    created_at: datetime

class TokenResponse(BaseModel):
    token: str
    user: UserPublic

class WardrobeItemCreate(BaseModel):
    name: str
    category: str  # 'top' | 'bottom' | 'layer'
    image: str  # base64 or URL
    colors: List[str] = []
    weight_kg: float = 0.3
    tags: List[str] = []

class WardrobeItem(WardrobeItemCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class WardrobeItemUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    image: Optional[str] = None
    colors: Optional[List[str]] = None
    weight_kg: Optional[float] = None
    tags: Optional[List[str]] = None

class TripCreate(BaseModel):
    destination: str
    start_date: str  # ISO date
    end_date: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class Trip(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    destination: str
    start_date: str
    end_date: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    grid: List[Optional[str]] = Field(default_factory=lambda: [None] * 9)  # 9 wardrobe item ids
    favorites: List[Union[int, str]] = Field(default_factory=list)  # outfit keys favorited
    occasion_tags: Dict[str, str] = Field(default_factory=dict)  # outfit key -> occasion
    checklist_state: Dict[str, bool] = Field(default_factory=dict)  # itemKey -> checked
    extras: List[Dict[str, Any]] = Field(default_factory=list)  # essentials added
    outfit_plan: Dict[str, str] = Field(default_factory=dict)  # ISO date -> outfit key
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GridUpdate(BaseModel):
    grid: List[Optional[str]]

class FavoriteUpdate(BaseModel):
    outfit_index: Optional[int] = None
    outfit_key: Optional[str] = None
    is_favorite: bool

class OccasionUpdate(BaseModel):
    outfit_index: Optional[int] = None
    outfit_key: Optional[str] = None
    occasion: str

class ChecklistUpdate(BaseModel):
    item_key: str
    checked: bool

class OutfitPlanUpdate(BaseModel):
    date: str
    outfit_key: Optional[str] = None

class ExtraItem(BaseModel):
    name: str
    category: str  # 'toiletries' | 'documents' | 'chargers' | 'other'
    weight_kg: float = 0.1

class CommunityPostCreate(BaseModel):
    trip_id: str
    title: Optional[str] = Field(default=None, max_length=80)
    caption: str = Field(default='', max_length=220)
    visibility: Literal['public', 'followers', 'private'] = 'public'
    image_url: Optional[str] = None
    image_width: int = 0
    image_height: int = 0
    dominant_colors: List[str] = Field(default_factory=list)

class CommunityCommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)

class CommunityReportCreate(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)

class CommunityComment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    post_id: str
    user_id: str
    user_name: str
    text: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CommunityPost(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    author_id: str
    author_name: str
    trip_id: str
    title: str
    caption: str = ''
    visibility: Literal['public', 'followers', 'private'] = 'public'
    destination: str
    start_date: str
    end_date: str
    days: int
    image_url: str = ''
    image_width: int = 0
    image_height: int = 0
    dominant_colors: List[str] = Field(default_factory=list)
    grid: List[Optional[str]] = Field(default_factory=list)
    items_snapshot: List[Dict[str, Any]] = Field(default_factory=list)
    likes_count: int = 0
    comments_count: int = 0
    saves_count: int = 0
    is_liked: bool = False
    is_saved: bool = False
    is_following_author: bool = False
    latest_comments: List[CommunityComment] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SocialProfile(BaseModel):
    id: str
    name: Optional[str] = None
    is_following: bool = False
    is_friend: bool = False
    followers_count: int = 0
    following_count: int = 0
    posts_count: int = 0

class UploadImageRequest(BaseModel):
    image: str

class UploadImageResponse(BaseModel):
    url: str
    width: int
    height: int
    content_type: str

class AnalyticsEventCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    properties: Dict[str, Any] = Field(default_factory=dict)

class FeedbackCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    context: Optional[str] = Field(default=None, max_length=200)

class OutfitSuggestion(BaseModel):
    outfit_key: str
    outfit_index: int
    date: Optional[str] = None
    occasion: str
    score: int
    reason: str
    item_ids: List[str]
    item_names: List[str]

class TripStats(BaseModel):
    packing_score: int
    items_per_day: float
    outfit_variety: int
    most_used_color: Optional[str] = None
    completed_grid: bool
    planned_days: int
    trip_days: int
    checklist_progress: float
    total_weight_kg: float

class TripNudge(BaseModel):
    id: str
    kind: Literal['pre_trip', 'wardrobe_audit', 'post_trip', 'challenge']
    trip_id: Optional[str] = None
    title: str
    message: str
    action_route: str

class TripReflectionCreate(BaseModel):
    worn_outfit_keys: List[str] = Field(default_factory=list)
    unused_item_ids: List[str] = Field(default_factory=list)
    notes: str = Field(default='', max_length=1000)
    rating: Optional[int] = Field(default=None, ge=1, le=5)

class TripReflection(TripReflectionCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    trip_id: str
    user_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CommunityChallenge(BaseModel):
    id: str
    month: str
    title: str
    prompt: str
    destination: Optional[str] = None
    climate: Optional[str] = None
    posts_count: int = 0
    votes_count: int = 0

class TripInviteCreate(BaseModel):
    companion_name: Optional[str] = Field(default=None, max_length=80)

class TripInvite(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    trip_id: str
    owner_id: str
    code: str
    companion_name: Optional[str] = None
    status: Literal['pending', 'accepted'] = 'pending'
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ========== AUTH HELPERS ==========
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False

def create_token(user_id: str) -> str:
    payload = {
        'sub': user_id,
        'exp': datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
        'iat': datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def display_name(user: dict) -> str:
    name = (user.get('name') or '').strip()
    if name:
        return name
    return (user.get('email') or 'traveller').split('@')[0]

async def get_or_create_firebase_user(decoded: dict) -> dict:
    uid = decoded.get('uid') or decoded.get('sub')
    if not uid:
        raise HTTPException(401, 'Invalid Firebase token')
    email = (decoded.get('email') or f'{uid}@firebase.local').lower()
    provider = (decoded.get('firebase') or {}).get('sign_in_provider') or 'firebase'
    user = await db.users.find_one({'id': uid}, {'_id': 0})
    if user:
        updates = {
            'auth_provider': 'firebase',
            'firebase_uid': uid,
            'last_login_at': datetime.now(timezone.utc),
        }
        if user.get('email') != email:
            updates['email'] = email
        if decoded.get('email_verified') is not None:
            updates['email_verified'] = bool(decoded.get('email_verified'))
        if decoded.get('picture'):
            updates['photo_url'] = decoded.get('picture')
        if provider:
            updates['firebase_provider'] = provider
        if not user.get('name') and decoded.get('name'):
            updates['name'] = decoded.get('name')
        if not user.get('airline_profiles'):
            updates['airline_profiles'] = DEFAULT_AIRLINES
        await db.users.update_one({'id': uid}, {'$set': updates})
        user = await db.users.find_one({'id': uid}, {'_id': 0})
        return user

    user_doc = {
        'id': uid,
        'email': email,
        'password_hash': '',
        'name': decoded.get('name'),
        'auth_provider': 'firebase',
        'firebase_uid': uid,
        'firebase_provider': provider,
        'email_verified': bool(decoded.get('email_verified', False)),
        'photo_url': decoded.get('picture'),
        'is_pro': False,
        'airline_profiles': DEFAULT_AIRLINES,
        'created_at': datetime.now(timezone.utc),
        'last_login_at': datetime.now(timezone.utc),
    }
    await db.users.insert_one(user_doc.copy())
    return user_doc

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = creds.credentials
    if FIREBASE_AUTH_READY and firebase_auth is not None:
        try:
            decoded = firebase_auth.verify_id_token(token)
            return await get_or_create_firebase_user(decoded)
        except Exception:
            if FIREBASE_AUTH_STRICT:
                raise HTTPException(401, 'Invalid Firebase token')
    elif FIREBASE_AUTH_STRICT:
        raise HTTPException(503, 'Firebase Auth is not configured')

    if not ALLOW_LEGACY_AUTH:
        raise HTTPException(401, 'Firebase token required')

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get('sub')
        if not user_id:
            raise HTTPException(401, 'Invalid token')
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, 'Token expired')
    except jwt.PyJWTError:
        raise HTTPException(401, 'Invalid token')
    user = await db.users.find_one({'id': user_id}, {'_id': 0})
    if not user:
        raise HTTPException(401, 'User not found')
    return user

def user_public(u: dict) -> UserPublic:
    return UserPublic(
        id=u['id'],
        email=u['email'],
        name=u.get('name'),
        is_pro=bool(u.get('is_pro', False)),
        airline_profiles=u.get('airline_profiles') or DEFAULT_AIRLINES,
        created_at=u['created_at'],
    )

DEFAULT_AIRLINES: List[Dict[str, Any]] = [
    {'id': 'carry-on', 'name': 'Generic Carry-on', 'max_kg': 7.0},
    {'id': 'iata', 'name': 'IATA Standard', 'max_kg': 7.0},
]

CATEGORY_BY_SLOT = ['top', 'bottom', 'layer', 'bottom', 'layer', 'top', 'layer', 'top', 'bottom']
TOP_SLOTS = [0, 5, 7]
BOTTOM_SLOTS = [1, 3, 8]
LAYER_SLOTS = [2, 4, 6]

def category_for_slot(slot: int) -> str:
    return CATEGORY_BY_SLOT[slot]

# Client-supplied keys that end up inside Mongo update paths ($set on
# checklist_state.<key> / occasion_tags.<key>) must never contain '.' or '$',
# which would create nested fields or malformed operators.
SAFE_STATE_KEY_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9:_\-|]{0,127}$')

def validate_state_key(value: str, field: str) -> str:
    if not SAFE_STATE_KEY_RE.match(value or ''):
        raise HTTPException(400, f'{field} contains unsupported characters')
    return value

def validate_trip_dates(start_date: str, end_date: str) -> None:
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(400, 'Trip dates must use YYYY-MM-DD format')
    if end < start:
        raise HTTPException(400, 'Trip end date must be on or after start date')

def outfit_identity_key(payload: Any, *, for_tag: bool = False) -> Union[int, str]:
    key = getattr(payload, 'outfit_key', None)
    if key:
        return key
    index = getattr(payload, 'outfit_index', None)
    if index is None:
        raise HTTPException(400, 'outfit_key or outfit_index is required')
    if index < 0 or index > 26:
        raise HTTPException(400, 'outfit_index must be between 0 and 26')
    return str(index) if for_tag else index

def valid_outfit_keys(grid: List[Optional[str]]) -> set:
    if len(grid) != 9 or any(not grid[slot] for slot in TOP_SLOTS + BOTTOM_SLOTS + LAYER_SLOTS):
        return set()
    keys = set()
    for top_slot in TOP_SLOTS:
        for bottom_slot in BOTTOM_SLOTS:
            for layer_slot in LAYER_SLOTS:
                keys.add('|'.join([grid[top_slot], grid[bottom_slot], grid[layer_slot]]))
    return keys

def grid_outfits(grid: List[Optional[str]]) -> List[Dict[str, Any]]:
    outfits: List[Dict[str, Any]] = []
    if len(grid) != 9 or any(not grid[slot] for slot in TOP_SLOTS + BOTTOM_SLOTS + LAYER_SLOTS):
        return outfits
    index = 0
    for top_slot in TOP_SLOTS:
        for bottom_slot in BOTTOM_SLOTS:
            for layer_slot in LAYER_SLOTS:
                ids = [grid[top_slot], grid[bottom_slot], grid[layer_slot]]
                outfits.append({
                    'index': index,
                    'key': '|'.join(ids),
                    'item_ids': ids,
                    'slots': [top_slot, bottom_slot, layer_slot],
                })
                index += 1
    return outfits

def trip_date_range(start_date: str, end_date: str) -> List[str]:
    validate_trip_dates(start_date, end_date)
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    days: List[str] = []
    current = start
    while current <= end:
        days.append(current.isoformat())
        current += timedelta(days=1)
    return days

def item_tags(items: List[dict]) -> set:
    return {
        str(tag).lower().replace('#', '')
        for item in items
        for tag in (item.get('tags') or [])
    }

def destination_context_tags(trip: dict, day: Optional[str]) -> set:
    destination = (trip.get('destination') or '').lower()
    context = set()
    if any(word in destination for word in ['bali', 'singapore', 'miami', 'phuket', 'dubai', 'beach']):
        context.update(['tropical', 'beach'])
    if any(word in destination for word in ['reykjavik', 'iceland', 'alaska', 'ski', 'snow']):
        context.update(['snow', 'cold'])
    target_day = day or trip.get('start_date')
    try:
        month = date.fromisoformat(target_day).month
        if month in (12, 1, 2):
            context.add('cold')
        if month in (6, 7, 8):
            context.add('tropical')
    except Exception:
        pass
    return context

def score_outfit(
    outfit: Dict[str, Any],
    items_by_id: Dict[str, dict],
    trip: dict,
    day: Optional[str],
    occasion: Optional[str],
) -> OutfitSuggestion:
    items = [items_by_id[item_id] for item_id in outfit['item_ids'] if item_id in items_by_id]
    tags = item_tags(items)
    target = (occasion or '').lower()
    context = destination_context_tags(trip, day)
    score = 55
    reasons: List[str] = []

    if outfit['key'] in (trip.get('favorites') or []):
        score += 14
        reasons.append('favorited')
    if target:
        occasion_matches = {
            'formal': {'formal', 'business', 'modest'},
            'business': {'formal', 'business'},
            'travel': {'casual', 'tropical', 'beach', 'modest'},
            'active': {'gym', 'casual'},
            'casual': {'casual', 'denim', 'linen'},
            'modest': {'modest', 'layer', 'linen'},
        }.get(target, {target})
        hits = tags.intersection(occasion_matches)
        if hits:
            score += min(18, 6 * len(hits))
            reasons.append(f'{target} tags')
    climate_hits = tags.intersection(context)
    if climate_hits:
        score += min(15, 5 * len(climate_hits))
        reasons.append('destination fit')

    color_count: Dict[str, int] = {}
    for item in items:
        for color in item.get('colors') or []:
            color_count[color] = color_count.get(color, 0) + 1
    if any(count > 1 for count in color_count.values()):
        score += 8
        reasons.append('color repeat')

    total_weight = sum(float(item.get('weight_kg') or 0) for item in items)
    if total_weight <= 1.2:
        score += 5
        reasons.append('lightweight')

    if not reasons:
        reasons.append('balanced grid pick')
    names = [item.get('name', 'Item') for item in items]
    return OutfitSuggestion(
        outfit_key=outfit['key'],
        outfit_index=outfit['index'],
        date=day,
        occasion=occasion or 'Any',
        score=max(0, min(100, score)),
        reason=', '.join(reasons[:3]),
        item_ids=outfit['item_ids'],
        item_names=names,
    )

ESSENTIAL_KEYS = ['passport', 'wallet', 'phone-charger', 'toothbrush', 'shampoo', 'deodorant']

def compute_trip_stats(trip: dict, wardrobe_by_id: Dict[str, dict]) -> TripStats:
    grid = trip.get('grid') or []
    trip_days = days_between(trip.get('start_date'), trip.get('end_date'))
    grid_ids = [item_id for item_id in grid if item_id and item_id in wardrobe_by_id]
    completed_grid = len(grid_ids) == 9
    outfit_variety = 27 if completed_grid else 0
    planned_days = len(trip.get('outfit_plan') or {})
    checklist_state = trip.get('checklist_state') or {}
    extras = trip.get('extras') or []
    checklist_keys = [f'grid:{item_id}' for item_id in grid_ids] + [f'ess:{key}' for key in ESSENTIAL_KEYS] + [
        f"ext:{extra.get('id')}" for extra in extras if extra.get('id')
    ]
    checked = sum(1 for key in checklist_keys if checklist_state.get(key))
    checklist_progress = checked / len(checklist_keys) if checklist_keys else 0
    total_weight = sum(float(wardrobe_by_id[item_id].get('weight_kg') or 0) for item_id in grid_ids)
    total_weight += sum(float(extra.get('weight_kg') or 0) for extra in extras)
    color_counts: Dict[str, int] = {}
    for item_id in grid_ids:
        for color in wardrobe_by_id[item_id].get('colors') or []:
            color_counts[color] = color_counts.get(color, 0) + 1
    most_used_color = max(color_counts, key=color_counts.get) if color_counts else None
    grid_score = (len(grid_ids) / 9) * 35
    plan_score = (planned_days / trip_days) * 25 if trip_days else 0
    checklist_score = checklist_progress * 25
    weight_score = 15 if total_weight <= 7 else max(0, 15 - ((total_weight - 7) * 5))
    packing_score = round(min(100, grid_score + plan_score + checklist_score + weight_score))
    return TripStats(
        packing_score=packing_score,
        items_per_day=round(len(grid_ids) / trip_days, 2) if trip_days else 0,
        outfit_variety=outfit_variety,
        most_used_color=most_used_color,
        completed_grid=completed_grid,
        planned_days=planned_days,
        trip_days=trip_days,
        checklist_progress=round(checklist_progress, 2),
        total_weight_kg=round(total_weight, 2),
    )

def current_challenge_id() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m')

async def build_monthly_challenge() -> CommunityChallenge:
    month = current_challenge_id()
    posts_count = await db.community_posts.count_documents({'visibility': 'public'})
    votes_count = await db.challenge_votes.count_documents({'challenge_id': month})
    return CommunityChallenge(
        id=month,
        month=month,
        title='Monthly packing challenge',
        prompt='Pack 5 days with only neutrals. Share one screenshot post and vote for your favorite grids.',
        destination='Any destination',
        climate='mild',
        posts_count=posts_count,
        votes_count=votes_count,
    )

def clean_outfit_state_for_grid(trip: dict, grid: List[Optional[str]]) -> Dict[str, Any]:
    valid_keys = valid_outfit_keys(grid)
    if not valid_keys:
        return {'favorites': [], 'occasion_tags': {}, 'outfit_plan': {}}
    favorites = [
        fav for fav in trip.get('favorites', [])
        if isinstance(fav, str) and fav in valid_keys
    ]
    occasion_tags = {
        key: value
        for key, value in (trip.get('occasion_tags') or {}).items()
        if key in valid_keys
    }
    outfit_plan = {
        day: key
        for day, key in (trip.get('outfit_plan') or {}).items()
        if key in valid_keys
    }
    return {'favorites': favorites, 'occasion_tags': occasion_tags, 'outfit_plan': outfit_plan}

def clean_checklist_state_for_grid(trip: dict, grid: List[Optional[str]]) -> Dict[str, bool]:
    valid_grid_keys = {f'grid:{item_id}' for item_id in grid if item_id}
    cleaned: Dict[str, bool] = {}
    for key, value in (trip.get('checklist_state') or {}).items():
        if key.startswith('grid:'):
            suffix = key.split(':', 1)[1]
            if suffix.isdigit():
                continue
            if key in valid_grid_keys:
                cleaned[key] = bool(value)
            continue
        cleaned[key] = bool(value)
    return cleaned

async def validate_grid(grid: List[Optional[str]], user_id: str) -> None:
    if len(grid) != 9:
        raise HTTPException(400, 'Grid must have exactly 9 slots')
    item_ids = [item_id for item_id in grid if item_id]
    if len(item_ids) != len(set(item_ids)):
        raise HTTPException(400, 'Each grid item can only be used once')
    if not item_ids:
        return
    items = await db.wardrobe.find(
        {'user_id': user_id, 'id': {'$in': item_ids}},
        {'_id': 0}
    ).to_list(len(item_ids))
    items_by_id = {item['id']: item for item in items}
    missing = [item_id for item_id in item_ids if item_id not in items_by_id]
    if missing:
        raise HTTPException(400, 'Grid contains items outside your wardrobe')
    for slot, item_id in enumerate(grid):
        if not item_id:
            continue
        expected = category_for_slot(slot)
        actual = items_by_id[item_id].get('category')
        if actual != expected:
            raise HTTPException(400, f'Slot {slot + 1} expects {expected}, found {actual}')

def normalize_template_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    first_nine = list(items[:9])
    if len(first_nine) != 9:
        return first_nine
    if [item.get('category') for item in first_nine] == CATEGORY_BY_SLOT:
        return first_nine
    buckets = {
        'top': [item for item in first_nine if item.get('category') == 'top'],
        'bottom': [item for item in first_nine if item.get('category') == 'bottom'],
        'layer': [item for item in first_nine if item.get('category') == 'layer'],
    }
    if any(len(buckets[category]) < 3 for category in buckets):
        return first_nine
    arranged = []
    used = {'top': 0, 'bottom': 0, 'layer': 0}
    for category in CATEGORY_BY_SLOT:
        arranged.append(buckets[category][used[category]])
        used[category] += 1
    return arranged

def days_between(start_date: str, end_date: str) -> int:
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
        return max(1, (end - start).days + 1)
    except ValueError:
        return 1

def clean_social_text(value: Optional[str], *, field: str, max_length: int, allow_empty: bool = True) -> str:
    text = ' '.join((value or '').split())
    if not text and not allow_empty:
        raise HTTPException(400, f'{field} cannot be empty')
    if len(text) > max_length:
        raise HTTPException(400, f'{field} must be {max_length} characters or less')
    return text

def normalize_wardrobe_category(category: str) -> str:
    value = (category or '').strip().lower()
    if value not in ('top', 'bottom', 'layer'):
        raise HTTPException(400, 'category must be top, bottom, or layer')
    return value

def normalize_wardrobe_tags(tags: Optional[List[str]]) -> List[str]:
    normalized: List[str] = []
    for raw in tags or []:
        value = str(raw).strip().lower().replace('#', '')
        value = ''.join(ch if ch.isalnum() or ch in ('-', '_') else '-' for ch in value)
        value = '-'.join(part for part in value.split('-') if part)[:24]
        if value and value not in normalized:
            normalized.append(value)
        if len(normalized) >= 12:
            break
    return normalized

def normalize_colors(colors: Optional[List[str]]) -> List[str]:
    cleaned: List[str] = []
    for color in colors or []:
        value = str(color).strip()
        if value and value not in cleaned:
            cleaned.append(value[:32])
        if len(cleaned) >= 6:
            break
    return cleaned

async def clear_invalid_grid_slots_for_item(item_id: str, category: str, user_id: str) -> None:
    affected = await db.trips.find({'user_id': user_id, 'grid': item_id}, {'_id': 0}).to_list(200)
    for trip in affected:
        grid = list(trip.get('grid') or [])
        changed = False
        for slot, current in enumerate(grid):
            if current == item_id and category_for_slot(slot) != category:
                grid[slot] = None
                changed = True
        if not changed:
            continue
        clean_state = clean_outfit_state_for_grid(trip, grid)
        checklist_state = clean_checklist_state_for_grid(trip, grid)
        await db.trips.update_one(
            {'id': trip['id'], 'user_id': user_id},
            {'$set': {**clean_state, 'grid': grid, 'checklist_state': checklist_state}},
        )

async def can_view_post(post: dict, user_id: str) -> bool:
    if post.get('author_id') == user_id:
        return True
    visibility = post.get('visibility', 'public')
    if visibility == 'public':
        return True
    if visibility == 'followers':
        return bool(await db.follows.find_one({
            'follower_id': user_id,
            'following_id': post.get('author_id'),
        }))
    return False

async def sync_post_counts(post: dict) -> dict:
    post_id = post['id']
    counts = {
        'likes_count': await db.post_likes.count_documents({'post_id': post_id}),
        'comments_count': await db.comments.count_documents({'post_id': post_id}),
        'saves_count': await db.post_saves.count_documents({'post_id': post_id}),
    }
    if any(post.get(key, 0) != value for key, value in counts.items()):
        await db.community_posts.update_one({'id': post_id}, {'$set': counts})
        post = {**post, **counts}
    return post

async def enrich_post(post: dict, user_id: str) -> CommunityPost:
    post = await sync_post_counts(post)
    post_id = post['id']
    author_id = post['author_id']
    stored_post = {
        key: value
        for key, value in post.items()
        if key not in {'_id', 'is_liked', 'is_saved', 'is_following_author', 'latest_comments'}
    }
    latest_comments = await db.comments.find(
        {'post_id': post_id},
        {'_id': 0}
    ).sort('created_at', -1).to_list(3)
    latest_comments.reverse()
    is_liked = bool(await db.post_likes.find_one({'post_id': post_id, 'user_id': user_id}))
    is_saved = bool(await db.post_saves.find_one({'post_id': post_id, 'user_id': user_id}))
    is_following = bool(await db.follows.find_one({'follower_id': user_id, 'following_id': author_id}))
    return CommunityPost(
        **stored_post,
        is_liked=is_liked,
        is_saved=is_saved,
        is_following_author=is_following,
        latest_comments=[CommunityComment(**comment) for comment in latest_comments],
    )

async def get_visible_post(post_id: str, user_id: str) -> dict:
    post = await db.community_posts.find_one({'id': post_id}, {'_id': 0})
    if not post or not await can_view_post(post, user_id):
        raise HTTPException(404, 'Community post not found')
    return post

async def upsert_social_edge(collection, filter_doc: dict, insert_doc: dict) -> bool:
    try:
        result = await collection.update_one(
            filter_doc,
            {'$setOnInsert': insert_doc},
            upsert=True,
        )
        return bool(result.upserted_id)
    except DuplicateKeyError:
        return False

async def visible_post_count_for_author(author_id: str, viewer_id: str) -> int:
    if author_id == viewer_id:
        return await db.community_posts.count_documents({'author_id': author_id})
    is_following = bool(await db.follows.find_one({'follower_id': viewer_id, 'following_id': author_id}))
    visibilities = ['public', 'followers'] if is_following else ['public']
    return await db.community_posts.count_documents({
        'author_id': author_id,
        'visibility': {'$in': visibilities},
    })

async def social_profile_for(uid: str, viewer_id: str) -> SocialProfile:
    user = await db.users.find_one({'id': uid}, {'_id': 0})
    if not user:
        raise HTTPException(404, 'User not found')
    is_following = bool(await db.follows.find_one({'follower_id': viewer_id, 'following_id': uid}))
    follows_back = bool(await db.follows.find_one({'follower_id': uid, 'following_id': viewer_id}))
    return SocialProfile(
        id=user['id'],
        name=user.get('name'),
        is_following=is_following,
        is_friend=is_following and follows_back,
        followers_count=await db.follows.count_documents({'following_id': uid}),
        following_count=await db.follows.count_documents({'follower_id': uid}),
        posts_count=await visible_post_count_for_author(uid, viewer_id),
    )

# ========== AUTH ROUTES ==========
@api_router.post("/auth/register", response_model=TokenResponse, dependencies=[Depends(rate_limited('auth', 10))])
async def register(payload: UserRegister):
    if not ALLOW_LEGACY_AUTH:
        raise HTTPException(status.HTTP_410_GONE, 'Password auth is disabled; use Firebase Auth')
    existing = await db.users.find_one({'email': payload.email.lower()})
    if existing:
        raise HTTPException(400, 'Email already registered')
    user_doc = {
        'id': str(uuid.uuid4()),
        'email': payload.email.lower(),
        'password_hash': hash_password(payload.password),
        'name': payload.name,
        'is_pro': False,
        'airline_profiles': DEFAULT_AIRLINES,
        'created_at': datetime.now(timezone.utc),
    }
    await db.users.insert_one(user_doc.copy())
    return TokenResponse(token=create_token(user_doc['id']), user=user_public(user_doc))

@api_router.post("/auth/login", response_model=TokenResponse, dependencies=[Depends(rate_limited('auth', 10))])
async def login(payload: UserLogin):
    if not ALLOW_LEGACY_AUTH:
        raise HTTPException(status.HTTP_410_GONE, 'Password auth is disabled; use Firebase Auth')
    user = await db.users.find_one({'email': payload.email.lower()}, {'_id': 0})
    if not user or not verify_password(payload.password, user.get('password_hash', '')):
        raise HTTPException(401, 'Invalid email or password')
    return TokenResponse(token=create_token(user['id']), user=user_public(user))

@api_router.get("/auth/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    # Ensure default airline profiles are present (idempotent legacy backfill)
    profiles = user.get('airline_profiles') or []
    have_ids = {p.get('id') for p in profiles}
    needs = [p for p in DEFAULT_AIRLINES if p['id'] not in have_ids]
    if needs:
        await db.users.update_one(
            {'id': user['id']},
            {'$push': {'airline_profiles': {'$each': needs, '$position': 0}}}
        )
        user = await db.users.find_one({'id': user['id']}, {'_id': 0})
    return user_public(user)

# ========== WARDROBE ROUTES ==========
@api_router.get("/wardrobe", response_model=List[WardrobeItem])
async def list_wardrobe(user: dict = Depends(get_current_user)):
    items = await db.wardrobe.find({'user_id': user['id']}, {'_id': 0}).sort('created_at', -1).to_list(500)
    return [WardrobeItem(**i) for i in items]

@api_router.post("/wardrobe", response_model=WardrobeItem)
async def create_wardrobe_item(payload: WardrobeItemCreate, user: dict = Depends(get_current_user)):
    data = payload.dict()
    data['name'] = clean_social_text(data.get('name'), field='Name', max_length=80, allow_empty=False)
    data['category'] = normalize_wardrobe_category(data.get('category', ''))
    data['tags'] = normalize_wardrobe_tags(data.get('tags'))
    data['colors'] = normalize_colors(data.get('colors'))
    item = WardrobeItem(user_id=user['id'], **data)
    await db.wardrobe.insert_one(item.dict())
    return item

@api_router.put("/wardrobe/{item_id}", response_model=WardrobeItem)
async def update_wardrobe_item(
    item_id: str,
    payload: WardrobeItemUpdate,
    user: dict = Depends(get_current_user),
):
    existing = await db.wardrobe.find_one({'id': item_id, 'user_id': user['id']}, {'_id': 0})
    if not existing:
        raise HTTPException(404, 'Item not found')

    update: Dict[str, Any] = {}
    if payload.name is not None:
        update['name'] = clean_social_text(payload.name, field='Name', max_length=80, allow_empty=False)
    if payload.category is not None:
        update['category'] = normalize_wardrobe_category(payload.category)
    if payload.image is not None:
        update['image'] = payload.image
    if payload.colors is not None:
        update['colors'] = normalize_colors(payload.colors)
    if payload.weight_kg is not None:
        if payload.weight_kg < 0:
            raise HTTPException(400, 'weight_kg must be 0 or greater')
        update['weight_kg'] = min(payload.weight_kg, 50)
    if payload.tags is not None:
        update['tags'] = normalize_wardrobe_tags(payload.tags)

    if update:
        await db.wardrobe.update_one({'id': item_id, 'user_id': user['id']}, {'$set': update})
        if update.get('category') and update['category'] != existing.get('category'):
            await clear_invalid_grid_slots_for_item(item_id, update['category'], user['id'])

    item = await db.wardrobe.find_one({'id': item_id, 'user_id': user['id']}, {'_id': 0})
    return WardrobeItem(**item)

@api_router.delete("/wardrobe/{item_id}")
async def delete_wardrobe_item(item_id: str, user: dict = Depends(get_current_user)):
    res = await db.wardrobe.delete_one({'id': item_id, 'user_id': user['id']})
    if res.deleted_count == 0:
        raise HTTPException(404, 'Item not found')
    affected = await db.trips.find({'user_id': user['id'], 'grid': item_id}, {'_id': 0}).to_list(200)
    for trip in affected:
        grid = [None if slot == item_id else slot for slot in (trip.get('grid') or [])]
        clean_state = clean_outfit_state_for_grid(trip, grid)
        checklist_state = clean_checklist_state_for_grid(trip, grid)
        await db.trips.update_one(
            {'id': trip['id'], 'user_id': user['id']},
            {'$set': {**clean_state, 'grid': grid, 'checklist_state': checklist_state}}
        )
    return {'ok': True}

# ========== TRIP ROUTES ==========
@api_router.get("/trips", response_model=List[Trip])
async def list_trips(user: dict = Depends(get_current_user)):
    trips = await db.trips.find({'user_id': user['id']}, {'_id': 0}).sort('start_date', 1).to_list(200)
    return [Trip(**t) for t in trips]

@api_router.post("/trips", response_model=Trip)
async def create_trip(payload: TripCreate, user: dict = Depends(get_current_user)):
    validate_trip_dates(payload.start_date, payload.end_date)
    if FEATURE_PRO_ENABLED and not user.get('is_pro', False):
        existing = await db.trips.count_documents({'user_id': user['id']})
        if existing >= FREE_TRIP_CAP:
            raise HTTPException(
                402,
                f'Free tier is capped at {FREE_TRIP_CAP} trips. Upgrade to Packr Pro for unlimited.'
            )
    trip = Trip(user_id=user['id'], **payload.dict())
    await db.trips.insert_one(trip.dict())
    return trip

@api_router.get("/trips/{trip_id}", response_model=Trip)
async def get_trip(trip_id: str, user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    return Trip(**trip)

@api_router.delete("/trips/{trip_id}")
async def delete_trip(trip_id: str, user: dict = Depends(get_current_user)):
    res = await db.trips.delete_one({'id': trip_id, 'user_id': user['id']})
    if res.deleted_count == 0:
        raise HTTPException(404, 'Trip not found')
    return {'ok': True}

@api_router.put("/trips/{trip_id}/grid", response_model=Trip)
async def update_grid(trip_id: str, payload: GridUpdate, user: dict = Depends(get_current_user)):
    await validate_grid(payload.grid, user['id'])
    existing = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not existing:
        raise HTTPException(404, 'Trip not found')
    update_fields = {'grid': payload.grid}
    if payload.grid != existing.get('grid'):
        update_fields.update(clean_outfit_state_for_grid(existing, payload.grid))
        update_fields['checklist_state'] = clean_checklist_state_for_grid(existing, payload.grid)
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$set': update_fields}
    )
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    return Trip(**trip)

@api_router.put("/trips/{trip_id}/favorite", response_model=Trip)
async def update_favorite(trip_id: str, payload: FavoriteUpdate, user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    key = outfit_identity_key(payload)
    valid_keys = valid_outfit_keys(trip.get('grid') or [])
    if isinstance(key, str) and valid_keys and key not in valid_keys:
        raise HTTPException(400, 'outfit_key does not match this grid')
    favs = set(trip.get('favorites', []))
    if payload.is_favorite:
        favs.add(key)
    else:
        favs.discard(key)
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$set': {'favorites': sorted(list(favs), key=str)}}
    )
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    return Trip(**trip)

@api_router.put("/trips/{trip_id}/occasion", response_model=Trip)
async def update_occasion(trip_id: str, payload: OccasionUpdate, user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    key = outfit_identity_key(payload, for_tag=True)
    validate_state_key(str(key), 'outfit_key')
    valid_keys = valid_outfit_keys(trip.get('grid') or [])
    if isinstance(key, str) and '|' in key and valid_keys and key not in valid_keys:
        raise HTTPException(400, 'outfit_key does not match this grid')
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$set': {f'occasion_tags.{key}': payload.occasion}}
    )
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    return Trip(**trip)

@api_router.put("/trips/{trip_id}/outfit-plan", response_model=Trip)
async def update_outfit_plan(trip_id: str, payload: OutfitPlanUpdate, user: dict = Depends(get_current_user)):
    validate_trip_dates(payload.date, payload.date)
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    if payload.date < trip['start_date'] or payload.date > trip['end_date']:
        raise HTTPException(400, 'date must be within the trip dates')
    plan = dict(trip.get('outfit_plan') or {})
    if payload.outfit_key:
        valid_keys = valid_outfit_keys(trip.get('grid') or [])
        if valid_keys and payload.outfit_key not in valid_keys:
            raise HTTPException(400, 'outfit_key does not match this grid')
        plan[payload.date] = payload.outfit_key
    else:
        plan.pop(payload.date, None)
    await db.trips.update_one({'id': trip_id, 'user_id': user['id']}, {'$set': {'outfit_plan': plan}})
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    return Trip(**trip)

@api_router.get("/trips/{trip_id}/outfit-suggestions", response_model=List[OutfitSuggestion])
async def outfit_suggestions(
    trip_id: str,
    date: Optional[str] = None,
    occasion: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    if date:
        validate_trip_dates(date, date)
        if date < trip['start_date'] or date > trip['end_date']:
            raise HTTPException(400, 'date must be within the trip dates')
    outfits = grid_outfits(trip.get('grid') or [])
    if not outfits:
        return []
    item_ids = list({item_id for outfit in outfits for item_id in outfit['item_ids']})
    wardrobe = await db.wardrobe.find(
        {'user_id': user['id'], 'id': {'$in': item_ids}},
        {'_id': 0},
    ).to_list(20)
    by_id = {item['id']: item for item in wardrobe}
    suggestions = [
        score_outfit(outfit, by_id, trip, date, occasion)
        for outfit in outfits
        if all(item_id in by_id for item_id in outfit['item_ids'])
    ]
    suggestions.sort(key=lambda item: (-item.score, item.outfit_index))
    return suggestions[:5]

@api_router.get("/trips/{trip_id}/stats", response_model=TripStats)
async def trip_stats(trip_id: str, user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    grid_ids = [item_id for item_id in (trip.get('grid') or []) if item_id]
    wardrobe = await db.wardrobe.find(
        {'user_id': user['id'], 'id': {'$in': grid_ids}},
        {'_id': 0},
    ).to_list(20)
    return compute_trip_stats(trip, {item['id']: item for item in wardrobe})

@api_router.post("/trips/{trip_id}/reflections", response_model=TripReflection)
async def create_trip_reflection(
    trip_id: str,
    payload: TripReflectionCreate,
    user: dict = Depends(get_current_user),
):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    valid_keys = valid_outfit_keys(trip.get('grid') or [])
    invalid_outfits = [key for key in payload.worn_outfit_keys if valid_keys and key not in valid_keys]
    if invalid_outfits:
        raise HTTPException(400, 'worn_outfit_keys must match this trip grid')
    grid_ids = set(item_id for item_id in (trip.get('grid') or []) if item_id)
    invalid_items = [item_id for item_id in payload.unused_item_ids if item_id not in grid_ids]
    if invalid_items:
        raise HTTPException(400, 'unused_item_ids must come from this trip grid')
    reflection = TripReflection(trip_id=trip_id, user_id=user['id'], **payload.dict())
    await db.trip_reflections.insert_one(reflection.dict())
    return reflection

@api_router.get("/trips/{trip_id}/reflections", response_model=List[TripReflection])
async def list_trip_reflections(trip_id: str, user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    docs = await db.trip_reflections.find(
        {'trip_id': trip_id, 'user_id': user['id']},
        {'_id': 0},
    ).sort('created_at', -1).to_list(50)
    return [TripReflection(**doc) for doc in docs]

@api_router.get("/trips/{trip_id}/invites", response_model=List[TripInvite])
async def list_trip_invites(trip_id: str, user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    docs = await db.trip_invites.find(
        {'trip_id': trip_id, 'owner_id': user['id']},
        {'_id': 0},
    ).sort('created_at', -1).to_list(50)
    return [TripInvite(**doc) for doc in docs]

@api_router.post("/trips/{trip_id}/invites", response_model=TripInvite)
async def create_trip_invite(
    trip_id: str,
    payload: TripInviteCreate,
    user: dict = Depends(get_current_user),
):
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    seed = f"{trip.get('destination', 'trip')}-{str(uuid.uuid4())[:6]}"
    code = re.sub(r'[^A-Z0-9]', '', seed.upper())[:10]
    invite = TripInvite(
        trip_id=trip_id,
        owner_id=user['id'],
        companion_name=(payload.companion_name or '').strip() or None,
        code=code,
    )
    await db.trip_invites.insert_one(invite.dict())
    return invite

@api_router.put("/trips/{trip_id}/checklist", response_model=Trip)
async def update_checklist(trip_id: str, payload: ChecklistUpdate, user: dict = Depends(get_current_user)):
    validate_state_key(payload.item_key, 'item_key')
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$set': {f'checklist_state.{payload.item_key}': payload.checked}}
    )
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    return Trip(**trip)

@api_router.post("/trips/{trip_id}/extras", response_model=Trip)
async def add_extra(trip_id: str, payload: ExtraItem, user: dict = Depends(get_current_user)):
    extra = {'id': str(uuid.uuid4()), **payload.dict()}
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$push': {'extras': extra}}
    )
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    return Trip(**trip)

@api_router.delete("/trips/{trip_id}/extras/{extra_id}", response_model=Trip)
async def remove_extra(trip_id: str, extra_id: str, user: dict = Depends(get_current_user)):
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$pull': {'extras': {'id': extra_id}}}
    )
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    return Trip(**trip)

# ========== WEATHER (Open-Meteo) ==========
@api_router.get("/weather", dependencies=[Depends(rate_limited('geo', 60))])
async def weather(latitude: float, longitude: float, start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Geocoding -> forecast via Open-Meteo. No API key required."""
    params = {
        'latitude': latitude,
        'longitude': longitude,
        'daily': 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
        'timezone': 'auto',
    }
    if start_date and end_date:
        validate_trip_dates(start_date, end_date)
        params['start_date'] = start_date
        params['end_date'] = end_date
    else:
        params['forecast_days'] = 14
    try:
        return await cached_http_get_json('https://api.open-meteo.com/v1/forecast', params)
    except HTTPException:
        if start_date and end_date:
            fallback = dict(params)
            fallback.pop('start_date', None)
            fallback.pop('end_date', None)
            fallback['forecast_days'] = 14
            return await cached_http_get_json('https://api.open-meteo.com/v1/forecast', fallback)
        raise HTTPException(502, 'Weather service error')

@api_router.get("/geocode", dependencies=[Depends(rate_limited('geo', 60))])
async def geocode(q: str):
    """City search via Open-Meteo geocoding."""
    data = await cached_http_get_json(
        'https://geocoding-api.open-meteo.com/v1/search',
        {'name': q, 'count': 5, 'language': 'en'},
    )
    results = []
    for item in data.get('results', []):
        results.append({
            'name': item.get('name'),
            'country': item.get('country'),
            'admin1': item.get('admin1'),
            'latitude': item.get('latitude'),
            'longitude': item.get('longitude'),
        })
    return {'results': results}

@api_router.get("/")
async def root():
    return {'service': 'Packr', 'status': 'ok'}

@api_router.get("/health")
async def health():
    try:
        await db.command('ping')
    except Exception:
        raise HTTPException(
            503,
            {
                'service': 'Packr',
                'status': 'degraded',
                'database': {'provider': MONGO_PROVIDER, 'name': db.name, 'status': 'error'},
                'auth': {'firebase_ready': FIREBASE_AUTH_READY, 'legacy_enabled': ALLOW_LEGACY_AUTH},
            },
        )
    return {
        'service': 'Packr',
        'status': 'ok',
        'database': {'provider': MONGO_PROVIDER, 'name': db.name, 'status': 'ok'},
        'auth': {'firebase_ready': FIREBASE_AUTH_READY, 'legacy_enabled': ALLOW_LEGACY_AUTH},
    }

# ========== IMAGE PROCESSING / UPLOADS ==========
class PaletteRequest(BaseModel):
    image: str  # data:image/jpeg;base64,... or raw base64

FREE_TRIP_CAP = 2
MAX_IMAGE_BYTES = 4 * 1024 * 1024  # 4 MB decoded
RESAMPLE_LANCZOS = Image.Resampling.LANCZOS if hasattr(Image, 'Resampling') else Image.LANCZOS
HTTP_JSON_CACHE: Dict[str, Dict[str, Any]] = {}
HTTP_JSON_CACHE_TTL_SECONDS = 60 * 60

async def cached_http_get_json(url: str, params: Dict[str, Any], ttl_seconds: int = HTTP_JSON_CACHE_TTL_SECONDS) -> Dict[str, Any]:
    cache_key = f"{url}?{sorted((key, str(value)) for key, value in params.items())}"
    now = datetime.now(timezone.utc)
    cached = HTTP_JSON_CACHE.get(cache_key)
    if cached and (now - cached['created_at']).total_seconds() < ttl_seconds:
        return cached['data']

    last_status = 0
    async with httpx.AsyncClient(timeout=10) as cli:
        for attempt in range(3):
            r = await cli.get(url, params=params)
            last_status = r.status_code
            if r.status_code == 200:
                data = r.json()
                HTTP_JSON_CACHE[cache_key] = {'created_at': now, 'data': data}
                return data
            if r.status_code not in (429, 500, 502, 503, 504):
                break
            if attempt < 2:
                await asyncio.sleep(0.25 * (2 ** attempt))
    raise HTTPException(502, f'External service error ({last_status})')

def decode_image_payload(raw: str) -> bytes:
    if ',' in raw and raw.startswith('data:'):
        raw = raw.split(',', 1)[1]
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(413, 'Image too large (max ~6 MB)')
    data = base64.b64decode(raw, validate=False)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, f'Image too large (max {MAX_IMAGE_BYTES // (1024 * 1024)} MB)')
    return data

def public_upload_url(path: Path) -> str:
    relative = path.relative_to(UPLOAD_DIR).as_posix()
    if PUBLIC_UPLOAD_BASE_URL:
        return f'{PUBLIC_UPLOAD_BASE_URL}/uploads/{relative}'
    return f'/uploads/{relative}'

def resolve_local_upload_path(url: str) -> Optional[Path]:
    if not url or url.startswith('data:'):
        return None
    parsed = urlparse(url)
    path_value = unquote(parsed.path if parsed.scheme else url)
    if path_value.startswith('/uploads/'):
        relative = path_value[len('/uploads/'):]
    elif path_value.startswith('uploads/'):
        relative = path_value[len('uploads/'):]
    else:
        return None
    if not relative or '..' in Path(relative).parts:
        return None
    base = UPLOAD_DIR.resolve()
    target = (UPLOAD_DIR / relative).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    return target if target.is_file() else None

def load_item_image(image_value: str) -> Optional[Image.Image]:
    if not image_value:
        return None
    try:
        if image_value.startswith('data:'):
            data = decode_image_payload(image_value)
            return Image.open(io.BytesIO(data)).convert('RGBA')
        path = resolve_local_upload_path(image_value)
        if path:
            return Image.open(path).convert('RGBA')
    except Exception:
        return None
    return None

def render_font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        'arialbd.ttf' if bold else 'arial.ttf',
        'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf',
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()

def fit_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int) -> str:
    value = ' '.join((text or '').split())[:120]
    if draw.textlength(value, font=font) <= max_width:
        return value
    while value and draw.textlength(f'{value}...', font=font) > max_width:
        value = value[:-1]
    return f'{value}...' if value else ''

def item_dominant_colors(items: List[dict]) -> List[str]:
    colors: List[str] = []
    for item in items:
        for color in item.get('colors') or []:
            value = str(color).strip()
            if re.match(r'^#[0-9A-Fa-f]{6}$', value) and value.upper() not in colors:
                colors.append(value.upper())
            if len(colors) >= 9:
                return colors
    return colors

def category_color(category: str) -> str:
    return {
        'top': '#7C8F75',
        'bottom': '#4F6E85',
        'layer': '#A66A4B',
    }.get(category, '#777777')

def hex_to_rgb(value: str) -> tuple:
    value = value.strip().lstrip('#')
    try:
        return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return (120, 120, 120)

def paste_contained(base: Image.Image, source: Image.Image, box: tuple) -> None:
    left, top, right, bottom = box
    max_size = (max(1, right - left), max(1, bottom - top))
    thumb = ImageOps.contain(source, max_size, RESAMPLE_LANCZOS)
    x = left + (max_size[0] - thumb.width) // 2
    y = top + (max_size[1] - thumb.height) // 2
    if thumb.mode == 'RGBA':
        base.paste(thumb.convert('RGB'), (x, y), thumb.getchannel('A'))
    else:
        base.paste(thumb.convert('RGB'), (x, y))

def render_community_post_image(user: dict, trip: dict, grid: List[str], by_id: Dict[str, dict], title: str) -> Dict[str, Any]:
    width, height = 720, 900
    canvas = Image.new('RGB', (width, height), '#F7F5F0')
    draw = ImageDraw.Draw(canvas)
    title_font = render_font(34, bold=True)
    meta_font = render_font(18)
    label_font = render_font(14, bold=True)
    name_font = render_font(16, bold=True)

    margin = 44
    draw.text((margin, 36), fit_text(draw, title, title_font, width - margin * 2), font=title_font, fill='#1F1F1F')
    meta = f"{trip.get('destination', 'Trip')} - {days_between(trip.get('start_date', ''), trip.get('end_date', ''))} days"
    draw.text((margin, 82), fit_text(draw, meta, meta_font, width - margin * 2), font=meta_font, fill='#66615B')
    draw.text((margin, 112), fit_text(draw, f"by {display_name(user)}", meta_font, width - margin * 2), font=meta_font, fill='#8A8178')

    grid_left = margin
    grid_top = 158
    gap = 12
    cell = (width - margin * 2 - gap * 2) // 3
    ordered_items = [by_id[item_id] for item_id in grid if item_id in by_id]

    for slot, item_id in enumerate(grid):
        item = by_id[item_id]
        row = slot // 3
        col = slot % 3
        x = grid_left + col * (cell + gap)
        y = grid_top + row * (cell + gap)
        category = item.get('category') or CATEGORY_BY_SLOT[slot]
        accent = category_color(category)
        fill = tuple(min(255, int(channel * 0.12 + 238)) for channel in hex_to_rgb(accent))
        draw.rounded_rectangle((x, y, x + cell, y + cell), radius=18, fill=fill, outline=accent, width=2)
        draw.rounded_rectangle((x + 12, y + 12, x + 82, y + 36), radius=10, fill=accent)
        draw.text((x + 22, y + 17), category.upper(), font=label_font, fill='#FFFFFF')

        image = load_item_image(item.get('image', ''))
        if image:
            paste_contained(canvas, image, (x + 18, y + 44, x + cell - 18, y + cell - 42))
        else:
            draw.text((x + 22, y + 86), category.upper(), font=label_font, fill=accent)

        name = fit_text(draw, item.get('name') or category, name_font, cell - 28)
        draw.text((x + 14, y + cell - 30), name, font=name_font, fill='#2A2826')

    colors = item_dominant_colors(ordered_items)
    swatch_y = grid_top + cell * 3 + gap * 2 + 34
    draw.text((margin, swatch_y), 'Palette', font=label_font, fill='#66615B')
    swatch_x = margin + 86
    for index, color in enumerate(colors[:9]):
        x = swatch_x + index * 30
        draw.ellipse((x, swatch_y - 2, x + 22, swatch_y + 20), fill=color, outline='#D6D0C8', width=1)

    footer = f"{trip.get('start_date', '')} - {trip.get('end_date', '')}"
    draw.text((margin, height - 48), fit_text(draw, footer, meta_font, width - margin * 2), font=meta_font, fill='#8A8178')

    target_dir = UPLOAD_DIR / 'community' / user['id']
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f'{uuid.uuid4().hex}.jpg'
    canvas.save(target, format='JPEG', quality=78, optimize=True)
    return {
        'url': public_upload_url(target),
        'width': width,
        'height': height,
        'content_type': 'image/jpeg',
        'dominant_colors': colors,
    }

def delete_community_post_image(url: str) -> None:
    path = resolve_local_upload_path(url)
    if not path:
        return
    community_dir = (UPLOAD_DIR / 'community').resolve()
    try:
        path.resolve().relative_to(community_dir)
    except ValueError:
        return
    try:
        path.unlink(missing_ok=True)
    except Exception:
        logging.warning('Could not delete community image %s', path)

def owned_community_upload(url: str, user_id: str) -> bool:
    path = resolve_local_upload_path(url)
    if not path:
        return False
    user_dir = (UPLOAD_DIR / 'community' / user_id).resolve()
    try:
        path.resolve().relative_to(user_dir)
        return True
    except ValueError:
        return False

@api_router.post('/uploads/wardrobe-image', response_model=UploadImageResponse, dependencies=[Depends(rate_limited('upload', 30))])
async def upload_wardrobe_image(payload: UploadImageRequest, user: dict = Depends(get_current_user)):
    try:
        data = decode_image_payload(payload.image)
        img = Image.open(io.BytesIO(data)).convert('RGB')
        img.thumbnail((1280, 1280))
        user_dir = UPLOAD_DIR / 'wardrobe' / user['id']
        user_dir.mkdir(parents=True, exist_ok=True)
        target = user_dir / f'{uuid.uuid4().hex}.jpg'
        img.save(target, format='JPEG', quality=82, optimize=True)
        return UploadImageResponse(
            url=public_upload_url(target),
            width=img.width,
            height=img.height,
            content_type='image/jpeg',
        )
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(413, 'Image is too large to process safely')
    except Exception as e:
        raise HTTPException(400, f'Could not process image: {e}')

@api_router.post('/uploads/community-post-image', response_model=UploadImageResponse, dependencies=[Depends(rate_limited('upload', 30))])
async def upload_community_post_image(payload: UploadImageRequest, user: dict = Depends(get_current_user)):
    try:
        data = decode_image_payload(payload.image)
        img = Image.open(io.BytesIO(data)).convert('RGBA')
        img.thumbnail((1440, 1800))
        flattened = Image.new('RGB', img.size, '#F7F4EC')
        flattened.paste(img, mask=img.getchannel('A'))
        user_dir = UPLOAD_DIR / 'community' / user['id']
        user_dir.mkdir(parents=True, exist_ok=True)
        target = user_dir / f'{uuid.uuid4().hex}.jpg'
        flattened.save(target, format='JPEG', quality=86, optimize=True)
        return UploadImageResponse(
            url=public_upload_url(target),
            width=flattened.width,
            height=flattened.height,
            content_type='image/jpeg',
        )
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(413, 'Image is too large to process safely')
    except Exception as e:
        raise HTTPException(400, f'Could not process image: {e}')

Image.MAX_IMAGE_PIXELS = 24_000_000  # About 24 megapixels max for Pillow decompression-bomb guard

@api_router.post("/palette", dependencies=[Depends(rate_limited('image', 30))])
async def extract_palette(payload: PaletteRequest, user: dict = Depends(get_current_user)):
    try:
        data = decode_image_payload(payload.image)
        if ColorThief is not None:
            palette = ColorThief(io.BytesIO(data)).get_palette(color_count=5, quality=1)
            hexes = [
                f'#{r:02X}{g:02X}{b:02X}'
                for r, g, b in palette
                if not (r > 240 and g > 240 and b > 240) and not (r < 15 and g < 15 and b < 15)
            ][:3]
            if hexes:
                return {'colors': hexes, 'method': 'colorthief'}
        img = Image.open(io.BytesIO(data))
        # Light decode without loading huge images at full resolution
        img.draft('RGB', (256, 256))
        img = img.convert('RGB')
        img.thumbnail((128, 128))
        q = img.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
        palette = q.getpalette() or []
        counts = sorted(q.getcolors() or [], reverse=True)
        hexes: List[str] = []
        for cnt, idx in counts:
            r, g, b = palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]
            if r > 240 and g > 240 and b > 240:
                continue
            if r < 15 and g < 15 and b < 15:
                continue
            hexes.append(f'#{r:02X}{g:02X}{b:02X}')
            if len(hexes) >= 3:
                break
        if not hexes:
            hexes = ['#888888']
        return {'colors': hexes, 'method': 'pillow-fallback'}
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(413, 'Image is too large to process safely')
    except Exception as e:
        raise HTTPException(400, f'Could not parse image: {e}')

def estimate_background_rgb(img: Image.Image) -> tuple:
    width, height = img.size
    pixels = img.load()
    step = max(1, min(width, height) // 32)
    samples = []
    for x in range(0, width, step):
        samples.append(pixels[x, 0])
        samples.append(pixels[x, height - 1])
    for y in range(0, height, step):
        samples.append(pixels[0, y])
        samples.append(pixels[width - 1, y])
    visible = [sample[:3] for sample in samples if len(sample) < 4 or sample[3] > 16]
    if not visible:
        visible = [sample[:3] for sample in samples]
    return tuple(sorted(sample[channel] for sample in visible)[len(visible) // 2] for channel in range(3))

def color_distance(pixel: tuple, bg: tuple) -> float:
    return ((pixel[0] - bg[0]) ** 2 + (pixel[1] - bg[1]) ** 2 + (pixel[2] - bg[2]) ** 2) ** 0.5

def edge_connected_background_mask(img: Image.Image, bg: tuple) -> Image.Image:
    width, height = img.size
    pixels = img.load()
    threshold = 72
    mask = Image.new('L', (width, height), 0)
    mask_pixels = mask.load()
    visited = bytearray(width * height)
    queue = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index]:
            return
        visited[index] = 1
        r, g, b, a = pixels[x, y]
        if a <= 16 or color_distance((r, g, b), bg) <= threshold:
            queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        mask_pixels[x, y] = 255
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height:
                enqueue(nx, ny)
    return mask

@api_router.post("/cutout", dependencies=[Depends(rate_limited('cutout', 10))])
async def remove_background(payload: PaletteRequest, user: dict = Depends(get_current_user)):
    try:
        data = decode_image_payload(payload.image)
        if rembg_remove is not None:
            output_data = rembg_remove(data)
            encoded = base64.b64encode(output_data).decode('utf-8')
            return {'image': f'data:image/png;base64,{encoded}', 'method': 'ai-rembg'}
        img = Image.open(io.BytesIO(data)).convert('RGBA')
        img.thumbnail((768, 768))
        bg = estimate_background_rgb(img)
        background = edge_connected_background_mask(img, bg)
        soft_background = background.filter(ImageFilter.GaussianBlur(1.5))
        foreground_alpha = Image.eval(soft_background, lambda value: 255 - value)
        img.putalpha(ImageChops.multiply(img.getchannel('A'), foreground_alpha))
        out = io.BytesIO()
        img.save(out, format='PNG')
        encoded = base64.b64encode(out.getvalue()).decode('utf-8')
        return {'image': f'data:image/png;base64,{encoded}', 'method': 'edge-connected-fallback'}
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(413, 'Image is too large to process safely')
    except Exception as e:
        raise HTTPException(400, f'Could not process image: {e}')

# ========== COMMUNITY TEMPLATES ==========
class TemplateItem(BaseModel):
    name: str
    category: str  # top|bottom|layer
    colors: List[str] = []
    tags: List[str] = []
    image: str = ''

class TemplateCreate(BaseModel):
    title: str
    description: str
    destination: str
    days: int
    season: str
    climate: str  # cold|mild|warm|tropical|cool
    items: List[TemplateItem]  # length 9 expected (col 0=top, 1=bottom, 2=layer rows)

class Template(TemplateCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    author_id: Optional[str] = None
    author_name: Optional[str] = None
    is_official: bool = False
    likes: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

@api_router.get("/templates", response_model=List[Template])
async def list_templates(
    q: Optional[str] = None,
    climate: Optional[str] = None,
    days_min: Optional[int] = None,
    days_max: Optional[int] = None,
    source: Optional[Literal['official', 'community', 'all']] = 'all',
):
    query: Dict[str, Any] = {}
    if q:
        safe = re.escape(q.strip())
        query['$or'] = [
            {'title': {'$regex': safe, '$options': 'i'}},
            {'description': {'$regex': safe, '$options': 'i'}},
            {'destination': {'$regex': safe, '$options': 'i'}},
            {'season': {'$regex': safe, '$options': 'i'}},
        ]
    if climate:
        query['climate'] = climate
    if days_min is not None or days_max is not None:
        query['days'] = {}
        if days_min is not None:
            query['days']['$gte'] = days_min
        if days_max is not None:
            query['days']['$lte'] = days_max
    if source == 'official':
        query['is_official'] = True
    elif source == 'community':
        query['is_official'] = False
    docs = await db.templates.find(query, {'_id': 0}).sort([('is_official', -1), ('likes', -1)]).to_list(200)
    return [Template(**d) for d in docs]

@api_router.get("/templates/{tid}", response_model=Template)
async def get_template(tid: str):
    doc = await db.templates.find_one({'id': tid}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'Template not found')
    return Template(**doc)

@api_router.post("/templates", response_model=Template)
async def publish_template(payload: TemplateCreate, user: dict = Depends(get_current_user)):
    if FEATURE_PRO_ENABLED and not user.get('is_pro', False):
        raise HTTPException(
            402,
            'Publishing community templates is a Packr Pro feature. Upgrade to share your grids.'
        )
    if len(payload.items) != 9:
        raise HTTPException(400, 'Template must include exactly 9 items')
    items = normalize_template_items([item.dict() for item in payload.items])
    if len(items) != 9 or [item.get('category') for item in items] != CATEGORY_BY_SLOT:
        raise HTTPException(400, 'Template must include 3 tops, 3 bottoms, and 3 layers')
    data = payload.dict(exclude={'items'})
    tpl = Template(
        author_id=user['id'],
        author_name='anonymous',
        is_official=False,
        items=items,
        **data,
    )
    await db.templates.insert_one(tpl.dict())
    return tpl

@api_router.post("/templates/{tid}/like", response_model=Template)
async def like_template(tid: str, user: dict = Depends(get_current_user)):
    # Idempotent per user
    tpl = await db.templates.find_one({'id': tid}, {'_id': 0})
    if not tpl:
        raise HTTPException(404, 'Template not found')
    existing = await db.template_likes.find_one({'template_id': tid, 'user_id': user['id']})
    if not existing:
        await db.template_likes.insert_one({
            'template_id': tid,
            'user_id': user['id'],
            'created_at': datetime.now(timezone.utc),
        })
        await db.templates.update_one({'id': tid}, {'$inc': {'likes': 1}})
        tpl = await db.templates.find_one({'id': tid}, {'_id': 0})
    return Template(**tpl)

@api_router.delete("/templates/{tid}/like", response_model=Template)
async def unlike_template(tid: str, user: dict = Depends(get_current_user)):
    res = await db.template_likes.delete_one({'template_id': tid, 'user_id': user['id']})
    if res.deleted_count:
        await db.templates.update_one({'id': tid}, {'$inc': {'likes': -1}})
    tpl = await db.templates.find_one({'id': tid}, {'_id': 0})
    if not tpl:
        raise HTTPException(404, 'Template not found')
    return Template(**tpl)

# ========== COMMUNITY / SOCIAL ==========
@api_router.get("/community/posts", response_model=List[CommunityPost])
async def list_community_posts(
    scope: Literal['public', 'following', 'saved', 'mine'] = 'public',
    limit: int = 30,
    user: dict = Depends(get_current_user),
):
    limit = max(1, min(limit, 50))
    query: Dict[str, Any]
    if scope == 'mine':
        query = {'author_id': user['id']}
    elif scope == 'following':
        follows = await db.follows.find({'follower_id': user['id']}, {'_id': 0}).to_list(500)
        following_ids = [follow['following_id'] for follow in follows]
        if not following_ids:
            return []
        query = {'author_id': {'$in': following_ids}, 'visibility': {'$in': ['public', 'followers']}}
    elif scope == 'saved':
        saves = await db.post_saves.find(
            {'user_id': user['id']},
            {'_id': 0},
        ).sort('created_at', -1).to_list(500)
        visible_saved: List[CommunityPost] = []
        for save in saves:
            post = await db.community_posts.find_one({'id': save['post_id']}, {'_id': 0})
            if not post:
                await db.post_saves.delete_one({'post_id': save['post_id'], 'user_id': user['id']})
                continue
            if await can_view_post(post, user['id']):
                visible_saved.append(await enrich_post(post, user['id']))
            if len(visible_saved) >= limit:
                break
        return visible_saved
    else:
        query = {'visibility': 'public'}
    posts = await db.community_posts.find(query, {'_id': 0}).sort('created_at', -1).to_list(limit)
    visible = [post for post in posts if await can_view_post(post, user['id'])]
    return [await enrich_post(post, user['id']) for post in visible]

@api_router.get("/community/trending", response_model=List[CommunityPost])
async def list_trending_posts(
    destination: Optional[str] = None,
    limit: int = 30,
    user: dict = Depends(get_current_user),
):
    limit = max(1, min(limit, 50))
    query: Dict[str, Any] = {'visibility': 'public'}
    if destination:
        query['destination'] = {'$regex': re.escape(destination.strip()), '$options': 'i'}
    posts = await db.community_posts.find(query, {'_id': 0}).to_list(200)
    visible = [post for post in posts if await can_view_post(post, user['id'])]
    def trending_key(post: dict) -> tuple:
        created = post.get('created_at')
        timestamp = created.timestamp() if isinstance(created, datetime) else 0
        return (
            int(post.get('likes_count') or 0) * 3 +
            int(post.get('saves_count') or 0) * 2 +
            int(post.get('comments_count') or 0),
            timestamp,
        )
    visible.sort(key=trending_key, reverse=True)
    return [await enrich_post(post, user['id']) for post in visible[:limit]]

@api_router.get("/community/challenges", response_model=List[CommunityChallenge])
async def list_community_challenges(user: dict = Depends(get_current_user)):
    return [await build_monthly_challenge()]

@api_router.post("/community/challenges/{challenge_id}/posts/{post_id}/vote")
async def vote_challenge_post(
    challenge_id: str,
    post_id: str,
    user: dict = Depends(get_current_user),
):
    await get_visible_post(post_id, user['id'])
    if challenge_id != current_challenge_id():
        raise HTTPException(404, 'Challenge not found')
    await upsert_social_edge(
        db.challenge_votes,
        {'challenge_id': challenge_id, 'post_id': post_id, 'user_id': user['id']},
        {
            'challenge_id': challenge_id,
            'post_id': post_id,
            'user_id': user['id'],
            'created_at': datetime.now(timezone.utc),
        },
    )
    return {'status': 'voted'}

@api_router.post("/community/posts", response_model=CommunityPost)
async def create_community_post(payload: CommunityPostCreate, user: dict = Depends(get_current_user)):
    trip = await db.trips.find_one({'id': payload.trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    grid = trip.get('grid') or []
    if len(grid) != 9 or any(not item_id for item_id in grid):
        raise HTTPException(400, 'Complete all 9 grid slots before sharing')
    item_ids = [item_id for item_id in grid if item_id]
    wardrobe = await db.wardrobe.find(
        {'user_id': user['id'], 'id': {'$in': item_ids}},
        {'_id': 0}
    ).to_list(20)
    by_id = {item['id']: item for item in wardrobe}
    for slot, item_id in enumerate(grid):
        if not by_id.get(item_id):
            raise HTTPException(400, 'Grid contains items that are no longer in your wardrobe')
    title = clean_social_text(payload.title, field='Title', max_length=80)
    if not title:
        title = f"{trip['destination']} packing grid"
    if payload.image_url:
        if not owned_community_upload(payload.image_url, user['id']):
            raise HTTPException(400, 'image_url must be an uploaded community post image')
        image = {
            'url': payload.image_url,
            'width': max(0, int(payload.image_width or 0)),
            'height': max(0, int(payload.image_height or 0)),
            'dominant_colors': normalize_colors(payload.dominant_colors) or item_dominant_colors(list(by_id.values())),
        }
    else:
        image = render_community_post_image(user, trip, grid, by_id, title)
    post = CommunityPost(
        author_id=user['id'],
        author_name=display_name(user),
        trip_id=trip['id'],
        title=title,
        caption=clean_social_text(payload.caption, field='Caption', max_length=220),
        visibility=payload.visibility,
        destination=trip['destination'],
        start_date=trip['start_date'],
        end_date=trip['end_date'],
        days=days_between(trip['start_date'], trip['end_date']),
        image_url=image['url'],
        image_width=image['width'],
        image_height=image['height'],
        dominant_colors=image['dominant_colors'],
    )
    stored_post = post.dict(exclude={'is_liked', 'is_saved', 'is_following_author', 'latest_comments'})
    await db.community_posts.insert_one(stored_post)
    return await enrich_post(stored_post, user['id'])

@api_router.get("/community/posts/{post_id}", response_model=CommunityPost)
async def get_community_post(post_id: str, user: dict = Depends(get_current_user)):
    post = await get_visible_post(post_id, user['id'])
    return await enrich_post(post, user['id'])

@api_router.delete("/community/posts/{post_id}")
async def delete_community_post(post_id: str, user: dict = Depends(get_current_user)):
    post = await db.community_posts.find_one({'id': post_id}, {'_id': 0})
    if not post or post.get('author_id') != user['id']:
        raise HTTPException(404, 'Community post not found')
    delete_community_post_image(post.get('image_url', ''))
    await db.community_posts.delete_one({'id': post_id})
    await db.comments.delete_many({'post_id': post_id})
    await db.post_likes.delete_many({'post_id': post_id})
    await db.post_saves.delete_many({'post_id': post_id})
    return {'ok': True}

@api_router.post("/community/posts/{post_id}/like", response_model=CommunityPost)
async def like_community_post(post_id: str, user: dict = Depends(get_current_user)):
    post = await get_visible_post(post_id, user['id'])
    await upsert_social_edge(
        db.post_likes,
        {'post_id': post_id, 'user_id': user['id']},
        {
            'post_id': post_id,
            'user_id': user['id'],
            'created_at': datetime.now(timezone.utc),
        },
    )
    post = await db.community_posts.find_one({'id': post_id}, {'_id': 0}) or post
    return await enrich_post(post, user['id'])

@api_router.delete("/community/posts/{post_id}/like", response_model=CommunityPost)
async def unlike_community_post(post_id: str, user: dict = Depends(get_current_user)):
    post = await get_visible_post(post_id, user['id'])
    await db.post_likes.delete_one({'post_id': post_id, 'user_id': user['id']})
    post = await db.community_posts.find_one({'id': post_id}, {'_id': 0}) or post
    return await enrich_post(post, user['id'])

@api_router.post("/community/posts/{post_id}/save", response_model=CommunityPost)
async def save_community_post(post_id: str, user: dict = Depends(get_current_user)):
    post = await get_visible_post(post_id, user['id'])
    await upsert_social_edge(
        db.post_saves,
        {'post_id': post_id, 'user_id': user['id']},
        {
            'post_id': post_id,
            'user_id': user['id'],
            'created_at': datetime.now(timezone.utc),
        },
    )
    post = await db.community_posts.find_one({'id': post_id}, {'_id': 0}) or post
    return await enrich_post(post, user['id'])

@api_router.delete("/community/posts/{post_id}/save", response_model=CommunityPost)
async def unsave_community_post(post_id: str, user: dict = Depends(get_current_user)):
    post = await get_visible_post(post_id, user['id'])
    await db.post_saves.delete_one({'post_id': post_id, 'user_id': user['id']})
    post = await db.community_posts.find_one({'id': post_id}, {'_id': 0}) or post
    return await enrich_post(post, user['id'])

@api_router.post("/community/posts/{post_id}/comments", response_model=CommunityPost)
async def add_community_comment(
    post_id: str,
    payload: CommunityCommentCreate,
    user: dict = Depends(get_current_user),
):
    post = await get_visible_post(post_id, user['id'])
    text = clean_social_text(payload.text, field='Comment', max_length=500, allow_empty=False)
    comment = CommunityComment(
        post_id=post_id,
        user_id=user['id'],
        user_name=display_name(user),
        text=text,
    )
    await db.comments.insert_one(comment.dict())
    post = await db.community_posts.find_one({'id': post_id}, {'_id': 0}) or post
    return await enrich_post(post, user['id'])

@api_router.delete("/community/posts/{post_id}/comments/{comment_id}", response_model=CommunityPost)
async def delete_community_comment(
    post_id: str,
    comment_id: str,
    user: dict = Depends(get_current_user),
):
    post = await get_visible_post(post_id, user['id'])
    comment = await db.comments.find_one({'id': comment_id, 'post_id': post_id}, {'_id': 0})
    if not comment:
        raise HTTPException(404, 'Comment not found')
    if comment.get('user_id') != user['id'] and post.get('author_id') != user['id']:
        raise HTTPException(403, 'You can only delete your own comments')
    await db.comments.delete_one({'id': comment_id, 'post_id': post_id})
    post = await db.community_posts.find_one({'id': post_id}, {'_id': 0}) or post
    return await enrich_post(post, user['id'])

@api_router.post("/community/posts/{post_id}/report")
async def report_community_post(
    post_id: str,
    payload: CommunityReportCreate,
    user: dict = Depends(get_current_user),
):
    post = await get_visible_post(post_id, user['id'])
    await upsert_social_edge(
        db.community_reports,
        {'post_id': post_id, 'reporter_id': user['id']},
        {
            'post_id': post_id,
            'reporter_id': user['id'],
            'author_id': post.get('author_id'),
            'reason': clean_social_text(payload.reason or '', field='Reason', max_length=500),
            'created_at': datetime.now(timezone.utc),
        },
    )
    return {'status': 'reported'}

@api_router.post("/community/posts/{post_id}/comments/{comment_id}/report")
async def report_community_comment(
    post_id: str,
    comment_id: str,
    payload: CommunityReportCreate,
    user: dict = Depends(get_current_user),
):
    await get_visible_post(post_id, user['id'])
    comment = await db.comments.find_one({'id': comment_id, 'post_id': post_id}, {'_id': 0})
    if not comment:
        raise HTTPException(404, 'Comment not found')
    await upsert_social_edge(
        db.comment_reports,
        {'comment_id': comment_id, 'reporter_id': user['id']},
        {
            'post_id': post_id,
            'comment_id': comment_id,
            'reporter_id': user['id'],
            'author_id': comment.get('user_id'),
            'reason': clean_social_text(payload.reason or '', field='Reason', max_length=500),
            'created_at': datetime.now(timezone.utc),
        },
    )
    return {'status': 'reported'}

@api_router.get("/users/{uid}", response_model=SocialProfile)
async def get_social_profile(uid: str, user: dict = Depends(get_current_user)):
    return await social_profile_for(uid, user['id'])

@api_router.post("/users/{uid}/follow", response_model=SocialProfile)
async def follow_user(uid: str, user: dict = Depends(get_current_user)):
    if uid == user['id']:
        raise HTTPException(400, 'You cannot follow yourself')
    target = await db.users.find_one({'id': uid}, {'_id': 0})
    if not target:
        raise HTTPException(404, 'User not found')
    await upsert_social_edge(
        db.follows,
        {'follower_id': user['id'], 'following_id': uid},
        {
            'follower_id': user['id'],
            'following_id': uid,
            'created_at': datetime.now(timezone.utc),
        },
    )
    return await social_profile_for(uid, user['id'])

@api_router.delete("/users/{uid}/follow", response_model=SocialProfile)
async def unfollow_user(uid: str, user: dict = Depends(get_current_user)):
    if uid == user['id']:
        raise HTTPException(400, 'You cannot unfollow yourself')
    await db.follows.delete_one({'follower_id': user['id'], 'following_id': uid})
    return await social_profile_for(uid, user['id'])

@api_router.get("/retention/nudges", response_model=List[TripNudge])
async def retention_nudges(user: dict = Depends(get_current_user)):
    trips = await db.trips.find({'user_id': user['id']}, {'_id': 0}).sort('start_date', 1).to_list(200)
    wardrobe = await db.wardrobe.find({'user_id': user['id']}, {'_id': 0}).to_list(500)
    today = datetime.now(timezone.utc).date()
    nudges: List[TripNudge] = []

    for trip in trips:
        try:
            start = date.fromisoformat(trip['start_date'])
            end = date.fromisoformat(trip['end_date'])
        except Exception:
            continue
        days_until = (start - today).days
        if 0 <= days_until <= 7 and len([item_id for item_id in (trip.get('grid') or []) if item_id]) < 9:
            nudges.append(TripNudge(
                id=f"pre-trip-{trip['id']}",
                kind='pre_trip',
                trip_id=trip['id'],
                title=f"{trip['destination']} is in {days_until} days",
                message='Your grid is not complete yet. Fill the 9 slots before packing day.',
                action_route='/(tabs)/grid',
            ))
        if end < today:
            existing = await db.trip_reflections.count_documents({'trip_id': trip['id'], 'user_id': user['id']})
            if existing == 0:
                nudges.append(TripNudge(
                    id=f"post-trip-{trip['id']}",
                    kind='post_trip',
                    trip_id=trip['id'],
                    title=f"Reflect on {trip['destination']}",
                    message='Mark what you wore and what stayed unused so Packr learns for your next trip.',
                    action_route='/(tabs)/lookbook',
                ))

    if len(trips) >= 3 and wardrobe:
        layers = [item for item in wardrobe if item.get('category') == 'layer']
        layer_name = layers[0].get('name') if layers else wardrobe[0].get('name')
        nudges.append(TripNudge(
            id='wardrobe-audit',
            kind='wardrobe_audit',
            title='Wardrobe audit',
            message=f'You have enough trip history to review repeats. Start with {layer_name or "your most-used layer"} and add alternatives.',
            action_route='/(tabs)/studio',
        ))

    if not nudges:
        nudges.append(TripNudge(
            id='monthly-challenge',
            kind='challenge',
            title='Try the monthly challenge',
            message='Pack 5 days with only neutrals and share one screenshot to the community feed.',
            action_route='/(tabs)/community',
        ))
    return nudges[:5]

@api_router.post("/analytics/events", dependencies=[Depends(rate_limited('analytics', 120))])
async def record_analytics_event(payload: AnalyticsEventCreate, user: dict = Depends(get_current_user)):
    try:
        encoded_size = len(json.dumps(payload.properties, default=str))
    except (TypeError, ValueError):
        raise HTTPException(400, 'properties must be JSON-serializable')
    if encoded_size > 2048:
        raise HTTPException(413, 'properties too large (max 2 KB)')
    await db.analytics_events.insert_one({
        'id': str(uuid.uuid4()),
        'user_id': user['id'],
        'name': payload.name,
        'properties': payload.properties,
        'created_at': datetime.now(timezone.utc),
    })
    return {'ok': True}

@api_router.post("/feedback", dependencies=[Depends(rate_limited('feedback', 10))])
async def submit_feedback(payload: FeedbackCreate, user: dict = Depends(get_current_user)):
    await db.feedback.insert_one({
        'id': str(uuid.uuid4()),
        'user_id': user['id'],
        'email': user.get('email'),
        'message': payload.message.strip(),
        'context': (payload.context or '').strip(),
        'created_at': datetime.now(timezone.utc),
    })
    return {'ok': True}

class ApplyTemplate(BaseModel):
    trip_id: str

@api_router.post("/templates/{tid}/apply", response_model=Trip)
async def apply_template(tid: str, payload: ApplyTemplate, user: dict = Depends(get_current_user)):
    """Clone the 9 template items into the user's wardrobe (with a `from-template` tag)
    and assign them to the trip's grid in slot order. Re-applying cleans up prior
    `from-template` clones from THIS trip's previous grid to keep the wardrobe lean."""
    tpl = await db.templates.find_one({'id': tid}, {'_id': 0})
    if not tpl:
        raise HTTPException(404, 'Template not found')
    trip = await db.trips.find_one({'id': payload.trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')

    # Cleanup: remove from-template wardrobe clones that were referenced by THIS trip's
    # previous grid AND are no longer used by any other trip.
    prior_ids = [x for x in (trip.get('grid') or []) if x]
    if prior_ids:
        prior_items = await db.wardrobe.find(
            {'user_id': user['id'], 'id': {'$in': prior_ids}, 'tags': 'from-template'},
            {'_id': 0}
        ).to_list(50)
        for item in prior_items:
            still_used = await db.trips.count_documents({
                'user_id': user['id'],
                'id': {'$ne': payload.trip_id},
                'grid': item['id'],
            })
            if not still_used:
                await db.wardrobe.delete_one({'id': item['id'], 'user_id': user['id']})

    template_items = normalize_template_items(tpl.get('items', []))
    if len(template_items) != 9:
        raise HTTPException(400, 'Template must include exactly 9 items')
    new_grid: List[Optional[str]] = [None] * 9
    for slot, raw in enumerate(template_items):
        expected_category = category_for_slot(slot)
        if raw.get('category') != expected_category:
            raise HTTPException(400, 'Template item order is invalid')
        item_id = str(uuid.uuid4())
        item = {
            'id': item_id,
            'user_id': user['id'],
            'name': raw.get('name', f'Item {slot + 1}'),
            'category': expected_category,
            'image': raw.get('image', ''),
            'colors': raw.get('colors', []),
            'weight_kg': 0.3,
            'tags': list(set((raw.get('tags') or []) + ['from-template'])),
            'created_at': datetime.now(timezone.utc),
        }
        await db.wardrobe.insert_one(item.copy())
        new_grid[slot] = item_id

    await db.trips.update_one(
        {'id': payload.trip_id, 'user_id': user['id']},
        {'$set': {**clean_outfit_state_for_grid(trip, new_grid), 'grid': new_grid}}
    )
    trip = await db.trips.find_one({'id': payload.trip_id, 'user_id': user['id']}, {'_id': 0})
    return Trip(**trip)

# ========== ME / PRO / AIRLINES ==========
class AirlineProfile(BaseModel):
    name: str
    max_kg: float

@api_router.delete("/me")
async def delete_account(user: dict = Depends(get_current_user)):
    """Permanently delete the account and all associated data.

    Required by Google Play / App Store policies for apps with account
    creation. Removes: profile, wardrobe, trips, reflections, invites,
    community posts (+ likes/saves/comments on them), the user's own
    social activity, analytics, feedback, uploaded images, and the
    Firebase Auth user.
    """
    uid = user['id']

    # Community posts authored by the user, and everything attached to them.
    posts = await db.community_posts.find(
        {'author_id': uid}, {'_id': 0, 'id': 1, 'image_url': 1}
    ).to_list(2000)
    post_ids = [post['id'] for post in posts]
    for post in posts:
        delete_community_post_image(post.get('image_url', ''))
    if post_ids:
        await db.comments.delete_many({'post_id': {'$in': post_ids}})
        await db.post_likes.delete_many({'post_id': {'$in': post_ids}})
        await db.post_saves.delete_many({'post_id': {'$in': post_ids}})
        await db.challenge_votes.delete_many({'post_id': {'$in': post_ids}})
        await db.community_posts.delete_many({'author_id': uid})

    # The user's own activity on other people's content.
    await db.comments.delete_many({'user_id': uid})
    await db.post_likes.delete_many({'user_id': uid})
    await db.post_saves.delete_many({'user_id': uid})
    await db.challenge_votes.delete_many({'user_id': uid})
    await db.follows.delete_many({'$or': [{'follower_id': uid}, {'following_id': uid}]})
    await db.template_likes.delete_many({'user_id': uid})
    await db.community_reports.delete_many({'reporter_id': uid})
    await db.comment_reports.delete_many({'reporter_id': uid})

    # Core user data.
    await db.templates.delete_many({'author_id': uid, 'is_official': {'$ne': True}})
    await db.trip_reflections.delete_many({'user_id': uid})
    await db.trip_invites.delete_many({'owner_id': uid})
    await db.trips.delete_many({'user_id': uid})
    await db.wardrobe.delete_many({'user_id': uid})
    await db.analytics_events.delete_many({'user_id': uid})
    await db.feedback.delete_many({'user_id': uid})
    await db.users.delete_one({'id': uid})

    # Uploaded files on disk.
    for subdir in ('wardrobe', 'community'):
        target = (UPLOAD_DIR / subdir / uid).resolve()
        try:
            target.relative_to(UPLOAD_DIR.resolve())
            shutil.rmtree(target, ignore_errors=True)
        except ValueError:
            pass

    # Firebase Auth account (best-effort; token is already consumed).
    if FIREBASE_AUTH_READY and firebase_auth is not None and user.get('firebase_uid'):
        try:
            firebase_auth.delete_user(user['firebase_uid'])
        except Exception as e:
            logging.getLogger(__name__).warning(f'Firebase user delete failed for {uid}: {e}')

    return {'ok': True}

# Dev-only escape hatch for testing Pro flows. NEVER enable in production:
# real upgrades must go through verified in-app purchases (e.g. RevenueCat).
ALLOW_DEV_PRO_TOGGLE = env_bool('ALLOW_DEV_PRO_TOGGLE', not IS_PRODUCTION)

@api_router.post("/me/pro", response_model=UserPublic)
async def upgrade_to_pro(user: dict = Depends(get_current_user)):
    if not FEATURE_PRO_ENABLED:
        raise HTTPException(404, 'Packr Pro is not enabled for this release')
    if IS_PRODUCTION or not ALLOW_DEV_PRO_TOGGLE:
        raise HTTPException(
            402,
            'Pro upgrades require a verified in-app purchase. Self-serve upgrade is disabled.'
        )
    await db.users.update_one({'id': user['id']}, {'$set': {'is_pro': True}})
    user = await db.users.find_one({'id': user['id']}, {'_id': 0})
    return user_public(user)

@api_router.delete("/me/pro", response_model=UserPublic)
async def downgrade_pro(user: dict = Depends(get_current_user)):
    if not FEATURE_PRO_ENABLED:
        raise HTTPException(404, 'Packr Pro is not enabled for this release')
    await db.users.update_one({'id': user['id']}, {'$set': {'is_pro': False}})
    user = await db.users.find_one({'id': user['id']}, {'_id': 0})
    return user_public(user)

@api_router.post("/me/airlines", response_model=UserPublic)
async def add_airline(payload: AirlineProfile, user: dict = Depends(get_current_user)):
    if FEATURE_PRO_ENABLED and not user.get('is_pro', False):
        raise HTTPException(402, 'Custom airline profiles are a Packr Pro feature.')
    # Backfill defaults for legacy users that registered before airline_profiles field existed
    if not user.get('airline_profiles'):
        await db.users.update_one(
            {'id': user['id']},
            {'$set': {'airline_profiles': list(DEFAULT_AIRLINES)}}
        )
    profile = {'id': str(uuid.uuid4()), 'name': payload.name, 'max_kg': payload.max_kg}
    await db.users.update_one(
        {'id': user['id']},
        {'$push': {'airline_profiles': profile}}
    )
    user = await db.users.find_one({'id': user['id']}, {'_id': 0})
    return user_public(user)

@api_router.delete("/me/airlines/{aid}", response_model=UserPublic)
async def remove_airline(aid: str, user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {'id': user['id']},
        {'$pull': {'airline_profiles': {'id': aid}}}
    )
    user = await db.users.find_one({'id': user['id']}, {'_id': 0})
    return user_public(user)

# ========== Seed default templates (idempotent) ==========
DEFAULT_TEMPLATES = [
    {
        'title': '7 Days in Tokyo — Autumn Minimalist',
        'description': 'Cool autumn days, layered architectural fits. Heavy on neutrals, breathable wool blends, and one statement layer for evenings.',
        'destination': 'Tokyo, Japan',
        'days': 7,
        'season': 'Autumn',
        'climate': 'cool',
        'is_official': True,
        'author_name': 'Packr',
        'likes': 412,
        'items': [
            {'name': 'Charcoal merino tee', 'category': 'top', 'colors': ['#3A3A3A'], 'tags': ['casual', 'layer-friendly']},
            {'name': 'Black tapered chinos', 'category': 'bottom', 'colors': ['#1F1F1F'], 'tags': ['casual', 'business']},
            {'name': 'Light wool overshirt', 'category': 'layer', 'colors': ['#7A7060'], 'tags': ['layer', 'cool']},
            {'name': 'Off-white linen shirt', 'category': 'top', 'colors': ['#F2EEDF'], 'tags': ['business', 'casual']},
            {'name': 'Indigo straight jeans', 'category': 'bottom', 'colors': ['#2A3F5F'], 'tags': ['casual']},
            {'name': 'Heavyweight zip hoodie', 'category': 'layer', 'colors': ['#222222'], 'tags': ['casual', 'cool']},
            {'name': 'Navy long sleeve henley', 'category': 'top', 'colors': ['#1B2A41'], 'tags': ['casual', 'modest']},
            {'name': 'Olive utility trousers', 'category': 'bottom', 'colors': ['#56603F'], 'tags': ['casual']},
            {'name': 'Beige trench coat', 'category': 'layer', 'colors': ['#C9B68B'], 'tags': ['formal', 'business']},
        ],
    },
    {
        'title': '5 Days in Lisbon — Coastal Capsule',
        'description': 'Warm sun, ocean breeze, evening tile alleys. Light fabrics with one warm-toned linen layer.',
        'destination': 'Lisbon, Portugal',
        'days': 5,
        'season': 'Late Spring',
        'climate': 'warm',
        'is_official': True,
        'author_name': 'Packr',
        'likes': 287,
        'items': [
            {'name': 'White cotton tee', 'category': 'top', 'colors': ['#FFFFFF'], 'tags': ['casual', 'tropical']},
            {'name': 'Sand chinos', 'category': 'bottom', 'colors': ['#D7C7A0'], 'tags': ['casual', 'business']},
            {'name': 'Camel linen overshirt', 'category': 'layer', 'colors': ['#B68C5A'], 'tags': ['layer', 'tropical']},
            {'name': 'Navy striped tee', 'category': 'top', 'colors': ['#1B2A41', '#FFFFFF'], 'tags': ['casual']},
            {'name': 'Off-white shorts', 'category': 'bottom', 'colors': ['#F2EEDF'], 'tags': ['casual', 'beach']},
            {'name': 'Light denim jacket', 'category': 'layer', 'colors': ['#5C7393'], 'tags': ['casual', 'layer']},
            {'name': 'Pale blue oxford', 'category': 'top', 'colors': ['#A7C0D9'], 'tags': ['business', 'formal']},
            {'name': 'Cream wide-leg trousers', 'category': 'bottom', 'colors': ['#E6DFC9'], 'tags': ['formal', 'modest']},
            {'name': 'Black bomber', 'category': 'layer', 'colors': ['#0A0A0A'], 'tags': ['casual']},
        ],
    },
    {
        'title': '10 Days in Reykjavík — Subzero',
        'description': 'Glacier wind, geothermal pools, Northern lights. Wool, fleece, and one waterproof shell.',
        'destination': 'Reykjavík, Iceland',
        'days': 10,
        'season': 'Winter',
        'climate': 'cold',
        'is_official': True,
        'author_name': 'Packr',
        'likes': 198,
        'items': [
            {'name': 'Black thermal base', 'category': 'top', 'colors': ['#0F0F0F'], 'tags': ['snow', 'casual']},
            {'name': 'Wool joggers', 'category': 'bottom', 'colors': ['#3D3D3D'], 'tags': ['snow', 'casual']},
            {'name': 'Down puffer jacket', 'category': 'layer', 'colors': ['#0A0A0A'], 'tags': ['snow', 'layer']},
            {'name': 'Cream fisherman knit', 'category': 'top', 'colors': ['#E6DFC9'], 'tags': ['snow', 'casual', 'modest']},
            {'name': 'Charcoal wool trousers', 'category': 'bottom', 'colors': ['#3A3A3A'], 'tags': ['business', 'snow']},
            {'name': 'Forest fleece pullover', 'category': 'layer', 'colors': ['#2F4F3E'], 'tags': ['snow', 'casual']},
            {'name': 'Navy turtleneck', 'category': 'top', 'colors': ['#1B2A41'], 'tags': ['snow', 'modest', 'business']},
            {'name': 'Black insulated jeans', 'category': 'bottom', 'colors': ['#161616'], 'tags': ['snow', 'casual']},
            {'name': 'Olive shell parka', 'category': 'layer', 'colors': ['#56603F'], 'tags': ['snow', 'layer']},
        ],
    },
    {
        'title': '6 Days in Bali — Tropical Light',
        'description': 'Humidity-friendly, breathable fabrics. Linen, viscose, breezy silhouettes.',
        'destination': 'Bali, Indonesia',
        'days': 6,
        'season': 'Dry season',
        'climate': 'tropical',
        'is_official': True,
        'author_name': 'Packr',
        'likes': 356,
        'items': [
            {'name': 'White linen tee', 'category': 'top', 'colors': ['#F8F4E9'], 'tags': ['tropical', 'beach']},
            {'name': 'Khaki linen shorts', 'category': 'bottom', 'colors': ['#B5A06A'], 'tags': ['beach', 'tropical']},
            {'name': 'Open-weave overshirt', 'category': 'layer', 'colors': ['#D7C7A0'], 'tags': ['tropical', 'beach']},
            {'name': 'Pastel pink tee', 'category': 'top', 'colors': ['#F0C8C0'], 'tags': ['casual', 'tropical']},
            {'name': 'Loose ivory pants', 'category': 'bottom', 'colors': ['#F2EEDF'], 'tags': ['modest', 'tropical']},
            {'name': 'Light viscose shirt', 'category': 'layer', 'colors': ['#A7C0D9'], 'tags': ['tropical', 'modest']},
            {'name': 'Sage tank', 'category': 'top', 'colors': ['#8DA399'], 'tags': ['beach', 'gym']},
            {'name': 'Sand cargo shorts', 'category': 'bottom', 'colors': ['#D7C7A0'], 'tags': ['beach', 'casual']},
            {'name': 'Navy windbreaker', 'category': 'layer', 'colors': ['#1B2A41'], 'tags': ['casual', 'tropical']},
        ],
    },
]

@app.on_event("startup")
async def seed_templates():
    try:
        if os.environ.get('DB_NAME', '').lower().startswith('test'):
            await db.users.update_one(
                {'email': 'test@packr.app'},
                {
                    '$set': {
                        'password_hash': hash_password('test1234'),
                        'name': 'Test User',
                        'is_pro': True,
                        'airline_profiles': list(DEFAULT_AIRLINES),
                    },
                    '$setOnInsert': {
                        'id': str(uuid.uuid4()),
                        'email': 'test@packr.app',
                        'created_at': datetime.now(timezone.utc),
                    },
                },
                upsert=True,
            )

        user_indexes = [
            ([('id', 1)], True, 'uniq_user_id'),
            ([('email', 1)], True, 'uniq_user_email'),
            ([('firebase_uid', 1)], True, 'uniq_firebase_uid'),
        ]
        for keys, unique, name in user_indexes:
            try:
                await db.users.create_index(keys, unique=unique, name=name, sparse=name == 'uniq_firebase_uid')
            except Exception as ie:
                logger.info(f'{name} index ensure: {ie}')

        # Analytics events auto-expire after 90 days (TTL index).
        try:
            await db.analytics_events.create_index(
                [('created_at', 1)], expireAfterSeconds=90 * 24 * 3600, name='ttl_analytics_created'
            )
        except Exception as ie:
            logger.info(f'ttl_analytics_created index ensure: {ie}')

        # Unique compound index for per-user like idempotency (DB-level guard).
        try:
            await db.template_likes.create_index(
                [('template_id', 1), ('user_id', 1)], unique=True, name='uniq_user_template'
            )
        except Exception as ie:
            logger.info(f'template_likes index ensure: {ie}')

        social_indexes = [
            (db.community_posts, [('visibility', 1), ('created_at', -1)], False, 'idx_post_visibility_created'),
            (db.community_posts, [('author_id', 1), ('created_at', -1)], False, 'idx_post_author_created'),
            (db.comments, [('post_id', 1), ('created_at', -1)], False, 'idx_comment_post_created'),
            (db.post_likes, [('post_id', 1), ('user_id', 1)], True, 'uniq_post_like'),
            (db.post_saves, [('post_id', 1), ('user_id', 1)], True, 'uniq_post_save'),
            (db.post_saves, [('user_id', 1), ('created_at', -1)], False, 'idx_save_user_created'),
            (db.follows, [('follower_id', 1), ('following_id', 1)], True, 'uniq_follow'),
            (db.follows, [('following_id', 1), ('created_at', -1)], False, 'idx_following_created'),
            (db.community_reports, [('post_id', 1), ('reporter_id', 1)], True, 'uniq_post_report'),
            (db.comment_reports, [('comment_id', 1), ('reporter_id', 1)], True, 'uniq_comment_report'),
            (db.challenge_votes, [('challenge_id', 1), ('post_id', 1), ('user_id', 1)], True, 'uniq_challenge_vote'),
            (db.trip_reflections, [('trip_id', 1), ('user_id', 1), ('created_at', -1)], False, 'idx_reflection_trip_user'),
            (db.trip_invites, [('trip_id', 1), ('owner_id', 1), ('created_at', -1)], False, 'idx_invite_trip_owner'),
            (db.trip_invites, [('code', 1)], True, 'uniq_invite_code'),
        ]
        for collection, keys, unique, name in social_indexes:
            try:
                await collection.create_index(keys, unique=unique, name=name)
            except Exception as ie:
                logger.info(f'{name} index ensure: {ie}')

        existing = await db.templates.count_documents({'is_official': True})
        if existing >= len(DEFAULT_TEMPLATES):
            return
        for t in DEFAULT_TEMPLATES:
            already = await db.templates.find_one({'title': t['title'], 'is_official': True})
            if already:
                continue
            seed_doc = dict(t)
            seed_doc['items'] = normalize_template_items(t['items'])
            tpl = Template(**seed_doc)
            await db.templates.insert_one(tpl.dict())
        logger.info(f'Seeded {len(DEFAULT_TEMPLATES)} official templates')
    except Exception as e:
        logger.warning(f'Template seed skipped: {e}')

app.include_router(api_router)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount('/uploads', StaticFiles(directory=str(UPLOAD_DIR)), name='uploads')

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
