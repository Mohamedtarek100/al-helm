import type { AppData } from '../../types'
import type { DataAdapter } from './adapter'
import { createInitialData, hydrateData } from '../domain'

export type PersistenceMode = 'local' | 'cloud'
export type PersistenceStatus = 'ready' | 'saving' | 'error'
export interface CloudPersistence extends DataAdapter {
  readonly kind: 'cloud'
  hasSession(): Promise<boolean>
  isCloudEmpty(): Promise<boolean>
  save(data: AppData): Promise<void>
  userId(): Promise<string>
}
export interface PersistenceState {
  data: AppData
  mode: PersistenceMode
  status: PersistenceStatus
  error: string | null
  userId: string | null
  migrationRequired: boolean
}

function hasRecords(data: AppData): boolean {
  return data.subjects.length + data.sessions.length + data.tasks.length + data.focusSessions.length + data.journal.length + data.goals.length + data.artworks.length + data.challenges.length + data.letters.length + data.exams.length > 0
}
function canonical(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`
  if(value&&typeof value==='object'){
    const entries=Object.entries(value as Record<string,unknown>).filter(([key])=>key!=='updatedAt'&&key!=='createdAt'&&key!=='imageUrl').sort(([a],[b])=>a.localeCompare(b))
    return `{${entries.map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
function sameRecordContent(left:AppData,right:AppData):boolean {
  const keys:(keyof AppData)[]=['subjects','sessions','tasks','focusSessions','journal','goals','artworks','challenges','letters','exams']
  return keys.every(key=>canonical(left[key])===canonical(right[key]))
}

/**
 * Coordinates the local recovery snapshot and authenticated cloud state. Local
 * data remains the source until an explicit, verified migration succeeds.
 */
export class PersistenceCoordinator {
  private localSnapshot: AppData = createInitialData()
  private cloudRecoverySnapshot: AppData | null = null
  private state: PersistenceState = { data:this.localSnapshot, mode:'local', status:'ready', error:null, userId:null, migrationRequired:false }
  private migration: Promise<AppData> | null = null
  private switching: Promise<PersistenceState> | null = null
  private requestedUser: string | null = null
  private releaseMigrationGate: (()=>void) | null = null
  private migrateCompleted = new Set<string>()
  private migrationRequiredForCurrentAccount = false
  private readonly local: DataAdapter
  private readonly cloud: CloudPersistence | null
  constructor(local: DataAdapter, cloud: CloudPersistence | null) { this.local=local; this.cloud=cloud }
  snapshot(): PersistenceState { return this.state }
  private markerKey(userId:string):string{return `alhelm.v1.migration.${userId}`}
  private async wasMigrated(userId:string):Promise<boolean>{
    if(this.migrateCompleted.has(userId))return true
    try{return localStorage.getItem(this.markerKey(userId))==='complete'}catch{return false}
  }
  async isMigrationComplete(userId:string):Promise<boolean>{return this.wasMigrated(userId)}
  private async markMigrated(userId:string):Promise<void>{
    if(typeof localStorage!=='undefined'){
      try{localStorage.setItem(this.markerKey(userId),'complete')}
      catch{throw new Error('Could not persist the migration marker; migration was not completed.')}
    }
    this.migrateCompleted.add(userId)
  }

  async initialize(): Promise<PersistenceState> {
    const local = await this.local.load()
    this.localSnapshot = hydrateData(local)

    this.state = { data:this.localSnapshot, mode:'local', status:'ready', error:null, userId:null, migrationRequired:false }
    return this.state
  }
  async refreshLocalSnapshot(data:AppData):Promise<void>{
    if(this.state.mode!=='local')throw new Error('Local edits cannot replace cloud state.')
    this.localSnapshot=structuredClone(data)
    this.state={...this.state,data:this.localSnapshot}
  }
  async refreshCloudSnapshot(data:AppData):Promise<void>{
    if(this.state.mode!=='cloud')throw new Error('Cloud snapshot is not active.')
    this.state={...this.state,data:structuredClone(data)}
  }

  async authenticate(userId: string): Promise<PersistenceState> {
    if (!this.cloud) throw new Error('Cloud storage is not configured.')
    if(this.migration){const inFlight=this.migration;await inFlight.catch(()=>undefined)}
    if(this.switching){
      const inFlight=this.switching
      await inFlight.catch(()=>undefined)
      return this.authenticate(userId)
    }
    this.requestedUser=userId
    const operation=this.authenticateOnce(userId)
    this.switching=operation
    try{return await operation}finally{if(this.switching===operation)this.switching=null}
  }
  private async authenticateOnce(userId:string):Promise<PersistenceState>{
    const cloud=this.cloud
    if(!cloud)throw new Error('Cloud storage is not configured.')
    const previousUser=this.state.userId
    const previousMode=this.state.mode
    const preservedLocal = await this.local.load()
    this.localSnapshot = hydrateData(preservedLocal)
    if(preservedLocal?.settings.customMotivation===`migration-complete:${userId}`){this.migrateCompleted.add(userId);this.localSnapshot.settings.customMotivation=''}
    if(previousUser&&previousUser!==userId)this.cloudRecoverySnapshot=null
    else if(previousMode==='cloud'&&previousUser===userId)this.localSnapshot=hydrateData(this.cloudRecoverySnapshot??preservedLocal)
    this.state = { data:this.localSnapshot, mode:'local', status:'ready', error:null, userId:null, migrationRequired:false }
    try {
      if(this.requestedUser!==userId)return this.state
      if (!(await cloud.hasSession())) throw new Error('An authenticated session is required.')
      if(this.requestedUser!==userId)return {...this.state,error:null}
      if (await cloud.userId() !== userId) {
        // The requested account is not the active session. Fall back to a
        // deterministic local state with only this device's local data; never
        // expose another account's cloud data and never fail the switch.
        this.state = { data:this.localSnapshot, mode:'local', status:'ready', error:`The authenticated user did not match the requested account ${userId}.`, userId:null, migrationRequired:hasRecords(this.localSnapshot) }
        return this.state
      }
      const remote = await cloud.load()
      if(this.requestedUser!==userId)return this.state
      if (await cloud.userId() !== userId) throw new Error('The signed-in account changed during cloud restore.')
      if (remote === null) {
        this.migrationRequiredForCurrentAccount=hasRecords(this.localSnapshot)
        this.state = { ...this.state, mode:'local', status:'ready', error:null, userId, migrationRequired:this.migrationRequiredForCurrentAccount }
        return this.state
      }
      this.migrationRequiredForCurrentAccount=false
      this.state = { data:hydrateData(remote), mode:'cloud', status:'ready', error:null, userId, migrationRequired:false }
      return this.state
    } catch (error) {
      this.state = { data:this.localSnapshot, mode:'local', status:'error', error:this.message(error), userId:null, migrationRequired:false }
      return this.state
    }
  }

  async migrateLocalToCloud(userId: string): Promise<AppData> {
    const cloud=this.cloud
    if (!cloud) throw new Error('Cloud storage is not configured.')
    if(this.migration) return this.migration
    if(await this.wasMigrated(userId)) throw new Error('This local snapshot has already been migrated for this account.')
    const task=this.migrateOnce(userId,cloud).then(value=>{this.migrateCompleted.add(userId);return value})
    this.migration=task.then(value=>{this.migration=null;this.releaseMigrationGate?.();this.releaseMigrationGate=null;return value},error=>{this.migration=null;this.releaseMigrationGate?.();this.releaseMigrationGate=null;throw error})
    return this.migration
  }

  private async migrateOnce(userId: string,cloud:CloudPersistence): Promise<AppData> {
    if (this.state.userId !== userId || !(await cloud.hasSession()) || await cloud.userId() !== userId) throw new Error('The signed-in account changed; sign in again before migrating.')
    if (!this.migrationRequiredForCurrentAccount || this.state.mode!=='local') throw new Error('Local data migration has not been explicitly enabled for this signed-in account.')
    if (!hasRecords(this.localSnapshot)) throw new Error('There is no saved local study data to migrate.')
    if (!(await cloud.isCloudEmpty())) throw new Error('Cloud data already exists. Nothing was uploaded.')
    this.state = { ...this.state, status:'saving', error:null }
    const candidate = hydrateData(this.localSnapshot)
    candidate.settings.storage = 'cloud'
    try {
      await cloud.save(candidate)
      if (await cloud.userId() !== userId) throw new Error('The signed-in account changed during migration.')
      const verified = await cloud.load()
      if (!verified || !sameRecordContent(candidate, verified)) throw new Error('Migration verification failed; your local snapshot was preserved.')
      const safeLocal=hydrateData(candidate)
      safeLocal.settings.storage='local'
      await this.local.save(safeLocal)
      await this.markMigrated(userId)
      this.cloudRecoverySnapshot=hydrateData(candidate)
      this.migrationRequiredForCurrentAccount=false
      this.state = { data:hydrateData(verified), mode:'cloud', status:'ready', error:null, userId, migrationRequired:false }
      return this.state.data
    } catch (error) {
      this.state = { ...this.state, mode:'local', status:'error', error:this.message(error), migrationRequired:true }
      throw error
    }
  }

  async persist(data: AppData): Promise<void> {
    if(this.switching) await this.switching.catch(()=>undefined)
    const snapshot = structuredClone(data)
    if (this.state.mode === 'local') {
      const previous=this.state
      snapshot.settings.storage='local'
      this.state = { ...this.state, data:snapshot, status:'saving', error:null }
      try {
        await this.local.save(snapshot)
        this.localSnapshot = snapshot
        this.state = { ...this.state, status:'ready', error:null }
      } catch (error) {
        this.state = { ...previous, status:'error', error:this.message(error) }
        throw error
      }
      return
    }
    const cloud=this.cloud, previous=this.state
    if (!cloud || !previous.userId || !(await cloud.hasSession()) || await cloud.userId() !== previous.userId) {
      this.logout()
      throw new Error('Cloud session expired. Local recovery data was retained; sign in again to sync.')
    }
    this.state = { ...this.state, data:snapshot, status:'saving', error:null }
    try {
      await cloud.save(snapshot)
      if (await cloud.userId() !== previous.userId) throw new Error('Account changed during save; sign in again.')
      this.cloudRecoverySnapshot=structuredClone(snapshot)
      this.state = { ...this.state, status:'ready', error:null }
    } catch (error) {
      this.state = { ...previous, data:snapshot, status:'error', error:this.message(error) }
      throw error
    }
  }

  async retry(): Promise<void> {
    const state=this.state
    await this.persist(state.data)
  }

  logout(): PersistenceState {
    this.requestedUser=null
    this.migrationRequiredForCurrentAccount=false
    const wasCloud=Boolean(this.state.userId)
    const safeLocal=wasCloud&&this.cloudRecoverySnapshot?this.cloudRecoverySnapshot:this.localSnapshot
    this.localSnapshot=hydrateData(safeLocal)
    this.state = { data:structuredClone(this.localSnapshot), mode:'local', status:'ready', error:null, userId:null, migrationRequired:false }
    return this.state
  }

  private message(error: unknown): string { return error instanceof Error ? error.message : 'Persistence failed.' }
}
