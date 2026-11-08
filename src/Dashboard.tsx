"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bell, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Cloud, CloudRain, CloudSun, Heart, History, LayoutDashboard, LockKeyhole, MapPin, RefreshCw, Send, Settings2, ShieldCheck, Smartphone, Sun, Sunrise, Users, Wind, XCircle, AlertCircle, Circle } from "lucide-react";
import Management from "./Management";
import { insideSendWindow, sendWindowLabel } from "./management-client.mjs";
import { normalizeRecipientTone, recipientToneLabels } from "./recipient-tone";

type Message = {title: string; body: string; group?: string};
type Delivery = {id: string; date: string; device_id: string; kind: string; scheduled_at?:string|null; attempted_at?: string|null; status: string; run_url?: string|null; message?: Message|null};
type Weather = {region?:string;temp?: string; weather?: string; wind_speed?: number; wind_gusts?: number; observed_at?: string; daily_low?: number; daily_high?: number; feels_like?:number; forecast_rain_probability?:number; forecast_uv_index?:number; forecast_low?:number};
type WeatherWarning = {id:string; title:string; description?:string; instruction?:string; issued_at?:string|null; expires_at?:string|null};
type RecipientWeather = {id:string;name?:string;city:string;enabled?:boolean;tone?:string;quote?:string|null;weather:Weather|null;hazard_reasons?:string[];warnings?:WeatherWarning[]|null;warning_status?:"checked"|"unavailable"|"unsupported";preview?:Message|null;care_tips?:string[];outcome?:string;status?:string};
type Snapshot = {generated_at: string; city: string; timezone?: string; recipient_count: number; history_available?:boolean; policy?: {daily_at?:string; daily_times?:string[]; next_regular_at?:string; window_start_inclusive?:string; window_end_exclusive?:string; poll_minutes?:number; wind_threshold_ms?:number; gust_threshold_ms?:number; primary_minutes?:number[]; recovery_minutes?:number[]; start_hour?:number; last_check_hour?:number}; care_tips?:string[];per_recipient?:RecipientWeather[]; latest_run?: {id?: string; url?:string; started_at?:string; mode?:string; trigger_source?:string; outcome?:string;per_recipient?:RecipientWeather[]; weather?:Weather|null; hazard_reasons?:string[]; quote?:string|null}; devices: {id:string; label:string; name?:string; city?:string; enabled?:boolean; tone?:string; latest_status?:string; latest_attempt_at?:string|null}[]; deliveries: Delivery[]; preview?:Message|null};
export type ApiData = {fetched_at: string; snapshot: Snapshot|null; scheduler: {enabled:boolean; timezone:string; next_execution:string|null; next_execution_estimated?:boolean; checked_at?:string; last_execution?:string|null; last_status?:number; status_text?:string; last_http_status?:number|null}|null; runs:{id:number|string; title:string; status:string; conclusion:string|null; created_at:string; updated_at?:string; url:string}[]; errors?:{source:string; message:string}[]};

const statusLabels: Record<string,string> = {accepted:"Bark 已接收",pending:"结果待确认",uncertain:"结果未知",rejected:"Bark 拒绝",skipped_quiet_hours_or_stale:"未发送"};
const timeFormat = new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai", hour:"2-digit",minute:"2-digit",hour12:false});
const dateFormat = new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai", month:"2-digit",day:"2-digit"});
const dayKey = (date=new Date()) => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
const validDate = (value?:string|null) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value) : null;
const clock = (value?:string|null) => {const d=validDate(value); return d?timeFormat.format(d):"—";};
const dateAndTime = (value?:string|null) => {const d=validDate(value);return d?`${dateFormat.format(d)} ${timeFormat.format(d)}`:"未记录时间";};
const kindLabels: Record<string,string> = {manual:"手动发送", monitor:"天气提醒", alert:"天气提醒", warning:"气象预警"};
const kindLabel=(delivery:Delivery) => delivery.message?.title||(delivery.kind==="daily"?(delivery.scheduled_at?`${delivery.scheduled_at} 例行提醒`:"例行提醒"):kindLabels[delivery.kind]??"历史推送");
const timeMinutes=(value?:string) => value&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
const safeLink=(value?:string|null) => typeof value==="string"&&/^https:\/\/github\.com\/OldWung\/wechat-weather-reminder\/actions\/runs\/\d+$/.test(value)?value:undefined;
const numeric = (value:unknown) => typeof value==="number"&&Number.isFinite(value)?value:null;
function nextCheck(now:Date,policy?:Snapshot["policy"]):string|null {
  const start=policy?.start_hour,last=policy?.last_check_hour;
  const minutes=[...new Set([...(policy?.primary_minutes??[]),...(policy?.recovery_minutes??[])])].filter(value=>Number.isInteger(value)&&value>=0&&value<60).sort((a,b)=>a-b);
  if(start===undefined||last===undefined||start<0||last>23||start>last||!minutes.length)return null;
  const local=new Date(now.getTime()+8*3600000);
  const day=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-8*3600000;
  for(let hour=start;hour<=last;hour++)for(const minute of minutes){const tick=day+(hour*60+minute)*60000;if(tick>now.getTime())return new Date(tick).toISOString();}
  return new Date(day+86400000+(start*60+minutes[0])*60000).toISOString();
}

function Badge({status}:{status?:string}) {
  const value=status||"unknown";
  const cls=value==="accepted"?"":value==="rejected"?"error":value==="pending"||value==="uncertain"?"warn":"neutral";
  return <span className={`badge ${cls}`}>{value==="accepted"?<Check size={10}/>:value==="rejected"?<XCircle size={10}/>:value==="uncertain"||value==="pending"?<AlertCircle size={10}/>:<Circle size={7}/>} {statusLabels[value]||"尚无记录"}</span>;
}

function WeatherWarnings({recipient}:{recipient?:RecipientWeather}) {
  if(!recipient||recipient.enabled===false)return null;
  const warnings=(recipient.warnings??[]).filter(warning=>{
    const expires=validDate(warning.expires_at);
    const issued=validDate(warning.issued_at);
    return (expires?.getTime()??(issued?issued.getTime()+86400000:0))>Date.now();
  });
  if(!recipient.warning_status&&!warnings.length)return null;
  const warningStatusLabels={
    checked:"最近检查没有发现生效中的气象预警。",
    unavailable:"暂时无法确认当地气象预警，请稍后查看。",
    unsupported:"当地暂未接入可用的官方气象预警。",
  };
  return <section className="weather-warnings" aria-label="气象预警">
    <h3><AlertCircle size={13}/>气象预警</h3>
    {warnings.length?<ul>{warnings.map(warning=><li key={warning.id}>
      <details>
        <summary>{warning.title}</summary>
        {validDate(warning.issued_at)?<small>发布于 {dateAndTime(warning.issued_at)}</small>:null}
        {validDate(warning.expires_at)?<small>有效至 {dateAndTime(warning.expires_at)}</small>:null}
        {warning.description?<p>{warning.description}</p>:null}
        {warning.instruction?<p>{warning.instruction}</p>:null}
      </details>
    </li>)}</ul>:recipient.warning_status?<p>{warningStatusLabels[recipient.warning_status]}</p>:null}
  </section>;
}

export default function Dashboard({loadStatus, initialData, onLock}:{loadStatus:(signal?:AbortSignal)=>Promise<ApiData>;initialData?:ApiData|null;onLock:()=>void}) {
  const [data,setData]=useState<ApiData|null>(initialData??null);
  const [loading,setLoading]=useState(!initialData);
  const [error,setError]=useState("");
  const [period,setPeriod]=useState("all");
  const [status,setStatus]=useState("all");
  const [previewMode,setPreviewMode]=useState<"latest"|"plan">("plan");
  const [now,setNow]=useState<Date|null>(null);
  const [recipientId,setRecipientId]=useState("");
  const [managementMode,setManagementMode]=useState<"settings"|"send"|null>(null);
  const closeManagement=useCallback(()=>setManagementMode(null),[]);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);
    try{
      const value=await loadStatus(signal);
      if(!value||!Array.isArray(value.runs)||!("snapshot" in value)) throw new Error("暂时无法读取看板数据。");
      setData(previous=>({...value,snapshot:value.snapshot??previous?.snapshot??null}));
      setError("");
      setNow(new Date());
    }catch(e){if(!(e instanceof Error&&e.name==="AbortError"))setError(e instanceof Error?e.message:"同步暂时中断，请稍后刷新。");}
    finally{if(!signal?.aborted)setLoading(false);}
  },[loadStatus]);
  useEffect(()=>{const controller=new AbortController();setNow(new Date());void refresh(controller.signal);const id=setInterval(()=>{void refresh(controller.signal);},60000);return()=>{controller.abort();clearInterval(id);};},[refresh]);
  const snapshot=data?.snapshot;
  const today=now?dayKey(now):"";
  const policy=snapshot?.policy;
  const regularTimes=(policy?.daily_times?.length?policy.daily_times:policy?.daily_at?[policy.daily_at]:[]).filter(value=>timeMinutes(value)!==null);
  const regularLabel=regularTimes.length?regularTimes.join(" · "):"等待规则同步";
  const sendStart=policy?.window_start_inclusive??regularTimes[0];
  const sendEnd=policy?.window_end_exclusive;
  const pollMinutes=policy?.poll_minutes;
  const previewTime=snapshot?.latest_run?.started_at??snapshot?.generated_at??policy?.next_regular_at;
  const recipientWeather = snapshot?.per_recipient ?? snapshot?.latest_run?.per_recipient;
  const perRecipient = recipientWeather ?? [];
  const recipient=perRecipient.find(value=>value.id===recipientId)??perRecipient[0];
  const careTips=(recipient?(recipient.care_tips??(recipient.id===perRecipient[0]?.id&&recipient.weather?snapshot?.care_tips??[]:[])):snapshot?.care_tips??[]).filter(value=>typeof value==="string");
  const deliveries=useMemo(()=>[...(snapshot?.deliveries??[])].sort((a,b)=>(b.attempted_at??b.date).localeCompare(a.attempted_at??a.date)),[snapshot]);
  const todayDeliveries=deliveries.filter(d=>d.date===today);
  const accepted=todayDeliveries.filter(d=>d.status==="accepted").length;
  const pending=todayDeliveries.filter(d=>d.status==="pending"||d.status==="uncertain"||d.status==="rejected").length;
  const deviceNames=new Map((snapshot?.devices??[]).map(d=>[d.id,d.name||d.label]));
  const lastMessage=deliveries.find(d=>d.message&&d.status==="accepted"&&(!recipient||d.device_id===recipient.id));
  const preview=previewMode==="plan"?(recipient?recipient.preview:snapshot?.preview):lastMessage?.message;
  const weather=recipient?recipient.weather:snapshot?.latest_run?.weather;
  const quote = recipientWeather ? recipient?.quote : snapshot?.latest_run?.quote;
  const weatherText=weather?.weather;
  const WeatherIcon=!weatherText?Cloud:/雨|雪|雷/.test(weatherText)?CloudRain:/云|阴|雾/.test(weatherText)?CloudSun:Sun;
  const wind=numeric(weather?.wind_speed), gust=numeric(weather?.wind_gusts);
  const hazard=(recipient?recipient.hazard_reasons:snapshot?.latest_run?.hazard_reasons)??[];
  const filtered=deliveries.filter(d=>{
    if(status!=="all"&&(status==="attention"?!["pending","uncertain","rejected"].includes(d.status):d.status!==status))return false;
    if(period==="today"&&d.date!==today)return false;
    if(period==="week"&&now){const cutoff=dayKey(new Date(now.getTime()-6*86400000));if(d.date<cutoff)return false;}
    return true;
  });
  const next=data?.scheduler?.enabled&&data.scheduler.next_execution_estimated&&now?(nextCheck(now,policy)??data.scheduler.next_execution):data?.scheduler?.next_execution;
  const disconnected=!!error||(data?.errors?.length??0)>0;
  const isQuiet=now!==null&&!insideSendWindow(now);
  const weatherStamp=weather?.observed_at;
  const historyUnavailable=snapshot?.history_available===false;

  return <div className="dashboard-shell">
    <aside className="side">
      <a className="brand" href="#overview" aria-label="早安推送看板"><div className="brand-icon"><Sunrise size={25} strokeWidth={1.5}/></div><div><strong>早安</strong><small>A LITTLE EVERYDAY</small></div></a>
      <div className="nav-caption">你的推送空间</div>
      <nav className="navigation" aria-label="页面导航"><a href="#overview"><LayoutDashboard size={17}/><span>推送概览</span></a><a href="#history"><History size={17}/><span>发送记录</span></a><a href="#rules"><Settings2 size={17}/><span>推送规则</span></a><button type="button" className="management-nav" onClick={()=>setManagementMode("settings")} aria-label="接收人设置"><Users size={17}/><span>接收人设置</span></button></nav>
      <div className="side-bottom"><div className="private-label"><LockKeyhole size={12}/>私人看板</div>每天一份天气，<br/>也一份小小的惦记。</div>
    </aside>
    <main className="main" id="overview">
      <header className="topbar"><div className="breadcrumb"><span>我的空间</span><ChevronRight size={12}/><span>推送概览</span></div><div className="live-controls"><span className="sync-text" role="status"><i className={`dot ${disconnected?"amber":""}`}/>{loading?"正在同步":disconnected?"部分数据待同步":"每分钟自动同步"}</span><button className="refresh manual-send-button" onClick={()=>setManagementMode("send")} disabled={isQuiet} title={isQuiet?`北京时间 ${sendWindowLabel} 之间可以手动发送`:"选择接收人并手动发送"}><Send size={13}/>{isQuiet?"免打扰时段":"手动发送"}</button><button className="refresh" onClick={()=>void refresh()} disabled={loading} aria-label="刷新推送状态"><RefreshCw size={13} className={loading?"spinning":""}/>刷新</button><button className="refresh" onClick={onLock} aria-label="锁定看板并清除当前解密内容"><LockKeyhole size={13}/>锁定</button></div></header>
      <div className="heading-row"><div><p className="eyebrow">A GOOD MORNING STARTS HERE</p><h1>早安，今天也有<em>好天气</em></h1><p className="subtitle">天气、情话，还有每一次如期而至的提醒，都在这里。</p></div><span className="today-pill"><CalendarDays size={13}/>{now?new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(now):"北京时间"}</span></div>
      {(error||data?.errors?.length)?<div className="error-note" role="alert">{error||data?.errors?.map(e=>e.message).join("；")} {snapshot?"已有记录仍可查看，请留意下方各项时间。":"数据恢复后将自动显示。"}</div>:null}
      <div className="metrics">
        <article className="metric"><div className="metric-label"><Clock3 size={13}/>下一次天气检查</div><div className="metric-value">{data?.scheduler?.enabled===false?"已暂停":clock(next)}<small>{next&&validDate(next)?dayKey(new Date(next))===today?"今天":"下次":""}</small></div><div className="metric-foot">按计划时间 · 北京时间<br/>以最近一次云端检查结果为准</div></article>
        <article className="metric"><div className="metric-label"><Bell size={13}/>今日推送记录</div><div className={`metric-value ${!snapshot?"skeleton":""}`}>{snapshot&&!historyUnavailable?accepted:"—"}<small>条已被 Bark 接收</small></div><div className="metric-foot">{historyUnavailable?"发送历史暂时不可用":pending?`${pending} 条需要确认结果`:snapshot?"按设备统计，每条状态均可追溯":"正在同步发送记录"}</div></article>
        <article className="metric"><div className="metric-label"><Smartphone size={13}/>接收设备</div><div className={`metric-value ${!snapshot?"skeleton":""}`}>{snapshot?snapshot.recipient_count:"—"}<small>台设备</small></div><div className="metric-foot">按各自城市和文案风格发送</div></article>
        <article className="metric"><div className="metric-label"><Sunrise size={13}/>每日例行提醒</div><div className="metric-value schedule-times">{regularLabel}</div><div className="metric-foot">{isQuiet?"当前为免打扰时段，停止推送":sendStart&&sendEnd?`仅 ${sendStart}–${sendEnd} 之间允许推送`:"等待发送时段同步"}</div></article>
      </div>
      {perRecipient.length>1?<div className="recipient-weather-filter"><label htmlFor="weather-recipient"><Users size={14}/>查看接收人的天气与通知</label><div className="select-wrap"><select id="weather-recipient" value={recipient?.id??""} onChange={event=>setRecipientId(event.target.value)}>{perRecipient.map(value=><option value={value.id} key={value.id}>{value.name||snapshot?.devices.find(device=>device.id===value.id)?.name||snapshot?.devices.find(device=>device.id===value.id)?.label||"接收人"} · {value.city}{value.enabled===false?"（已暂停）":""}</option>)}</select><ChevronDown size={12}/></div></div>:null}
      <div className="content-grid">
        <section className="section-card"><div className="section-top"><h2 className="section-title"><Bell size={16}/>通知内容</h2><div className="preview-tabs" aria-label="通知内容视图"><button className={previewMode==="latest"?"selected":""} onClick={()=>setPreviewMode("latest")}>最近发送</button><button className={previewMode==="plan"?"selected":""} onClick={()=>setPreviewMode("plan")}>当前预览</button></div></div><div className="preview-stage"><div className="phone-time">{previewMode==="latest"&&lastMessage?.attempted_at?clock(lastMessage.attempted_at):clock(previewTime)}</div><div className="phone-date">{previewMode==="latest"?"最近一次 Bark 已接收的通知":"本次检查 · 内容预览"}</div><div className="notification"><div className="notification-top"><i className="bark-logo"><Bell size={11}/></i>BARK<span>{previewMode==="latest"?"发送记录":"尚未发送"}</span></div>{preview?<><h3>{preview.title}</h3><p className="notification-body">{preview.body}</p></>:<div className="empty">{!snapshot?"正在同步通知内容…":previewMode==="latest"?"早期记录未保存正文。\n后续发送的通知将在这里留存。":"当前暂无可用的内容预览。"}</div>}</div></div><p className="preview-caption"><ShieldCheck size={12}/>{previewMode==="latest"?"仅展示已留存的真实通知内容；Bark 接收状态请查看发送记录。":"根据最近天气检查生成的预览，不代表已经发送，也不保证下次发送内容相同。"}</p></section>
        <section className="section-card weather-panel"><div className="section-top"><h2 className="section-title"><MapPin size={16}/>{weather?.region??recipient?.city??snapshot?.city??"天气检查"}</h2><span className="micro">{weatherStamp?`${dateAndTime(weatherStamp)} 的天气`:"等待天气同步"}</span></div><div className="weather-content"><div className="weather-main"><div><div className="weather-temp">{weather?.temp??"—"}</div><p className="weather-desc">{weatherText??(recipient?"尚未获取该城市天气":"尚未获取天气")}{weather?.daily_low!==undefined&&weather?.daily_high!==undefined?` · ${weather.daily_low}° / ${weather.daily_high}°`:""}</p></div><div className="weather-art"><WeatherIcon size={46} strokeWidth={1.2}/></div></div><div className="weather-detail"><div><span>平均风速</span><b>{wind!==null?`${wind} m/s`:"—"}</b></div><div><span>阵风风速</span><b>{gust!==null?`${gust} m/s`:"—"}</b></div></div><div className={`weather-message ${hazard.length?"warning":""}`}>{hazard.length?<Wind size={16}/>:weather?<CheckCircle2 size={16}/>:<Cloud size={16}/>}<p>{hazard.length?`最近检查发现${hazard.join("、")}。出现新的恶劣天气变化时会发送提醒。`:weather?"最近检查未发现雨、雪、雷暴或大风。":(recipient?.enabled===false?"该接收人已暂停，不会向其发送通知。":recipient?.outcome==="weather_failed"||recipient?.status==="weather_failed"?"该城市天气暂时获取失败，系统不会把它当作正常天气，也不会发送过期数据。":"等待云端完成该城市的天气检查后，将显示是否需要天气提醒。")}</p></div><WeatherWarnings recipient={recipient}/>{quote ? <><p className="quote-label">早晨情话</p><p className="quote">「{quote}」</p></> : null}{careTips.length?<div className="care-tips"><p className="quote-label">今天的小提醒</p><ul>{careTips.map((tip,index)=><li key={index}>{tip}</li>)}</ul></div>:null}</div></section>
      </div>
      <section className="section-card history" id="history"><div className="section-top"><div><h2 className="section-title"><History size={16}/>发送记录</h2><p className="section-copy">留住每一次提醒 · 最近 14 天的设备发送状态</p></div><div className="filters"><div className="select-wrap"><select aria-label="筛选发送日期" value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">全部日期</option><option value="today">今天</option><option value="week">近 7 天</option></select><ChevronDown size={11}/></div><div className="select-wrap"><select aria-label="筛选发送状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="accepted">Bark 已接收</option><option value="attention">需要关注</option><option value="skipped_quiet_hours_or_stale">未发送</option></select><ChevronDown size={11}/></div></div></div><div className="table-scroll"><div className="history-head"><span>发送时间</span><span>通知类型</span><span>接收设备</span><span>发送状态</span><span>内容</span></div>{filtered.map(item=><details className="delivery" key={item.id}><summary><span className="row-time">{item.attempted_at?clock(item.attempted_at):"时间未记录"}<small>{item.date}</small></span><span className="kind">{kindLabel(item)}</span><span className="device-name"><Smartphone size={12}/>{deviceNames.get(item.device_id)??"历史设备"}</span><Badge status={item.status}/><span className="open-detail">查看<ChevronDown size={11}/></span></summary><div className="delivery-detail"><div><h4>{item.message?.title??"通知内容"}</h4><p className="history-body">{item.message?.body??"早期记录未保存正文。该记录只保留了发送状态，不补造当时的通知内容。"}</p>{item.status==="uncertain"||item.status==="pending"?<p className="section-copy">推送结果待确认，系统不会自动重发这次请求，以免产生重复消息。</p>:null}</div>{safeLink(item.run_url)?<a className="run-link" href={safeLink(item.run_url)} target="_blank" rel="noreferrer">执行详情<ArrowUpRight size={11}/></a>:null}</div></details>)}{!filtered.length?<div className="empty">{!snapshot?"正在同步发送记录…":historyUnavailable?"发送历史暂时无法读取，请稍后刷新。":deliveries.length?"这个筛选条件下暂无记录。":"还没有发送记录，首次通知后会显示在这里。"}</div>:null}</div><div className="table-foot"><ShieldCheck size={11}/>{historyUnavailable?"历史待同步":`${filtered.length} 条记录`} · “Bark 已接收”表示推送服务已接受请求，手机展示与阅读暂无回执。</div></section>
      <div className="lower-grid"><section className="section-card"><div className="section-top"><h2 className="section-title"><Smartphone size={16}/>接收设备</h2><span className="micro">同一份关心，多一份陪伴</span></div><div className="device-list">{snapshot?.devices?.length?snapshot.devices.map(device=><div className="device-item" key={device.id}><span className="device-icon"><Smartphone size={20} strokeWidth={1.4}/></span><div className="device-info"><strong>{device.name||device.label}</strong><small>{device.city||snapshot.city}天气 · {recipientToneLabels[normalizeRecipientTone(device.tone)]}{device.enabled===false?" · 已暂停":""}</small></div><div className="device-status">{device.enabled===false?<span className="badge neutral">已暂停</span>:<Badge status={device.latest_status}/>}<small>{device.latest_attempt_at?`最近 ${dateAndTime(device.latest_attempt_at)}`:"尚无发送时间记录"}</small></div></div>):<div className="empty">正在同步设备信息…</div>}</div></section><section className="section-card" id="rules"><div className="section-top"><h2 className="section-title"><Settings2 size={16}/>推送规则</h2><span className="badge neutral">北京时间</span></div><div className="rule-content"><div className="time-rule"><div className="clock-round"><Clock3 size={20} strokeWidth={1.4}/></div><div><strong className="schedule-times">{regularLabel}</strong><span>每日例行 · 按接收人风格发送天气提醒</span></div></div><div className="timeline"><span>{sendStart?`${sendStart} 开始`:"等待规则"}</span><span>{pollMinutes?`每 ${pollMinutes} 分钟检查`:"按云端规则检查"}</span><span>{sendEnd?`${sendEnd} 停止`:"等待规则"}</span></div><p className="rule-description">每天 <b>{regularLabel}</b> 发送例行提醒。<br/>云端发现雨、雪、雷暴或大风首次出现或有新变化时提醒，恢复正常后停止。大风标准为平均风速达到 <b>{policy?.wind_threshold_ms??"—"} m/s</b> 或阵风达到 <b>{policy?.gust_threshold_ms??"—"} m/s</b>。<br/>已接入地区新发布或更新的气象预警也会推送。<br/>{sendStart&&sendEnd?`${sendStart} 前、${sendEnd} 及以后均不发送。`:"发送时段以云端规则为准。"}</p></div></section></div>
      <section className="section-card run-area"><div className="section-top"><div><h2 className="section-title"><CheckCircle2 size={16}/>云端运行</h2><p className="section-copy">任务成功表示程序正常结束，实际发送情况以记录为准。</p></div><span className="micro">{data?.scheduler?data.scheduler.enabled?"定时器已启用":"定时器已暂停":"等待定时器状态"}</span></div><div className="run-list">{data?.runs?.length?data.runs.slice(0,5).map(run=>{const success=run.conclusion==="success";const failed=run.status==="completed"&&!success;const title=run.title.includes("cron-job.org")?"外部定时检查":run.title.includes("check")?"配置与连接检查":"天气推送任务";return <div className="run-item" key={run.id}><span className={`run-check ${failed?"failed":success?"":"pending"}`}>{success?<CheckCircle2 size={17}/>:failed?<XCircle size={17}/>:<Clock3 size={17}/>}</span><div className="run-title"><b>{title}</b><small>{success?"执行成功":failed?"执行未成功，请查看详情":run.status==="queued"?"排队等待中":"正在执行"}{run.title.includes("check")?" · 只检查，不发送":""}</small></div><time dateTime={run.created_at}>{dateAndTime(run.created_at)}</time>{safeLink(run.url)?<a href={safeLink(run.url)} target="_blank" rel="noreferrer" aria-label="查看本次云端执行详情"><ArrowUpRight size={15}/></a>:null}</div>;}):<div className="empty">正在同步云端运行记录…</div>}</div></section>
      <footer className="page-footer"><span className="footer-mark"><Heart size={10}/>每天一点关心，按时抵达。</span><span>密码加密查看 · 记录更新 {snapshot?.generated_at?dateAndTime(snapshot.generated_at):"等待同步"} · 页面同步 {now?dateAndTime(now.toISOString()):"等待同步"} · 所有时间为北京时间</span></footer>
      <Management openMode={managementMode} onClose={closeManagement} onChanged={()=>void refresh()}/>
    </main>
  </div>;
}
