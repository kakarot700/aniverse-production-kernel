const LOCAL_WEBM_PATH = /^\/previews\/[a-z0-9][a-z0-9-]*\.webm$/i;

export function resolveLocalPreviewUrl(value?: string): string | undefined {
  return value && LOCAL_WEBM_PATH.test(value) ? value : undefined;
}
