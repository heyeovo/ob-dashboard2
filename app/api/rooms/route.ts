import { relayRooms } from '@/app/lib/roomServer'
export const dynamic = 'force-dynamic'
export async function GET() { return relayRooms('/api/rooms') }
