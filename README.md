# 早安 · GitHub Pages 推送看板

静态页面地址：`https://oldwung.github.io/bark-weather-dashboard/`。

页面源码公开，发送记录与预览只以加密文件 `public/data/status.enc.json` 发布。输入独立查看密码后，浏览器使用 Web Crypto 解密；密码不提交到网站，不保存在浏览器存储或网址里。锁定、刷新或关闭页面后需重新输入密码。无需 ChatGPT 登录。

看板提供通知预览、14 天发送记录、设备状态、推送规则和云端运行结果。例行发送时间、下一次提醒与天气关怀提示均读取云端快照，页面不固定每日提醒次数。每分钟检查加密文件更新，也可手动刷新。“Bark 已接收”不等于手机已显示或阅读；早期缺正文的历史不会补造。

## 开发和构建

使用 Node.js 24：

```sh
npm ci
npm test
npm run build
```

Vite 的路径前缀固定为 `/bark-weather-dashboard/`。构建输出为 `dist/`，`public/data/status.enc.json` 会作为密文复制到发布目录。不要在此仓库提交密码、设备地址、原始记录或服务端令牌。

私有推送任务负责更新密文，本仓库的 Pages 工作流仅构建和发布静态页面。

## 加密格式

协议 v1：PBKDF2 SHA-256，310000 次迭代，16 字节随机盐；AES-256-GCM，12 字节随机 IV，128 位认证标签。AAD 为 `bark-weather-dashboard:v1`。JSON 中 `ciphertext` 是密文与尾部认证标签的 Base64 编码。查看密码只配置在私有推送任务 Secrets 中。

只读页面，不具备发送、编辑接收设备或修改定时器的权限。
