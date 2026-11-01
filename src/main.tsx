import { StrictMode, useCallback, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { Eye, EyeOff, KeyRound, LockKeyhole, Sunrise } from "lucide-react";
import Dashboard from "./Dashboard";
import { fetchEncryptedStatus } from "./crypto.mjs";
import "./styles.css";

function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const password = useRef("");
  const initial = useRef<Awaited<ReturnType<typeof fetchEncryptedStatus>> | null>(null);
  const attempt = useRef(0);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const current = ++attempt.current;
    setLoading(true); setError("");
    try {
      const data = await fetchEncryptedStatus(passwordInput, {signal:AbortSignal.timeout(20000)});
      if (current !== attempt.current) return;
      password.current = passwordInput;
      initial.current = data;
      setPasswordInput(""); setShowPassword(false); setUnlocked(true);
    } catch (reason) {
      setError(reason instanceof Error && reason.name === "UnlockError" ? reason.message : "暂时无法读取记录，请检查网络后重试。");
    } finally { if (current === attempt.current) setLoading(false); }
  }
  const lock = useCallback(() => {
    attempt.current++;
    password.current = ""; initial.current = null;
    setUnlocked(false); setPasswordInput(""); setError(""); setLoading(false);
  }, []);
  const loadStatus = useCallback(async (signal?:AbortSignal) => {
    if (!password.current) throw new Error("看板已锁定，请重新输入密码。");
    return fetchEncryptedStatus(password.current, {signal});
  }, []);

  if (unlocked) return <Dashboard loadStatus={loadStatus} initialData={initial.current} onLock={lock}/>;
  return <main className="unlock-shell"><div className="unlock-card"><div className="unlock-brand"><span className="brand-icon"><Sunrise size={28} strokeWidth={1.5}/></span><div><strong>早安</strong><small>A LITTLE EVERYDAY</small></div></div><p className="eyebrow">YOUR ENCRYPTED MORNING SPACE</p><h1>打开今天的<em>小小惦记</em></h1><p className="unlock-description">输入查看密码，天气、情话和每一次提醒，<br/>都在这里等你。</p><form onSubmit={unlock}><label htmlFor="viewer-password">查看密码</label><div className="password-field"><KeyRound size={17}/><input id="viewer-password" autoFocus type={showPassword?"text":"password"} value={passwordInput} onChange={event=>setPasswordInput(event.target.value)} autoComplete="off" spellCheck={false} required disabled={loading} placeholder="输入你的查看密码"/><button type="button" onClick={()=>setShowPassword(!showPassword)} aria-label={showPassword?"隐藏密码":"显示密码"}>{showPassword?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>{error?<p className="unlock-error" role="alert">{error}</p>:null}<button className="unlock-submit" type="submit" disabled={loading||!passwordInput}>{loading?"正在解锁…":"解锁看板"}</button></form><p className="unlock-privacy"><LockKeyhole size={13}/>记录在浏览器中解密，密码不会发送给网站。<br/>关闭或刷新页面后需要重新解锁。</p></div><span className="unlock-footer">每天一份天气，也一份小小的惦记。</span></main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);
