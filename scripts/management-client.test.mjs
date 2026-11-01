import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createManagementClient, ManagementError, managementOrigin, insideSendWindow } from '../src/management-client.mjs';

const origin='https://admin.example.test';
const password='synthetic-admin-password-for-tests';
const requestId='d168f1c3-2434-458c-b06d-58ced5b4f2ae';

test('management requests only use a clean HTTPS origin and the requested send window',()=>{
  assert.equal(managementOrigin(origin+'/'),origin);
  for(const value of ['http://admin.example.test','https://user:secret@admin.example.test','https://admin.example.test/path','https://admin.example.test/?token=secret','javascript:alert(1)'])assert.equal(managementOrigin(value),'');
  assert.equal(insideSendWindow(new Date('2026-11-01T07:29:59+08:00')),false);
  assert.equal(insideSendWindow(new Date('2026-11-01T07:30:00+08:00')),true);
  assert.equal(insideSendWindow(new Date('2026-11-01T21:59:59+08:00')),true);
  assert.equal(insideSendWindow(new Date('2026-11-01T22:00:00+08:00')),false);
});

test('a send with an uncertain POST response is never retried and retains its operation ID',async()=>{
  const calls=[];
  const client=createManagementClient({baseUrl:origin,password,fetcher:async(url,options)=>{calls.push({url,options});throw new TypeError('simulated connection drop');}});
  await assert.rejects(client.send(['abcde12345abcde1'],requestId),error=>error instanceof ManagementError&&error.code==='network_error'&&error.requestId===requestId);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+password);
  assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.referrerPolicy,'no-referrer');
  assert(!calls[0].url.includes(password));
  assert(!calls[0].options.body.includes(password));
  assert.deepEqual(JSON.parse(calls[0].options.body),{recipient_ids:['abcde12345abcde1'],request_id:requestId});
});

test('saving preserves the revision and request ID, then polls without repeating the mutation',async()=>{
  const calls=[];
  const replies=[{request_id:requestId},{request_id:requestId,state:'queued'},{request_id:requestId,state:'running'},{request_id:requestId,state:'completed',ok:true,result:{users:[],revision:'new-sha'}}];
  const client=createManagementClient({baseUrl:origin,password,fetcher:async(url,options)=>{calls.push({url,options});return Response.json(replies.shift());}});
  const users=[{id:'abcde12345abcde1',name:'测试接收人',city:'郑州',latitude:34.75,longitude:113.62,enabled:true}];
  const id=await client.save(users,'old-sha',requestId);
  const updates=[];
  const result=await client.poll(id,{pollMs:1,onUpdate:value=>updates.push(value.state)});
  assert.equal(result.result.revision,'new-sha');
  assert.deepEqual(updates,['queued','running','completed']);
  assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
  assert.deepEqual(JSON.parse(calls[0].options.body),{users,expected_revision:'old-sha',request_id:requestId});
  assert(calls.slice(1).every(call=>call.url===origin+'/api/operations/'+requestId&&call.options.method==='GET'));
});

test('temporary polling connection failure only repeats reads and can still finish',async()=>{
  let calls=0;
  const client=createManagementClient({baseUrl:origin,password,fetcher:async()=>{calls++;if(calls===1)throw new TypeError('offline');return Response.json({request_id:requestId,state:'completed',ok:true,result:{deliveries:[]}});}});
  const states=[];
  const result=await client.poll(requestId,{pollMs:1,timeoutMs:100,onUpdate:value=>states.push(value.state)});
  assert.equal(result.state,'completed');
  assert.equal(calls,2);
  assert.deepEqual(states,['connection_pending','completed']);
});

test('poll timeout keeps the ID for a later read and authentication rejection stops immediately',async()=>{
  const client=createManagementClient({baseUrl:origin,password,fetcher:async()=>Response.json({request_id:requestId,state:'queued'})});
  await assert.rejects(client.poll(requestId,{timeoutMs:0}),error=>error.code==='operation_pending'&&error.requestId===requestId);
  let calls=0;
  const rejected=createManagementClient({baseUrl:origin,password,fetcher:async()=>{calls++;return Response.json({error:{message:'ignored'}},{status:401});}});
  await assert.rejects(rejected.poll(requestId,{pollMs:1,timeoutMs:100}),error=>error.code==='unauthorized');
  assert.equal(calls,1);
});

test('city lookup encodes only the city query and a malformed operation ID makes no request',async()=>{
  const calls=[];
  const client=createManagementClient({baseUrl:origin,password,fetcher:async(url,options)=>{calls.push({url,options});return Response.json({cities:[{city:'郑州',latitude:34.75,longitude:113.62}]});}});
  const cities=await client.cities('郑州');
  assert.equal(cities[0].city,'郑州');
  assert.equal(calls[0].url,origin+'/api/cities?q='+encodeURIComponent('郑州'));
  assert(!calls[0].url.includes(password));
  await assert.rejects(client.operation('../invalid?password='+password),error=>error.code==='invalid_request');
  assert.equal(calls.length,1);
});
