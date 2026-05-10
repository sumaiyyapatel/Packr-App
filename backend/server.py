from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
import httpx

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
    return UserPublic(id=u['id'], email=u['email'], name=u.get('name'), created_at=u['created_at'])

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
