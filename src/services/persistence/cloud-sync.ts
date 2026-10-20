import type { PersistenceCoordinator } from './coordinator'
import { cloudAdapter } from './supabase'

const completionKey=(userId:string)=>`alhelm.v1.migration.${userId}`

let migrationInFlight: Promise<void> | null = null
let migrationCompletedForUser: string | null = null
/** Store owns the active coordinator; migration must use that same authenticated state. */
export async function migrateLocalDataToCloud(confirmReplace: boolean, userId: string, coordinator: PersistenceCoordinator): Promise<void> {
  if (!confirmReplace) throw new Error('Explicit confirmation is required before cloud migration.')
  if (migrationCompletedForUser === userId) throw new Error('This local snapshot has already been migrated for this account.')
  try { if(localStorage.getItem(completionKey(userId))==='complete') throw new Error('This local snapshot has already been migrated for this account.') } catch(error) { if(error instanceof Error && error.message.includes('already been migrated')) throw error }
  if (migrationInFlight) throw new Error('A migration is already running.')
  const cloud = cloudAdapter()
  if (!cloud || await cloud.userId() !== userId) throw new Error('The authenticated account changed; sign in again before migration.')
  migrationInFlight=(async()=>{
    await coordinator.migrateLocalToCloud(userId)
    migrationCompletedForUser=userId
    try { localStorage.setItem(completionKey(userId),'complete') } catch { /* coordinator also owns its durable device marker */ }
  })()
  try { await migrationInFlight } finally { migrationInFlight=null }
}
