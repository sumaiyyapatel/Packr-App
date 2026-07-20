/**
 * Open-Meteo direct from the client (no API key, CORS-friendly).
 * Replaces the backend /weather and /geocode proxy endpoints.
 */

export type DailyForecast = {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  weather_code: number[];
};

export type GeocodeResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
};

const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

async function cachedGetJson<T>(url: string): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data as T;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather service error (${response.status})`);
  const data = (await response.json()) as T;
  cache.set(url, { at: Date.now(), data });
  return data;
}

export async function fetchDailyForecast(
  latitude: number,
  longitude: number,
  startDate?: string,
  endDate?: string
): Promise<DailyForecast | null> {
  const base = 'https://api.open-meteo.com/v1/forecast';
  const common =
    `latitude=${latitude}&longitude=${longitude}` +
    '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto';
  const ranged = startDate && endDate ? `&start_date=${startDate}&end_date=${endDate}` : '&forecast_days=14';
  try {
    const data = await cachedGetJson<{ daily?: DailyForecast }>(`${base}?${common}${ranged}`);
    return data.daily ?? null;
  } catch {
    if (startDate && endDate) {
      // Dates outside the forecast window — fall back to the next 14 days.
      try {
        const data = await cachedGetJson<{ daily?: DailyForecast }>(`${base}?${common}&forecast_days=14`);
        return data.daily ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function geocodeCity(query: string): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const data = await cachedGetJson<{ results?: Array<Record<string, unknown>> }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en`
    );
    return (data.results ?? []).map((item) => ({
      name: String(item.name ?? ''),
      country: item.country ? String(item.country) : undefined,
      admin1: item.admin1 ? String(item.admin1) : undefined,
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
    }));
  } catch {
    return [];
  }
}
