export class ManagementError extends Error {
  /** @param {string} message @param {string} [code] @param {string|null} [requestId] */
  constructor(message, code = "request_failed", requestId = null) {
    super(message); this.name = "ManagementError"; this.code = code; this.requestId = requestId;
  }
}

export function managementOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return "";
    return url.origin;
  } catch { return ""; }
}

const sendStartHour = 8;
const sendEndHour = 22;
const hourLabel = hour => String(hour).padStart(2, "0") + ":00";
export const sendWindowLabel = `${hourLabel(sendStartHour)}–${hourLabel(sendEndHour)}`;

export function insideSendWindow(now = new Date()) {
  const hour = (now.getUTCHours() + 8) % 24;
  return hour >= sendStartHour && hour < sendEndHour;
}

const safeId = value => typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value);
const aborted = () => new DOMException("操作已取消", "AbortError");
const wait = (duration, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(aborted());
  const timeout = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, duration);
  const stop = () => { clearTimeout(timeout); reject(aborted()); };
  signal?.addEventListener("abort", stop, {once:true});
});

/** @param {{baseUrl:string,password:string,fetcher?:typeof fetch}} options */
export function createManagementClient({baseUrl, password, fetcher = globalThis.fetch}) {
  const origin = managementOrigin(baseUrl);
  if (!origin) throw new ManagementError("管理服务尚未连接，请稍后刷新页面。", "not_configured");
  if (!password) throw new ManagementError("请输入管理员密码。", "unauthorized");
  /** @param {string} path @param {{method?:string,body?:unknown,signal?:AbortSignal,requestId?:string}} [options] */
  async function request(path, {method = "GET", body, signal, requestId} = {}) {
    if (signal?.aborted) throw aborted();
    let response;
    try {
      response = await fetcher(origin + path, {
        method, headers:{Authorization:"Bearer " + password, ...(body === undefined ? {} : {"Content-Type":"application/json"})},
        body:body === undefined ? undefined : JSON.stringify(body), credentials:"omit", cache:"no-store", redirect:"error", referrerPolicy:"no-referrer", signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw aborted();
      throw new ManagementError(method === "POST" ? "连接中断，请先查询本次操作结果，避免重复提交。" : "暂时无法连接管理服务，请稍后重试。", "network_error", requestId ?? null);
    }
    let value;
    try { value = await response.json(); }
    catch { throw new ManagementError("管理服务暂时无法读取，请稍后重试。", "invalid_response", requestId ?? null); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ManagementError("管理员密码不正确，或管理连接已失效。", "unauthorized");
      const code = typeof value?.error?.code === "string" ? value.error.code : "request_failed";
      const message = typeof value?.error?.message === "string" ? value.error.message.slice(0,200) : "本次操作未完成，请稍后重试。";
      throw new ManagementError(message, code, requestId ?? null);
    }
    return value;
  }
  const accepted = (value, fallback) => {
    const id = value?.request_id ?? value?.id ?? fallback;
    if (!safeId(id)) throw new ManagementError("未能确认操作编号，请先刷新接收人列表。", "invalid_response", fallback ?? null);
    return id;
  };
  return {
    /** @param {AbortSignal} [signal] */
    async recipients(signal) { const value = await request("/api/recipients", {signal}); return accepted(value); },
    /** @param {unknown[]} users @param {string|null} revision @param {string} requestId @param {AbortSignal} [signal] */
    async save(users, revision, requestId, signal) {
      const value = await request("/api/recipients", {method:"POST",body:{users,expected_revision:revision,request_id:requestId},requestId,signal});
      return accepted(value, requestId);
    },
    /** @param {string[]} ids @param {string} requestId @param {AbortSignal} [signal] */
    async send(ids, requestId, signal) {
      const value = await request("/api/send", {method:"POST",body:{recipient_ids:ids,request_id:requestId},requestId,signal});
      return accepted(value, requestId);
    },
    /** @param {string} query @param {AbortSignal} [signal] */
    async cities(query, signal) {
      const value = await request("/api/cities?q=" + encodeURIComponent(query.trim()), {signal});
      if (!Array.isArray(value?.cities)) throw new ManagementError("暂时没有找到城市，请换一个名称搜索。", "invalid_response");
      return value.cities;
    },
    /** @param {string} id @param {AbortSignal} [signal] */
    async operation(id, signal) {
      if (!safeId(id)) throw new ManagementError("操作编号无效，请重新读取接收人列表。", "invalid_request");
      return request("/api/operations/" + id, {signal});
    },
    /** @param {string} id @param {{signal?:AbortSignal,onUpdate?:(value:any)=>void,timeoutMs?:number,pollMs?:number}} [options] */
    async poll(id, {signal, onUpdate, timeoutMs = 180000, pollMs = 5000} = {}) {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        let value;
        try { value = await this.operation(id, signal); }
        catch (error) {
          if (signal?.aborted || error?.name === "AbortError" || error?.code === "unauthorized") throw error;
          if (Date.now() >= deadline) throw new ManagementError("云端操作结果暂未能读取，请继续查询，避免重复提交。", "operation_pending", id);
          onUpdate?.({request_id:id,state:"connection_pending"});
          await wait(Math.min(pollMs, Math.max(0, deadline-Date.now())), signal);
          continue;
        }
        onUpdate?.(value);
        if (["completed","failed"].includes(value?.state)) return value;
        if (Date.now() >= deadline) throw new ManagementError("云端仍在处理，可继续查询本次结果。请勿重复提交。", "operation_pending", id);
        await wait(Math.min(pollMs, Math.max(0, deadline-Date.now())), signal);
      }
    },
  };
}
