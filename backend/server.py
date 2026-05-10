from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import io
import base64
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
import httpx
from PIL import Image

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'packr-dev-secret-change-in-prod')
JWT_ALG = 'HS256'
JWT_EXPIRE_DAYS = 30

app = FastAPI(title="Packr API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

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
    favorites: List[int] = []  # outfit indices favorited
    occasion_tags: Dict[str, str] = Field(default_factory=dict)  # outfit_idx -> occasion
    checklist_state: Dict[str, bool] = Field(default_factory=dict)  # itemKey -> checked
    extras: List[Dict[str, Any]] = Field(default_factory=list)  # essentials added
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class GridUpdate(BaseModel):
    grid: List[Optional[str]]

class FavoriteUpdate(BaseModel):
    outfit_index: int
    is_favorite: bool

class OccasionUpdate(BaseModel):
    outfit_index: int
    occasion: str

class ChecklistUpdate(BaseModel):
    item_key: str
    checked: bool

class ExtraItem(BaseModel):
    name: str
    category: str  # 'toiletries' | 'documents' | 'chargers' | 'other'
    weight_kg: float = 0.1

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

async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
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

# ========== AUTH ROUTES ==========
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(payload: UserRegister):
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

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(payload: UserLogin):
    user = await db.users.find_one({'email': payload.email.lower()}, {'_id': 0})
    if not user or not verify_password(payload.password, user['password_hash']):
        raise HTTPException(401, 'Invalid email or password')
    return TokenResponse(token=create_token(user['id']), user=user_public(user))

@api_router.get("/auth/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return user_public(user)

# ========== WARDROBE ROUTES ==========
@api_router.get("/wardrobe", response_model=List[WardrobeItem])
async def list_wardrobe(user: dict = Depends(get_current_user)):
    items = await db.wardrobe.find({'user_id': user['id']}, {'_id': 0}).sort('created_at', -1).to_list(500)
    return [WardrobeItem(**i) for i in items]

@api_router.post("/wardrobe", response_model=WardrobeItem)
async def create_wardrobe_item(payload: WardrobeItemCreate, user: dict = Depends(get_current_user)):
    if payload.category not in ('top', 'bottom', 'layer'):
        raise HTTPException(400, 'category must be top, bottom, or layer')
    item = WardrobeItem(user_id=user['id'], **payload.dict())
    await db.wardrobe.insert_one(item.dict())
    return item

@api_router.delete("/wardrobe/{item_id}")
async def delete_wardrobe_item(item_id: str, user: dict = Depends(get_current_user)):
    res = await db.wardrobe.delete_one({'id': item_id, 'user_id': user['id']})
    if res.deleted_count == 0:
        raise HTTPException(404, 'Item not found')
    # Remove from any trip grids
    await db.trips.update_many(
        {'user_id': user['id'], 'grid': item_id},
        {'$set': {'grid.$': None}}
    )
    return {'ok': True}

# ========== TRIP ROUTES ==========
@api_router.get("/trips", response_model=List[Trip])
async def list_trips(user: dict = Depends(get_current_user)):
    trips = await db.trips.find({'user_id': user['id']}, {'_id': 0}).sort('start_date', 1).to_list(200)
    return [Trip(**t) for t in trips]

@api_router.post("/trips", response_model=Trip)
async def create_trip(payload: TripCreate, user: dict = Depends(get_current_user)):
    if not user.get('is_pro', False):
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
    if len(payload.grid) != 9:
        raise HTTPException(400, 'Grid must have exactly 9 slots')
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$set': {'grid': payload.grid}}
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
    favs = set(trip.get('favorites', []))
    if payload.is_favorite:
        favs.add(payload.outfit_index)
    else:
        favs.discard(payload.outfit_index)
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$set': {'favorites': sorted(list(favs))}}
    )
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    return Trip(**trip)

@api_router.put("/trips/{trip_id}/occasion", response_model=Trip)
async def update_occasion(trip_id: str, payload: OccasionUpdate, user: dict = Depends(get_current_user)):
    await db.trips.update_one(
        {'id': trip_id, 'user_id': user['id']},
        {'$set': {f'occasion_tags.{payload.outfit_index}': payload.occasion}}
    )
    trip = await db.trips.find_one({'id': trip_id, 'user_id': user['id']}, {'_id': 0})
    if not trip:
        raise HTTPException(404, 'Trip not found')
    return Trip(**trip)

@api_router.put("/trips/{trip_id}/checklist", response_model=Trip)
async def update_checklist(trip_id: str, payload: ChecklistUpdate, user: dict = Depends(get_current_user)):
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
@api_router.get("/weather")
async def weather(latitude: float, longitude: float, start_date: Optional[str] = None, end_date: Optional[str] = None):
    """Geocoding -> forecast via Open-Meteo. No API key required."""
    params = {
        'latitude': latitude,
        'longitude': longitude,
        'daily': 'temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code',
        'timezone': 'auto',
        'forecast_days': 14,
    }
    async with httpx.AsyncClient(timeout=10) as cli:
        r = await cli.get('https://api.open-meteo.com/v1/forecast', params=params)
        if r.status_code != 200:
            raise HTTPException(502, 'Weather service error')
        return r.json()

@api_router.get("/geocode")
async def geocode(q: str):
    """City search via Open-Meteo geocoding."""
    async with httpx.AsyncClient(timeout=10) as cli:
        r = await cli.get('https://geocoding-api.open-meteo.com/v1/search', params={'name': q, 'count': 5, 'language': 'en'})
        if r.status_code != 200:
            raise HTTPException(502, 'Geocoding service error')
        data = r.json()
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

# ========== COLOR PALETTE EXTRACTION ==========
class PaletteRequest(BaseModel):
    image: str  # data:image/jpeg;base64,... or raw base64

FREE_TRIP_CAP = 2
MAX_IMAGE_BYTES = 4 * 1024 * 1024  # 4 MB decoded
Image.MAX_IMAGE_PIXELS = 24_000_000  # ~24 megapixels max — Pillow decompression-bomb guard

@api_router.post("/palette")
async def extract_palette(payload: PaletteRequest, user: dict = Depends(get_current_user)):
    raw = payload.image
    if ',' in raw and raw.startswith('data:'):
        raw = raw.split(',', 1)[1]
    if len(raw) > 8 * 1024 * 1024:  # ~8MB base64 → ~6MB binary
        raise HTTPException(413, 'Image too large (max ~6 MB)')
    try:
        data = base64.b64decode(raw, validate=False)
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(413, f'Image too large (max {MAX_IMAGE_BYTES // (1024 * 1024)} MB)')
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
        return {'colors': hexes}
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(413, 'Image is too large to process safely')
    except Exception as e:
        raise HTTPException(400, f'Could not parse image: {e}')

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
async def list_templates():
    docs = await db.templates.find({}, {'_id': 0}).sort([('is_official', -1), ('likes', -1)]).to_list(200)
    return [Template(**d) for d in docs]

@api_router.get("/templates/{tid}", response_model=Template)
async def get_template(tid: str):
    doc = await db.templates.find_one({'id': tid}, {'_id': 0})
    if not doc:
        raise HTTPException(404, 'Template not found')
    return Template(**doc)

@api_router.post("/templates", response_model=Template)
async def publish_template(payload: TemplateCreate, user: dict = Depends(get_current_user)):
    if not user.get('is_pro', False):
        raise HTTPException(
            402,
            'Publishing community templates is a Packr Pro feature. Upgrade to share your grids.'
        )
    if len(payload.items) != 9:
        raise HTTPException(400, 'Template must include exactly 9 items')
    tpl = Template(
        author_id=user['id'],
        author_name=user.get('name') or user['email'].split('@')[0],
        is_official=False,
        **payload.dict(),
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

    new_grid: List[Optional[str]] = [None] * 9
    for slot, raw in enumerate(tpl.get('items', [])[:9]):
        item_id = str(uuid.uuid4())
        item = {
            'id': item_id,
            'user_id': user['id'],
            'name': raw.get('name', f'Item {slot + 1}'),
            'category': raw.get('category', ['top', 'bottom', 'layer'][slot % 3]),
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
        {'$set': {'grid': new_grid}}
    )
    trip = await db.trips.find_one({'id': payload.trip_id, 'user_id': user['id']}, {'_id': 0})
    return Trip(**trip)

# ========== ME / PRO / AIRLINES ==========
class AirlineProfile(BaseModel):
    name: str
    max_kg: float

@api_router.post("/me/pro", response_model=UserPublic)
async def upgrade_to_pro(user: dict = Depends(get_current_user)):
    """Stub upgrade — real billing/payment is Phase 2 (Stripe / Razorpay)."""
    await db.users.update_one({'id': user['id']}, {'$set': {'is_pro': True}})
    user = await db.users.find_one({'id': user['id']}, {'_id': 0})
    return user_public(user)

@api_router.delete("/me/pro", response_model=UserPublic)
async def downgrade_pro(user: dict = Depends(get_current_user)):
    await db.users.update_one({'id': user['id']}, {'$set': {'is_pro': False}})
    user = await db.users.find_one({'id': user['id']}, {'_id': 0})
    return user_public(user)

@api_router.post("/me/airlines", response_model=UserPublic)
async def add_airline(payload: AirlineProfile, user: dict = Depends(get_current_user)):
    if not user.get('is_pro', False):
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
        existing = await db.templates.count_documents({'is_official': True})
        if existing >= len(DEFAULT_TEMPLATES):
            return
        for t in DEFAULT_TEMPLATES:
            already = await db.templates.find_one({'title': t['title'], 'is_official': True})
            if already:
                continue
            tpl = Template(**t)
            await db.templates.insert_one(tpl.dict())
        logger.info(f'Seeded {len(DEFAULT_TEMPLATES)} official templates')
    except Exception as e:
        logger.warning(f'Template seed skipped: {e}')

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
