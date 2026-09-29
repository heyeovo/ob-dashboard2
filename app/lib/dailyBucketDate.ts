export type DatedBucket = {
  id: string
  name?: string
  type?: string
  tags?: string[]
  created?: string
  event_time?: string
  metadata?: Record<string, unknown>
}

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
})

function dateKey(value?: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const direct = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (direct) return direct[1]
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : formatter.format(parsed)
}

function metadata(bucket: DatedBucket) {
  return bucket.metadata && typeof bucket.metadata === 'object' ? bucket.metadata : {}
}

export function isLegacyDailyImpression(bucket: DatedBucket): boolean {
  const meta = metadata(bucket)
  const tags = Array.isArray(bucket.tags) ? bucket.tags : Array.isArray(meta.tags) ? meta.tags : []
  const marker = meta.daily_impression
  return tags.some(tag => String(tag).toLowerCase() === 'daily_impression')
    || marker === true || marker === 1
    || (typeof marker === 'string' && ['true', '1', 'daily_impression'].includes(marker.toLowerCase()))
    || String(meta.type ?? bucket.type ?? '').toLowerCase() === 'daily_impression'
}

export function bucketDate(bucket: DatedBucket): string | null {
  const meta = metadata(bucket)
  return dateKey(bucket.event_time ?? meta.event_time ?? bucket.created ?? meta.created)
}

export function bucketName(bucket: DatedBucket): string {
  return bucket.name || String(metadata(bucket).name || '') || bucket.id
}
