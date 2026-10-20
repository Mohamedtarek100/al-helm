import { beforeEach, describe, expect, it } from 'vitest'
import type { AppData } from '../../types'
import { createInitialData } from '../domain'
import { PersistenceCoordinator, type CloudPersistence } from './coordinator'
import { MemoryAdapter } from './adapter'

class MockCloud implements CloudPersistence {
  beforeSave?:()=>Promise<void>
  readonly kind='cloud' as const
  readonly label='mock cloud'
  user='user-a'
  session=true
  remote:AppData|null=null
  failSave=false
  failTable:string|null=null
  calls=0
  async userId(){if(!this.session)throw Error('no session');return this.user}
  async hasSession(){return this.session}
  async isCloudEmpty(){return !this.remote||!hasRecords(this.remote)}
  async load(){if(!this.session)throw Error('no session');return this.remote?structuredClone(this.remote):null}
  async save(data:AppData){if(this.beforeSave)await this.beforeSave();if(this.failSave)throw Error('save failed');this.calls++;this.remote=structuredClone(data);if(this.failTable)throw Error(`partial failure at ${this.failTable}`)}
  async clear(){throw Error('not allowed')}
}
const hasRecords=(d:AppData)=>d.subjects.length+d.sessions.length+d.tasks.length+d.focusSessions.length+d.journal.length+d.goals.length+d.artworks.length+d.challenges.length+d.letters.length+d.exams.length>0
function localWithTask(){const d=createInitialData();d.tasks.push({id:'task-local',title:'local',description:'',subjectId:null,dueDate:'2026-10-20',dueTime:'',priority:'medium',category:'study',estimatedMinutes:30,completed:false,completedAt:null,createdAt:'a',updatedAt:'a'});return d}

describe('PersistenceCoordinator local/cloud contract (mock cloud; no live backend)',()=>{
 let local:MemoryAdapter,cloud:MockCloud,coordinator:PersistenceCoordinator
 beforeEach(async()=>{local=new MemoryAdapter();cloud=new MockCloud();coordinator=new PersistenceCoordinator(local,cloud);await coordinator.initialize()})
 it('keeps local writes local until authentication and persists the local snapshot',async()=>{const data=localWithTask();await coordinator.persist(data);expect((await local.load())?.tasks).toHaveLength(1);expect(cloud.calls).toBe(0);expect(coordinator.snapshot().mode).toBe('local')})
 it('refuses cloud restore without a valid session and retains local state',async()=>{await coordinator.persist(localWithTask());await coordinator.initialize();cloud.session=false;const result=await coordinator.authenticate('user-a');expect(result.mode).toBe('local');expect(result.data.tasks).toHaveLength(1);expect(result.error).toContain('session')})
 it('loads cloud only for the matching authenticated identity',async()=>{cloud.remote=localWithTask();await coordinator.initialize();const result=await coordinator.authenticate('user-a');expect(result.mode).toBe('cloud');expect(result.data.tasks[0].id).toBe('task-local');cloud.user='user-b';await expect(coordinator.persist(result.data)).rejects.toThrow('expired');expect(coordinator.snapshot().userId).toBeNull()})
 it('preserves data and never claims cloud save succeeded after failure',async()=>{cloud.remote=localWithTask();await coordinator.initialize();const active=await coordinator.authenticate('user-a');const changed=structuredClone(active.data);changed.tasks.push({...changed.tasks[0],id:'task-new'});cloud.failSave=true;await expect(coordinator.persist(changed)).rejects.toThrow('save failed');expect(coordinator.snapshot().status).toBe('error');expect(coordinator.snapshot().data.tasks).toHaveLength(2);expect(cloud.remote?.tasks).toHaveLength(1)})
 it('refuses migration into a non-empty cloud account without an upload',async()=>{await coordinator.persist(localWithTask());cloud.remote=localWithTask();const loaded=await coordinator.authenticate('user-a');expect(loaded.migrationRequired).toBe(false);await expect(coordinator.migrateLocalToCloud('user-a')).rejects.toThrow('not been explicitly enabled')})
 it('requires local records and an empty remote before explicit migration, then prevents repeat import',async()=>{await coordinator.persist(localWithTask());cloud.remote=null;await coordinator.authenticate('user-a');const user=coordinator.snapshot().userId;await expect(coordinator.migrateLocalToCloud(user!)).resolves.toMatchObject({tasks:[{id:'task-local'}]});const count=cloud.calls;await expect(coordinator.migrateLocalToCloud(user!)).rejects.toThrow('already been migrated');expect(cloud.calls).toBe(count);expect((await local.load())?.tasks).toHaveLength(1)})
 it('does not overwrite local records on partial cloud failures',async()=>{await coordinator.persist(localWithTask());cloud.remote=null;const result=await coordinator.authenticate('user-a');expect(result.migrationRequired).toBe(true);cloud.failTable='tasks';await expect(coordinator.migrateLocalToCloud('user-a')).rejects.toThrow('partial failure');expect((await local.load())?.tasks).toHaveLength(1);expect(coordinator.snapshot().mode).toBe('local')})
   it('clears prior-account in-memory data on logout',async()=>{await coordinator.persist(localWithTask());cloud.remote=createInitialData();await coordinator.initialize();const signed=await coordinator.authenticate('user-a');expect(signed.mode).toBe('cloud');const loggedOut=coordinator.logout();expect(loggedOut.mode).toBe('local');expect(loggedOut.userId).toBeNull();expect(loggedOut.data.tasks).toHaveLength(1)})
   it('rejects migration when the destination cloud is populated',async()=>{await local.save(localWithTask());cloud.remote=localWithTask();await coordinator.initialize();const authenticated=await coordinator.authenticate('user-a');expect(authenticated.mode).toBe('cloud');await expect(coordinator.migrateLocalToCloud('user-a')).rejects.toThrow('not been explicitly enabled');expect(cloud.calls).toBe(0)})
   it('retains the last verified cloud snapshot when a save fails, then recovers by retry',async()=>{cloud.remote=localWithTask();await coordinator.initialize();const auth=await coordinator.authenticate('user-a');const changed=structuredClone(auth.data);changed.tasks[0].title='edited';cloud.failSave=true;await expect(coordinator.persist(changed)).rejects.toThrow('save failed');expect(coordinator.snapshot().data.tasks[0].title).toBe('edited');cloud.failSave=false;await coordinator.retry();expect(coordinator.snapshot().status).toBe('ready');expect(cloud.remote?.tasks[0].title).toBe('edited')})
  it('serializes account switching behind an in-flight migration',async()=>{await local.save(localWithTask());cloud.remote=null;await coordinator.initialize();await coordinator.authenticate('user-a');let release!:()=>void;let entered!:()=>void;const enteredPromise=new Promise<void>(resolve=>{entered=resolve});cloud.beforeSave=()=>new Promise<void>(resolve=>{release=resolve;entered()});const migration=coordinator.migrateLocalToCloud('user-a');await enteredPromise;const switchAccount=coordinator.authenticate('user-b');release();await migration;const result=await switchAccount;console.log(JSON.stringify({user:result.userId,error:result.error,mode:result.mode,task:result.data.tasks[0]?.id}));expect(result.error).toContain('did not match');expect(result.data.tasks[0]?.id).toBe('task-local')})
 })
