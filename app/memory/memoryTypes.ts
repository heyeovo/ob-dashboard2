export interface Bucket {
  id: string
  name: string
  type: string
  domain: string[]
  tags: string[]
  valence: number
  arousal: number
  importance: number
  resolved: boolean
  pinned: boolean
  digested?: boolean
  created: string
  last_active: string
  score: number
  activation_count?: number
  content_preview: string
  wish?: boolean
  todo?: string
  todo_done?: boolean
  related?: string[]
  noise?: boolean  // resolved + importance==1
  event_time?: string
}

export interface BucketDetail {
  id: string
  content: string
  score: number
  noise?: boolean
  metadata: {
    name: string
    domain: string[]
    tags: string[]
    valence: number
    arousal: number
    importance: number
    pinned: boolean
    resolved: boolean
    digested?: boolean
    type: string
    created: string
    last_active: string
    activation_count?: number
    wish?: boolean
    todo?: string
    todo_done?: boolean
    related?: string[]
    event_time?: string
  }
}

export type QuickFilter = 'all' | 'pinned' | 'important' | 'feel' | 'digested' | 'resolved' | 'archived' | 'noise' | 'other'
export type DatePreset = 'all' | '7d' | '30d' | '90d' | 'custom'
