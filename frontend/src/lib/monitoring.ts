import { trackEvent } from './analytics';

let installed = false;

export function installMonitoring() {
  if (installed) return;
  installed = true;

  const errorUtils = (globalThis as any).ErrorUtils;
  if (!errorUtils?.getGlobalHandler || !errorUtils?.setGlobalHandler) return;

  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const value = error as { message?: string; stack?: string };
    trackEvent('app_error', {
      message: value?.message || String(error),
      stack: value?.stack?.slice(0, 1200),
      isFatal: Boolean(isFatal),
    });
    previous?.(error, isFatal);
  });
}
