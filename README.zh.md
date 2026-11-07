# dsh-plugin-classes（插件管理）

把已安装的 DSH 插件分成互不可见的**插件类**（plugin class）：一个会话只加载它所属类里的插件，
类外的插件对这个会话既不可用、也不存在于它的工具目录/提示里。

English see [README.md](./README.md)。

实现上没有另造一套加载器——每一份组合都会注册成一个普通的
[`@deepseek-ai/dsh-agent-preset`](https://github.com/deepseek-ai/deepseek-harness) 定义，
于是作用域隔离、会话绑定、恢复重启全部复用 DSH 自己的机制：

```
host 基线（模板行 − 去掉 + 追加）
  ⊕ 类 A 的增删  ⊕ 类 B 的增删  →  agentPresets.register({ id: 'cls-a+b', plugins: [...] })
  →  会话绑定这份组合时只挂载这些插件
```

## 模型

- **host 类**：全局基线，**不可删除、不在列表里显示**，所有会话都包含它，并且是
  **新会话的默认组合**（preset `cls-host`）。它持有基础模板（`standard`），本身也可以增删行
  （只能改配置，UI 里不显示）。
- **用户插件类**：只描述**增量**——从基线里去掉哪些行、额外加入哪些插件。
- **会话**：选择一个或多个用户类（0 个即“仅宿主基线”）。组合 = 基线 + 勾选的类依次叠加；
  同一插件被多个类加入时只挂载一次；任一类去掉的行都会被去掉。
- 每种不同组合对应一个 preset id：`cls-host`、`cls-a`、`cls-a+b`（类 id 排序拼接），
  所以“勾选/取消一个类”就是换一个 preset，隔离仍然由 DSH 的作用域保证。

## 功能

1. **插件类**：每个类有独立名字，在 host 基线上增删插件；一个会话可以同时勾选多个类。
2. **插件管理面板**：侧边栏「插件管理」入口，新建/删除/改名类，勾选类内插件，
   查看待归类插件、以及**哪些会话用到了这个类**。host 类只在侧栏注明，不参与编辑与删除。
   **删除是“隐藏”**：类从选择列表里消失，但它的 preset 仍然注册，已被它绑定的会话
   （包括空会话）不会因为删类而再也打不开——这一条是硬性安全线，见下方“排查记录”。
3. **输入框左侧的类选择器**（模型选择器左边，样式与模型选择一致）：
   - **未开始的会话**：点击类名前的方框即加入，再点一次即取消，**实时生效**；
   - **已开始的会话**：DSH 在首轮后锁定组合，勾选一个**新**类会立刻开一个
     **“仅本轮”的临时会话**（同工作区、组合 = 原会话的类 + 新类），你在那里提问、拿到回答；
     主会话的组合不变，临时会话用完即**归档**（侧栏默认不再显示）。已勾选的类**不能取消**。
4. **新插件归类**：下载并安装一个新插件后，自动弹出居中对话框，用复选框选择它进入哪些类
   （可多选）。确认后会把这些插件的组合行写进所选类、记录归属，并**默认从宿主层停用**它，
   这样只有勾选的类能看到它；选“暂不加入”则记为“不归属任何类”，不再反复询问。

## 结构

| 文件 | 作用 |
|---|---|
| `lib/host2.js` | 宿主半区：读 volatile 配置，注册 host 基线 / 单类 / 组合 preset，配置变更时增量重注册 |
| `lib/client.js` | 浏览器半区（module-factory bundle）：输入框多选 chip + 「插件管理」面板 + 归类对话框 |
| `lib/templates.json` | 基线模板，由 `scripts/gen-templates.mjs` 从发行版 bundle 的预设生成（含 `!!js` 门控） |
| `cordis.patch.yml` | bundle patch：插入一行宿主插件 |
| `scripts/` | 生成模板、安装、验证脚本（见下） |

状态都在插件自己的 volatile 配置字段里（写进 profile 的 `cordis.patch.yml`）：
`classes`（用户类）、`host`（基线）、`sessions`（会话 → 类 id 列表）、`plugins`（包名 → 归属类）。
volatile-only 变更不重挂插件实例，所以编辑类或会话勾选会**热生效**：旧 revision 被退役，
运行中的会话继续用它们已经挂载的组合。

## 安装

```powershell
# npm
dsh plugin --profile web add dsh-plugin-classes

# 直接从 GitHub 装（无需 registry）
dsh plugin --profile web add github:Uruz123321/dsh-plugin-classes
```

`dsh plugin add` 会自动把包写进 profile 的 `dsh.profile.bundles`，**新 bundle 只在启动组合时导入，
装完要重启**（Electron 桌面端重启应用，CLI 重启 `dsh web`）。之后的类增删改不需要重启。

手工安装（profile 自己管 `node_modules` 时，例如 Electron 桌面版）：

```powershell
# 1) 把包放进 profile 的 node_modules（必须是物理副本，不能用 junction：
#    Node 会先解析真实路径，符号链接会让 @deepseek-ai/* 找不到）
node scripts/sync-install.mjs "$env:DSH_HOME\profiles\desktop"

# 2) profile 的 package.json 里登记依赖与 bundle
#    "dependencies": { "dsh-plugin-classes": "link:../../dsh_orb/plugin-classes" }
#    "dsh.profile.bundles": [ ..., "dsh-plugin-classes" ]

# 3) 重启进程（新 bundle 只在启动组合时导入）
```

## 兼容性

| 项 | 值 |
|---|---|
| DSH | `>=0.2.0-rc.2 <0.3.0`（只在 0.2.0-rc.2 验证过；0.2.1-rc.x 未验证） |
| Node | `>=20.18` |
| profile | `web`、`desktop` |
| 依赖的 DSH 服务 | `settings`、`agentPresets`、`pluginManager`、`pluginInventory`、`session` |

**不支持没有 agent preset 的 profile**：整个设计建立在 preset registry 上。声明在
`package.json` 的 `engines.dsh` 与 `dsh.compatibility` 里。

## 安全边界

DSH 插件与宿主同进程运行，本插件也不例外，并且把能力写在明面上：

- 它**注册 / 退役 agent preset**（`agentPresets.register`）——即决定哪些插件在哪个会话挂载；
- 它能**从宿主层停用 bundle 行**（`pluginManager.setBundleEnabled`）——“从宿主层隐藏插件”就是这么实现的；
- 它只写自己那一行的 volatile 配置到 profile 的 `cordis.patch.yml`，并读插件清单。

它**不发起任何网络请求**、**没有遥测**、**不读凭据**、**不写 profile 配置以外的文件**。
安装它等于授权它重塑其他会话的插件组合，请按“宿主代码插件”对待（与 shell 权限同级）。

## 验证

```powershell
npm test     # 宿主 smoke（基线/增量/组合/退役）+ 客户端 smoke（四个贡献 SSR 渲染）
npm run check # 校验发布清单字段与 files 白名单
```

```powershell
# 客户端 bundle：用假 Cordis 上下文跑 apply()，再 SSR 渲染四个贡献
node scripts/smoke-client.mjs

# 宿主半区：host 基线 / 单类增量 / 多类组合 / 去重 / 卸载
node scripts/smoke-host.mjs

# 真实宿主：用本地 secret 签出浏览器 cookie，直接调 /api
node scripts/probe.mjs agentPresets/list pluginInventory/list settings/describe
```

`scripts/probe.mjs` 会从 `$DSH_HOME/.credentials.yaml` 读取
`client-connection/browser-session` 的签名密钥，为 `127.0.0.1` 这个 authority
签一个与浏览器同款的 cookie，然后按 `{ type: 'client-request', rpcId, method, payload }`
信封调用 `/api/<namespace>/<method>`——不写入任何东西，密钥不离开进程。

端到端：

```powershell
# 宿主：行已 active、host 是默认 preset、多类组合上榜、测试类删完即退役
node scripts/verify-live.mjs

# 浏览器：无头 Chromium + 自签 cookie
#   verify-ui.mjs  —— chip 位置/弹层、侧边栏面板、面板内 新建→取消勾选→删除
#   verify-ui2.mjs —— 新插件归类对话框、新会话默认 host 基线、勾选两个类、
#                     取消一个类、面板反映 host 基线；截图落在 .shots/
node scripts/verify-ui.mjs
node scripts/verify-ui2.mjs
```

## 排查记录

- **删掉一个类后“新建会话”失败 / 会话打不开**：`agent-preset/not-found: Unknown agent preset: cls-xxx`。
  空会话的 header/projection 记着它当初选的类；一旦这个 preset 被退役，**采纳该会话**就会失败，
  而“新会话”正好会复用同一个工作区的空会话，于是整个新建入口挂掉。
  现在的做法是：删除只**隐藏**（preset 继续注册），并且删除前先把绑定了它的空会话改绑到剩余组合。
  若已有损坏（历史遗留），跑 `node scripts/repair-sessions.mjs`：它会临时重建缺失的类 preset、
  把受影响的空会话改绑到 `cls-host`，再清掉临时类。
- **`cannot get property "remote.settings" without inject`**：客户端插件不能只声明
  `inject: ['remote']`。`remote` 只是枢纽，每个生成的命名空间都是独立的
  `remote.<namespace>` 服务；读过哪些就必须在 `inject` 里列全
  （`remote.settings` / `remote.agentPresets` / `remote.pluginManager` /
  `remote.pluginInventory` / `remote.session`），否则 Cordis 的取值守卫会在第一次读取时抛错。
- **`/plugins/<包>/client.js` 直接 404 是正常的**：bundle 路由是带版本号的
  （`plugins/??<包>/client.js&rev=<rev>`），版本号写在页面收到的 `__DSH_BOOT__` 清单里；
  要判断“客户端半区有没有被组合”，去看清单而不是猜路由。
- **改了 `lib/host*.js` 后热重载不生效**：`pluginManager/setPluginEnabled` 会重挂行，
  但 Node 的 ESM 缓存按 URL 命中，同一个文件名会返回**旧模块**；改宿主代码后必须
  重启进程，或者把入口改名（本仓库这么做了一次：`host.js` → `host2.js`）。
  客户端 bundle 不受此限，主机重新发布后刷新页面即可。
- **`Config field "sessions" is not volatile`**：说明跑的还是旧宿主模块（旧 schema 不认识新字段），
  同上，重启/改名即可。

## 已知限制

- 已开始的会话不能改组合（DSH 在首轮后锁定）。勾选新类会开一个“仅本轮”的临时会话；
  用完自动归档（可在侧栏“全部对话（显示已归档）”里恢复）。
- 临时会话的回答不会回填到原会话的记录里——它是独立会话，看完即可归档。
- 新增 bundle 必须重启进程才会被组合；插件类本身的增删改不需要。
- 类只接管“代理层”插件；宿主级插件仍然对每个会话可见，除非在归类对话框里选择从宿主层停用。
- 基线模板是插件自带的静态副本（`lib/templates.json`）；本部署若改过 `standard` 预设，
  基线不会自动跟随。host 基线的行可以在 profile 的 `dsh-plugin-classes` 行里改 `host:` 字段。
- 所有状态都在 volatile 配置里，因此跟着 profile 的 `cordis.patch.yml` 走（迁移就是拷这个文件）。

## 许可证

MIT，见 [LICENSE](./LICENSE)。
