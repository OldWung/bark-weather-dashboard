import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { decryptStatus, fetchEncryptedStatus } from "../src/crypto.mjs";

// The producer uses Node's crypto API; the browser uses Web Crypto. These
// fixtures verify interoperability rather than calling the same implementation.
function encrypt(value, password) {
  const salt=randomBytes(16),iv=randomBytes(12);
  const key=pbkdf2Sync(password,salt,310000,32,"sha256");
  const cipher=createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(Buffer.from("bark-weather-dashboard:v1"));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final(),cipher.getAuthTag()]);
  return {version:1,kdf:"PBKDF2",hash:"SHA-256",iterations:310000,salt:salt.toString("base64"),iv:iv.toString("base64"),ciphertext:ciphertext.toString("base64")};
}
const password="synthetic-test-only-🔒";
const fixture={fetched_at:"2026-01-01T07:30:00+08:00",snapshot:{devices:[],deliveries:[],preview:{title:"测试",body:"仅合成数据"}},scheduler:null,runs:[],errors:[]};
const envelope=encrypt(fixture,password);
test("Node AES-GCM output decrypts with browser Web Crypto and UTF-8 password",async()=>{
  assert.deepEqual(await decryptStatus(envelope,password),fixture);
});
test("incorrect password and ciphertext tampering are rejected",async()=>{
  await assert.rejects(decryptStatus(envelope,"incorrect"),/密码不正确/);
  const bytes=Buffer.from(envelope.ciphertext,"base64");bytes[0]^=1;
  await assert.rejects(decryptStatus({...envelope,ciphertext:bytes.toString("base64")},password),/密码不正确/);
});
test("weak or unknown format and invalid salt are rejected before decrypting",async()=>{
  await assert.rejects(decryptStatus({...envelope,iterations:1},password),/版本/);
  await assert.rejects(decryptStatus({...envelope,salt:"AA=="},password),/格式/);
});
test("secret-bearing producer payload is not exposed to the dashboard",async()=>{
  const unsafe=encrypt({...fixture,device_key:"synthetic-private-key"},password);
  await assert.rejects(decryptStatus(unsafe,password),/配置/);
});
test("fetch only downloads the encrypted path and never transmits the password",async()=>{
  const original=globalThis.fetch;
  let received;
  globalThis.fetch=async(url,options)=>{received={url,options};return Response.json(envelope);};
  try{
    assert.deepEqual(await fetchEncryptedStatus(password,{base:"/bark-weather-dashboard/"}),fixture);
    assert.equal(received.url,"/bark-weather-dashboard/data/status.enc.json");
    assert(!JSON.stringify(received).includes(password));
    assert.equal(received.options.cache,"no-store");
  }finally{globalThis.fetch=original;}
});
