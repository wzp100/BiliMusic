export function normalizeBiliImageUrl(url: string): string {
  if (!url) return ''
  const normalized = url.startsWith('https://')
    ? url
    : url.startsWith('http://')
      ? url.replace('http://', 'https://')
      : url.startsWith('//')
        ? `https:${url}`
        : `https:${url}`

  if (
    typeof window !== 'undefined'
    && !window.electronAPI?.biliApi
    && ['localhost', '127.0.0.1'].includes(window.location.hostname)
    && /https:\/\/i\d+\.hdslb\.com\//.test(normalized)
  ) {
    return `${window.location.origin}/bili-image/${normalized.replace(/^https?:\/\//, 'https:/')}`
  }

  return normalized
}
