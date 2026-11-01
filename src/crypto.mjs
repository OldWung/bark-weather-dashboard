const ITERATIONS = 310000;
const ADDITIONAL_DATA = new TextEncoder().encode("bark-weather-dashboard:v1");

export class UnlockError extends Error {
  constructor(message) { super(message); this.name = "UnlockError"; }
}

function bytes(value, length, maximum = length) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new UnlockError("加密记录格式不正确，请稍后刷新。");
  let raw;
  try { raw = atob(value); } catch { throw new UnlockError("加密记录格式不正确，请稍后刷新。"); }
  if (raw.length < length || raw.length > maximum) throw new UnlockError("加密记录格式不正确，请稍后刷新。");
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function decryptStatus(envelope, password) {
  if (!globalThis.crypto?.subtle) throw new UnlockError("请使用 HTTPS 地址及较新版本的 Safari、Chrome 或 Edge 浏览器。");
  if (typeof password !== "string" || !password.length) throw new UnlockError("请输入查看密码。");
  if (!envelope || envelope.version !== 1 || envelope.kdf !== "PBKDF2" || envelope.hash !== "SHA-256" || envelope.iterations !== ITERATIONS) throw new UnlockError("加密记录版本暂不支持，请刷新页面。");
  const salt = bytes(envelope.salt, 16);
  const iv = bytes(envelope.iv, 12);
  const ciphertext = bytes(envelope.ciphertext, 17, 6000000);
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:ITERATIONS}, material, {name:"AES-GCM",length:256}, false, ["decrypt"]);
  let plain;
  try { plain = await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:ADDITIONAL_DATA,tagLength:128}, key, ciphertext); }
  catch { throw new UnlockError("密码不正确，或加密文件尚未完整更新。请检查密码后重试。"); }
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(plain)); }
  catch { throw new UnlockError("记录内容暂时无法读取，请稍后刷新。"); }
  if (!value || !Array.isArray(value.runs) || !("snapshot" in value) || (value.snapshot !== null && (!Array.isArray(value.snapshot.devices) || !Array.isArray(value.snapshot.deliveries)))) throw new UnlockError("记录内容格式不正确，请稍后刷新。");
  if (/"(?:device_key|bark_urls?|github_actions_token|cronjob_api_key|Authorization)"\s*:|github_pat_|https:\/\/api\.day\.app\//i.test(JSON.stringify(value))) throw new UnlockError("记录包含不应展示的配置，已停止读取。");
  return value;
}

/** @param {string} password @param {{signal?: AbortSignal, base?: string}} [options] */
export async function fetchEncryptedStatus(password, {signal, base = import.meta.env?.BASE_URL || "/bark-weather-dashboard/"} = {}) {
  const response = await fetch(base + "data/status.enc.json", {cache:"no-store",signal});
  if (!response.ok) throw new UnlockError(response.status === 404 ? "正在等待首份加密记录发布，请稍后重试。" : "暂时无法下载加密记录，请稍后刷新。");
  let envelope;
  try { envelope = await response.json(); } catch { throw new UnlockError("加密记录尚未更新完成，请稍后重试。"); }
  return decryptStatus(envelope, password);
}
