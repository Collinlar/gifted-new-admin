import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
try {
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; create table tracks(id uuid primary key);`);
 for(const f of ['diagnostics_v1.sql','diagnostics_learner_v1.sql','diagnostics_learner_v1.sql'])await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
 const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 await db.query('insert into auth.users values ($1),($2)',[user,other]);await db.query('insert into tracks values ($1)',[user]);
 const paper={title:'Test',trackId:user,minimumEvidence:3,targetPercent:75,skills:[{id:'s',name:'Skill'}],questions:['beginner','intermediate','advanced'].map((difficulty,i)=>({id:'q'+i,skillId:'s',difficulty,options:['yes','no'],correctIndex:0,explanation:'because'}))};
 const d=(await db.query('insert into diagnostics(track_id,draft) values($1,$2) returning id',[user,paper])).rows[0].id;
 await db.query("select publish_diagnostic($1,1,$2,'test')",[d,paper]);
 const id=(await db.query('insert into diagnostic_assignments(diagnostic_id,version,track_id,user_id) values($1,1,$2,$2) returning id',[d,user])).rows[0].id;
 const call=async(name,args)=> (await db.query(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
 await assert.rejects(call('learner_diagnostic',[id]),/not assigned/);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 let state=await call('learner_diagnostic',[id]);assert.equal(state.paper.questions[0].correctIndex,undefined);assert.equal(state.paper.questions[0].explanation,undefined);
 state=await call('learner_diagnostic',[id,{q0:0,q1:1,q2:1},1]);assert.equal(state.attempt.revision,2);
 await assert.rejects(call('learner_diagnostic',[id,{q0:1},1]),/another session/);
 await assert.rejects(call('learner_diagnostic',[id,{q0:99},2]),/outside/);
 assert.equal((await call('learner_diagnostic',[id])).attempt.answers.q0,0);
 const report=await call('submit_diagnostic',[id,2]);assert.equal(report.findings[0].status,'Needs development');
 assert.deepEqual(await call('submit_diagnostic',[id,2]),report);
 await assert.rejects(call('learner_diagnostic',[id,{q0:1},3]),/already been submitted/);
 assert.equal((await call('my_diagnostics',[]))[0].submitted,true);
 await assert.rejects(db.query('select * from diagnostic_versions'),/permission denied/);
 console.log('PASS migrations, ownership, hidden answer keys, save/resume, invalid answers, stale saves, scoring, repeat submission, final answer lock');
} finally{await db.close();}
