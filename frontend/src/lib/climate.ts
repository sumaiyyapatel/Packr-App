import { WardrobeItem } from './api';

export type Climate = 'cold' | 'cool' | 'mild' | 'warm' | 'tropical' | 'unknown';

export type DailyForecast = {
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
};

export function classifyClimate(daily: DailyForecast | null | undefined): {
  climate: Climate;
  avgMin: number;
  avgMax: number;
  avgPrecip: number;
} {
  if (!daily?.temperature_2m_max?.length) {
    return { climate: 'unknown', avgMin: 0, avgMax: 0, avgPrecip: 0 };
  }
  const max = daily.temperature_2m_max!;
  const min = daily.temperature_2m_min || [];
  const precip = daily.precipitation_sum || [];
  const avgMax = max.reduce((a, b) => a + b, 0) / max.length;
  const avgMin = min.length ? min.reduce((a, b) => a + b, 0) / min.length : avgMax - 6;
  const avgPrecip = precip.length ? precip.reduce((a, b) => a + b, 0) / precip.length : 0;

  let climate: Climate = 'mild';
  if (avgMax >= 30) climate = 'tropical';
  else if (avgMax >= 24) climate = 'warm';
  else if (avgMax >= 16) climate = 'mild';
  else if (avgMax >= 8) climate = 'cool';
  else climate = 'cold';

  return { climate, avgMin, avgMax, avgPrecip };
}

const COLD_TAGS = ['snow', 'wool', 'thermal'];
const WARM_TAGS = ['tropical', 'beach', 'linen', 'breathable'];
const RAIN_TAGS = ['waterproof', 'shell', 'rain'];

/**
 * Look at the items in the trip's grid and compare to the climate.
 * Returns a list of human-readable warnings (empty array means no issues).
 */
export function checkClimateFit(
  grid: (string | null)[],
  itemsById: Record<string, WardrobeItem>,
  daily: DailyForecast | null | undefined
): { climate: Climate; avgMin: number; avgMax: number; warnings: string[] } {
  const cls = classifyClimate(daily);
  const filled = grid.map((id) => (id ? itemsById[id] : null)).filter(Boolean) as WardrobeItem[];
  if (filled.length === 0 || cls.climate === 'unknown') {
    return { ...cls, warnings: [] };
  }

  const allTags = new Set<string>();
  for (const it of filled) {
    for (const t of it.tags || []) allTags.add(t.toLowerCase().replace('#', ''));
  }

  const warnings: string[] = [];

  if (cls.climate === 'cold') {
    const hasWarm = COLD_TAGS.some((t) => allTags.has(t));
    if (!hasWarm) {
      warnings.push(
        `Avg high ${cls.avgMax.toFixed(0)}°C — your grid lacks any #snow / #wool / #thermal items.`
      );
    }
    const tropicalCount = [...allTags].filter((t) => WARM_TAGS.includes(t)).length;
    if (tropicalCount >= 2) {
      warnings.push(
        `Cold trip but several items tagged #tropical/#beach/#linen — risk of underdressing.`
      );
    }
  }

  if (cls.climate === 'tropical' || cls.climate === 'warm') {
    const hasBreathable = WARM_TAGS.some((t) => allTags.has(t));
    if (!hasBreathable) {
      warnings.push(
        `Avg high ${cls.avgMax.toFixed(0)}°C — consider breathable items tagged #tropical or #linen.`
      );
    }
    const coldCount = [...allTags].filter((t) => COLD_TAGS.includes(t)).length;
    if (coldCount >= 2) {
      warnings.push(`Warm trip but multiple #snow/#wool items — likely too heavy.`);
    }
  }

  if (cls.avgPrecip >= 5) {
    const hasRain = RAIN_TAGS.some((t) => allTags.has(t));
    if (!hasRain) {
      warnings.push(
        `Forecast shows rain (~${cls.avgPrecip.toFixed(1)}mm/day avg) — no #waterproof/#shell layer.`
      );
    }
  }

  return { ...cls, warnings };
}
