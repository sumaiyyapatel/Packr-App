import { api } from './api';

type Props = Record<string, unknown>;

export async function trackEvent(name: string, properties: Props = {}) {
  try {
    await api.post('/analytics/events', { name, properties });
  } catch {
    // Analytics must never block user flows.
  }
}

export async function submitFeedback(message: string, context = 'app') {
  await api.post('/feedback', { message, context });
}
