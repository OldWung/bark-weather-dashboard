import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronRight, Clock3, Eye, EyeOff, KeyRound, LockKeyhole, MapPin, Pencil, Plus, RefreshCw, Send, Settings2, ShieldCheck, Smartphone, Trash2, Users, X } from "lucide-react";
import { createManagementClient, insideSendWindow, managementOrigin, ManagementError } from "./management-client.mjs";

type User = {id:string;name:string;city:string;latitude:number;longitude:number;enabled:boolean;masked_bark_url?:string};
type Draft = {id?:string;name:string;city:string;latitude:number|null;longitude:number|null;enabled:boolean;bark_url:string;masked_bark_url?:string};
type City = {id:string|number;city:string;province?:string;country?:string;latitude:number;longitude:number};
type Operation = {request_id:string;state:string;ok?:boolean;result?:{users?:User[];revision?:string|null;deliveries?:unknown[];[key:string]:unknown};error?:{code?:string;message?:string}};
type Pending = {id:string;kind:"read"|"save"|"send"};
type Mode = "settings"|"send";
const API_ORIGIN = managementOrigin(import.meta.env.VITE_MANAGEMENT_API_URL || "");
const defaults = (count:number):Draft => ({name:`接收人 ${count+1}`,city:"郑州",latitude:34.75,longitude:113.62,enabled:true,bark_url:""});
const messageFor = (error:unknown) => error instanceof ManagementError ? error.message : "操作暂时无法完成，请稍后重试。";
const idFor = () => crypto.randomUUID();
const noSendMessage = (outcome:unknown) => outcome==="quiet_hours" ? "云端处理时已进入免打扰时段，本次没有发送通知。" : ["duplicate_suppressed","already_attempted"].includes(String(outcome)) ? "同一次发送请求已经处理，本次没有重复发送。" : ["skipped_quiet_hours_or_stale","weather_failed"].includes(String(outcome)) ? "本次没有发送通知，请稍后确认天气数据与允许发送时段。" : "本次没有新的发送结果，请刷新看板查看记录。";
const maskedAddress = (value:unknown) => {
  if(typeof value!=="string"||!value)return "Bark 地址已保存";
  if(value.includes("api.day.app/"))return "api.day.app/••••"+value.split("api.day.app/")[1].split(/[/?#]/)[0].slice(-4);
  return "Bark 地址已保存";
};

function deliveryItems(result:Operation["result"]):{id:string;name:string;city:string;status:string}[] {
  const raw = result?.deliveries ?? result?.recipient_results ?? (result?.report as Record<string,unknown>|undefined)?.recipient_results;
  if (!Array.isArray(raw)) return [];
  return raw.filter(value=>value&&typeof value==="object").map((value:Record<string,unknown>,index)=>({id:String(value.recipient_id??value.recipient??value.id??index),name:String(value.name??value.label??"接收人"),city:String(value.city??""),status:String(value.status??"unknown")}));
}
const statusName = (status:string) => ({accepted:"Bark 已接收",pending:"结果待确认",uncertain:"网络超时，结果未知",rejected:"Bark 未接受",weather_failed:"天气获取失败，未发送",skipped_quiet_hours_or_stale:"未发送：免打扰或天气已过期",quiet_hours:"未发送：免打扰时段",duplicate_suppressed:"相同操作已处理",disabled:"未发送：接收人已暂停"} as Record<string,string>)[status]??"请查看发送记录确认结果";

export default function Management({openMode,onClose,onChanged}:{openMode:Mode|null;onClose:()=>void;onChanged:()=>void}) {
  const [mode,setMode]=useState<Mode>("settings");
  const [passwordInput,setPasswordInput]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [authenticated,setAuthenticated]=useState(false);
  const [users,setUsers]=useState<User[]>([]);
  const [revision,setRevision]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [stage,setStage]=useState("");
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [pending,setPending]=useState<Pending|null>(null);
  const [draft,setDraft]=useState<Draft|null>(null);
  const [cities,setCities]=useState<City[]>([]);
  const [citySearching,setCitySearching]=useState(false);
  const [cityError,setCityError]=useState("");
  const [selected,setSelected]=useState<string[]>([]);
  const [confirmDelete,setConfirmDelete]=useState<string|null>(null);
  const [lastSend,setLastSend]=useState<Operation|null>(null);
  const [now,setNow]=useState(()=>new Date());
  const credential=useRef("");
  const controller=useRef<AbortController|null>(null);
  const generation=useRef(0);
  const activeRequest=useRef(false);
  const modal=useRef<HTMLDivElement|null>(null);

  useEffect(()=>{if(openMode)setMode(openMode);},[openMode]);
  useEffect(()=>{const timer=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(timer);},[]);
  useEffect(()=>()=>{generation.current++;controller.current?.abort();credential.current="";},[]);
  useEffect(()=>{
    if(!openMode)return;
    const previous=document.activeElement as HTMLElement|null;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    modal.current?.focus();
    const listener=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();if(event.key!=="Tab")return;const nodes=Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')??[]).filter(node=>node.offsetParent!==null);const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
    document.addEventListener("keydown",listener);
    return()=>{document.body.style.overflow=oldOverflow;document.removeEventListener("keydown",listener);previous?.focus();};
  },[openMode,onClose]);

  const logout=useCallback(()=>{
    generation.current++;controller.current?.abort();credential.current="";activeRequest.current=false;
    setAuthenticated(false);setPasswordInput("");setShowPassword(false);setUsers([]);setRevision(null);setDraft(null);setCities([]);setSelected([]);setPending(null);setBusy(false);setError("");setNotice("");setLastSend(null);setStage("");
  },[]);
  const client=()=>createManagementClient({baseUrl:API_ORIGIN,password:credential.current});
  const applyUsers=(result:Operation["result"])=>{
    if(!Array.isArray(result?.users))return;
    const normalized=result.users.map((user,index)=>({id:user.id,name:user.name||`接收人 ${index+1}`,city:user.city||"郑州",latitude:user.latitude??34.75,longitude:user.longitude??113.62,enabled:user.enabled!==false,masked_bark_url:maskedAddress(user.masked_bark_url)}));
    setUsers(normalized);setRevision(result?.revision??null);
    setSelected(previous=>previous.length?previous.filter(id=>normalized.some(user=>user.id===id&&user.enabled)):normalized.filter(user=>user.enabled).map(user=>user.id));
  };
  async function settle(id:string,kind:Pending["kind"],signal:AbortSignal,token:number) {
    const operation=await client().poll(id,{signal,onUpdate:(value:Operation)=>{
      if(token!==generation.current)return;
      setStage(value.state==="queued"?"已提交，等待云端处理…":value.state==="running"?kind==="send"?"正在获取各城市天气并发送…":"正在处理接收人设置…":value.state==="connection_pending"?"连接暂时中断，正在继续查询结果…":"正在读取结果…");
    }}) as Operation;
    if(token!==generation.current)return;
    setPending(null);setStage("");
    if(kind==="send")setLastSend(operation);
    if(operation.state==="failed"||operation.ok===false)throw new ManagementError(operation.error?.message||"本次操作未完成，请稍后查询发送记录。",operation.error?.code||"operation_failed",id);
    if(kind==="send"){
      setLastSend(operation);
      const items=deliveryItems(operation.result);
      const count=items.filter(item=>item.status==="accepted").length;
      setNotice(count?`${count} 位接收人的请求已被 Bark 接收。`:items.length?"本次尚无请求被确认接收，请查看逐人结果。":noSendMessage(operation.result?.outcome));
      onChanged();
    }else{applyUsers(operation.result);setNotice(kind==="save"?"接收人设置已保存并生效。":"接收人设置已同步。");if(kind==="save"){setDraft(null);setCities([]);setConfirmDelete(null);onChanged();}}
  }
  async function perform(kind:Pending["kind"],start:(signal:AbortSignal)=>Promise<string>) {
    if(activeRequest.current)return;
    activeRequest.current=true;setBusy(true);setError("");setNotice("");setStage(kind==="read"?"正在读取接收人设置…":kind==="save"?"正在提交设置…":"正在提交发送请求…");
    const aborter=new AbortController();controller.current=aborter;const token=generation.current;
    try{
      const id=await start(aborter.signal);
      if(token!==generation.current)return;
      setPending({id,kind});
      await settle(id,kind,aborter.signal,token);
    }catch(reason){
      if(token!==generation.current||aborter.signal.aborted)return;
      if(reason instanceof ManagementError&&reason.code==="unauthorized"){logout();setError(messageFor(reason));return;}
      if(reason instanceof ManagementError&&reason.requestId&&["operation_pending","network_error"].includes(reason.code))setPending({id:reason.requestId,kind});
      else setPending(null);
      setError(messageFor(reason));setStage("");
    }finally{if(token===generation.current){activeRequest.current=false;setBusy(false);}}
  }
  async function unlock(event:FormEvent){
    event.preventDefault();if(!passwordInput||busy)return;
    credential.current=passwordInput;setPasswordInput("");setShowPassword(false);
    await perform("read",async signal=>{const id=await client().recipients(signal);setAuthenticated(true);return id;});
  }
  const reload=()=>void perform("read",signal=>client().recipients(signal));
  const resume=()=>{if(!pending||busy)return;const saved=pending;void perform(saved.kind,async()=>saved.id);};
  async function saveUsers(next:Record<string,unknown>[]){
    if(next.length<1){setError("请至少保留一名接收人；如需停止推送，可以将接收人暂停。");return;}
    const requestId=idFor();
    await perform("save",signal=>client().save(next,revision,requestId,signal));
  }
  async function submitDraft(event:FormEvent){
    event.preventDefault();if(!draft||busy)return;
    if(!draft.name.trim()){setCityError("请填写接收人称呼。");return;}
    if(draft.latitude===null||draft.longitude===null||!draft.city.trim()){setCityError("请搜索并选定一个城市。");return;}
    if(!draft.id&&!draft.bark_url.trim()){setCityError("请填写接收人 iPhone 中复制的 Bark 推送地址。");return;}
    if(draft.bark_url.trim()){
      try{const url=new URL(draft.bark_url.trim());if(url.protocol!=="https:"||url.hostname!=="api.day.app"||!url.pathname.replaceAll("/",""))throw new Error();}
      catch{setCityError("请填写 https://api.day.app/ 开头的有效 Bark 地址。");return;}
    }
    const payload={...(draft.id?{id:draft.id}:{}),name:draft.name.trim(),city:draft.city.trim(),latitude:draft.latitude,longitude:draft.longitude,enabled:draft.enabled,...(draft.bark_url.trim()?{bark_url:draft.bark_url.trim()}: {})};
    const next=users.map(user=>user.id===draft.id?payload:{id:user.id,name:user.name,city:user.city,latitude:user.latitude,longitude:user.longitude,enabled:user.enabled});
    if(!draft.id)next.push(payload);
    setCityError("");await saveUsers(next);
  }
  async function searchCities(){
    if(!draft||citySearching||busy)return;
    if(!draft.city.trim()){setCityError("请输入城市名称，例如郑州、杭州。");return;}
    setCitySearching(true);setCityError("");setCities([]);
    const token=generation.current;
    try{const result=await client().cities(draft.city);if(token===generation.current){setCities(result as City[]);if(!result.length)setCityError("没有找到匹配城市，请尝试不带“市”字的名称。");}}
    catch(reason){if(token===generation.current)setCityError(messageFor(reason));}
    finally{if(token===generation.current)setCitySearching(false);}
  }
  const canSend=insideSendWindow(now);
  const enabled=users.filter(user=>user.enabled);
  const chosen=enabled.filter(user=>selected.includes(user.id));
  const send=()=>{if(!canSend||!chosen.length||busy)return;const requestId=idFor();void perform("send",signal=>client().send(chosen.map(user=>user.id),requestId,signal));};
  const resultItems=lastSend?deliveryItems(lastSend.result):[];
  if(!openMode)return null;
  return <div className="management-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div className="management-dialog" role="dialog" aria-modal="true" aria-labelledby="management-title" tabIndex={-1} ref={modal}>
    <header className="management-header"><div><p className="eyebrow">A LITTLE CARE, YOUR WAY</p><h2 id="management-title"><Users size={21}/>接收人与发送</h2></div><button className="management-icon-button" type="button" onClick={onClose} aria-label="关闭接收人管理"><X size={20}/></button></header>
    <div className="management-tabs"><button className={mode==="settings"?"active":""} onClick={()=>setMode("settings")}><Settings2 size={15}/>接收人设置</button><button className={mode==="send"?"active":""} onClick={()=>setMode("send")}><Send size={15}/>手动发送</button>{authenticated?<button className="management-lock" onClick={logout} disabled={busy}><LockKeyhole size={13}/>锁定管理</button>:null}</div>
    {!API_ORIGIN?<div className="management-empty"><ShieldCheck size={32}/><h3>管理服务正在准备中</h3><p>完成连接后，就可以为每位接收人设置城市并手动发送。</p></div>:!authenticated?<form className="management-auth" onSubmit={unlock}><span className="management-auth-icon"><KeyRound size={24}/></span><h3>用管理员密码进入</h3><p>查看密码只能看记录。管理员密码用于添加接收人、设置城市和发送通知。</p><label htmlFor="admin-password">管理员密码</label><div className="password-field"><LockKeyhole size={16}/><input id="admin-password" type={showPassword?"text":"password"} value={passwordInput} onChange={event=>setPasswordInput(event.target.value)} placeholder="输入独立管理员密码" autoComplete="off" spellCheck={false} disabled={busy} required/><button type="button" onClick={()=>setShowPassword(!showPassword)} aria-label={showPassword?"隐藏管理员密码":"显示管理员密码"}>{showPassword?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>{error?<p className="management-error" role="alert">{error}</p>:null}<button className="management-primary" type="submit" disabled={busy||!passwordInput}>{busy?<RefreshCw size={15} className="spinning"/>:<ShieldCheck size={15}/>} {busy?"正在连接…":"进入管理"}</button><small>管理员密码只保留在当前页面内存中，锁定或关闭页面后清除。</small></form>:<div className="management-content">
      {error?<div className="management-message warning" role="alert"><AlertCircle size={16}/><span>{error}</span></div>:null}
      {notice?<div className="management-message success" role="status"><CheckCircle2 size={16}/><span>{notice}</span></div>:null}
      {busy?<div className="management-progress" role="status"><RefreshCw size={15} className="spinning"/><span>{stage||"正在处理…"}</span><small>云端可能需要排队，请稍候。</small></div>:pending?<div className="management-progress"><Clock3 size={15}/><span>这次操作仍有结果待确认。</span><button type="button" className="management-text-button" onClick={resume}>继续查询<ChevronRight size={13}/></button></div>:null}
      {mode==="settings"?<><div className="management-section-heading"><div><h3>每个人，一座自己的城市</h3><p>未设置时默认郑州，通知按各自城市获取天气。</p></div><div className="management-actions"><button className="management-secondary" type="button" onClick={reload} disabled={busy||!!pending}><RefreshCw size={13}/>同步</button><button className="management-primary compact" type="button" onClick={()=>{setDraft(defaults(users.length));setCities([]);setCityError("");}} disabled={busy||!!pending||users.length>=20}><Plus size={14}/>添加接收人</button></div></div>
      <div className="management-users">{users.map(user=><article className={`management-user ${!user.enabled?"paused":""}`} key={user.id}><span className="management-user-icon"><Smartphone size={23}/></span><div className="management-user-details"><strong>{user.name}</strong><span><MapPin size={12}/>{user.city}<i>·</i>{user.enabled?"正在接收":"已暂停"}</span><small>{user.masked_bark_url||"Bark 地址已保存"}</small></div><div className="management-user-actions"><label className="management-switch"><input type="checkbox" checked={user.enabled} disabled={busy||!!pending} aria-label={`${user.name}${user.enabled?"暂停":"启用"}推送`} onChange={()=>void saveUsers(users.map(item=>({id:item.id,name:item.name,city:item.city,latitude:item.latitude,longitude:item.longitude,enabled:item.id===user.id?!item.enabled:item.enabled})))}/><span/></label><button type="button" className="management-icon-button" aria-label={`编辑${user.name}`} disabled={busy||!!pending} onClick={()=>{setDraft({...user,bark_url:""});setCities([]);setCityError("");}}><Pencil size={15}/></button><button type="button" className="management-icon-button" aria-label={`移除${user.name}`} disabled={busy||!!pending} onClick={()=>setConfirmDelete(confirmDelete===user.id?null:user.id)}><Trash2 size={15}/></button></div>{confirmDelete===user.id?<div className="management-delete-confirm"><span>移除后将不再向这位接收人推送。</span><button type="button" className="management-text-button" onClick={()=>setConfirmDelete(null)}>取消</button><button type="button" className="management-text-button danger" disabled={busy} onClick={()=>void saveUsers(users.filter(item=>item.id!==user.id).map(item=>({id:item.id,name:item.name,city:item.city,latitude:item.latitude,longitude:item.longitude,enabled:item.enabled})))}>确认移除</button></div>:null}</article>)}{!users.length&&!busy?<div className="management-empty"><Users size={30}/><p>还没有接收人，先添加一位吧。</p></div>:null}</div>
      {draft?<form className="management-editor" onSubmit={submitDraft}><div className="management-editor-top"><h3>{draft.id?"编辑接收人":"添加接收人"}</h3><button type="button" className="management-icon-button" onClick={()=>setDraft(null)} disabled={busy} aria-label="关闭接收人编辑"><X size={17}/></button></div><div className="management-form-grid"><label>接收人称呼<input value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})} maxLength={40} disabled={busy} required placeholder="例如：家人、小王"/></label><div className="management-city-field"><label htmlFor="recipient-city">所属城市</label><div className="management-city-search"><input id="recipient-city" value={draft.city} onChange={event=>{setDraft({...draft,city:event.target.value,latitude:null,longitude:null});setCities([]);}} disabled={busy} maxLength={40} placeholder="默认郑州" required/><button type="button" className="management-secondary" onClick={()=>void searchCities()} disabled={busy||citySearching}>{citySearching?<RefreshCw size={13} className="spinning"/>:<MapPin size={13}/>}搜索</button></div>{cities.length?<div className="management-city-options" role="listbox" aria-label="城市搜索结果">{cities.map(city=><button type="button" role="option" aria-selected={draft.city===city.city&&draft.latitude===city.latitude} key={city.id??`${city.city}-${city.latitude}-${city.longitude}`} onClick={()=>{setDraft({...draft,city:city.city,latitude:city.latitude,longitude:city.longitude});setCities([]);setCityError("");}}><MapPin size={13}/><span>{city.city}<small>{city.province??city.country??"中国"}</small></span><ChevronRight size={13}/></button>)}</div>:draft.latitude!==null?<small className="management-city-confirmed"><Check size={11}/>已选定 {draft.city}</small>:<small>输入后请搜索并选定城市</small>}</div><label className="management-wide">Bark 推送地址<input type="password" value={draft.bark_url} onChange={event=>setDraft({...draft,bark_url:event.target.value})} disabled={busy} autoComplete="off" spellCheck={false} placeholder={draft.id?"留空保留现有地址":"https://api.day.app/你的设备密钥"} required={!draft.id}/><small>{draft.id?"为保护设备密钥，不显示已保存的完整地址；仅在需要更换时填写。":"从接收人的 iPhone Bark 首页复制完整推送地址。"}</small></label></div>{cityError?<p className="management-error" role="alert">{cityError}</p>:null}<div className="management-editor-footer"><span><ShieldCheck size={12}/>地址只发送到管理服务，页面不公开保存。</span><button type="submit" className="management-primary compact" disabled={busy||!!pending}><Check size={14}/>{busy?"保存中…":"保存并生效"}</button></div></form>:null}
      <p className="management-footnote">最多支持 20 位接收人。修改称呼、城市或启用状态后，会直接保存到云端。</p></>:<><div className="management-section-heading"><div><h3>把此刻的天气，发给在意的人</h3><p>发送最新天气、当天情话与贴心提醒。</p></div><button type="button" className="management-secondary" onClick={reload} disabled={busy||!!pending}><RefreshCw size={13}/>同步接收人</button></div>{!canSend?<div className="management-message quiet"><Clock3 size={16}/><span>当前为免打扰时段。北京时间 07:30–22:00 之间才能手动发送。</span></div>:null}<div className="management-send-select"><label><input type="checkbox" checked={enabled.length>0&&chosen.length===enabled.length} disabled={busy||!!pending||!enabled.length} onChange={()=>setSelected(chosen.length===enabled.length?[]:enabled.map(user=>user.id))}/><span>全部启用的接收人</span></label><small>已选择 {chosen.length} 位</small></div><div className="management-send-users">{users.map(user=><label className={!user.enabled?"disabled":""} key={user.id}><input type="checkbox" checked={selected.includes(user.id)&&user.enabled} disabled={!user.enabled||busy||!!pending} onChange={()=>setSelected(previous=>previous.includes(user.id)?previous.filter(id=>id!==user.id):[...previous,user.id])}/><span className="management-user-icon"><Smartphone size={20}/></span><span><strong>{user.name}</strong><small>{user.city}天气{!user.enabled?" · 已暂停":""}</small></span><MapPin size={13}/></label>)}</div><div className="management-send-footer"><p><ShieldCheck size={13}/>同一次请求会自动去重。Bark 接受请求后，手机是否显示仍由通知设置决定。</p><button type="button" className="management-primary" onClick={send} disabled={!canSend||!chosen.length||busy||!!pending}><Send size={15}/>{busy?"正在处理…":`发送给 ${chosen.length} 位接收人`}</button></div>{lastSend?<section className="management-results" aria-live="polite"><h3>本次发送结果</h3>{resultItems.length?resultItems.map(item=><div key={item.id}><span>{users.find(user=>user.id===item.id)?.name??item.name}<small>{item.city}</small></span><b className={item.status==="accepted"?"success":""}>{statusName(item.status)}</b></div>):<p>{noSendMessage(lastSend.result?.outcome)}</p>}<p className="management-footnote">看板记录将在云端更新完成后显示，可能需要稍候。</p></section>:null}</>}
    </div>}
  </div></div>;
}
