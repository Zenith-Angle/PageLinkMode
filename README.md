<div align="center">
  <img src="./public/icons/icon128.png" alt="PageLinkMode Logo" width="112" height="112" />

# PageLinkMode

**一个面向 Chrome 的网页内导航行为控制扩展。**

让普通链接、页面导航、表单提交和 `window.open(...)` 在“同标签页”“新标签页”和“保持原生”之间拥有可解释、可继承、可按站点定制的策略。

[项目主页](https://github.com/Zenith-Angle/PageLinkMode) · [问题反馈](https://github.com/Zenith-Angle/PageLinkMode/issues) · [MIT License](./LICENSE)

[![Repository](https://img.shields.io/badge/repository-PageLinkMode-181717?logo=github)](https://github.com/Zenith-Angle/PageLinkMode)
[![Language](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Release](https://img.shields.io/badge/release-v0.6.1-0969DA)](https://github.com/Zenith-Angle/PageLinkMode/releases)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![License](https://img.shields.io/badge/license-MIT-2ea043)](https://github.com/Zenith-Angle/PageLinkMode/blob/main/LICENSE)

</div>

---

## 当前状态

当前版本为 `0.6.1`。配置 schema v4、生产构建、扩展 E2E、稳定版 Chrome 主链路、包体扫描与 `dist`/ZIP 一致性均已完成验收。

PageLinkMode 的核心模型已经由旧的“12 类 + 接管范围门禁”升级为：

- 始终生效的基础分类，用于绝大多数常规导航；
- 站点和页面整体规则，用于快速覆写；
- 只绑定具体站点或页面的个性化规则，用于精确例外；
- 独立的高风险授权和逐条规则开关，用于保护认证、支付与写请求；
- 可追溯的实际执行结果，用于说明为何接管或为何保持原生。

## 基础分类

基础分类是默认且始终启用的规则层，不存在需要用户主动打开的“高级接管模式”。新安装使用位于滑块中间的“适中”预设：普通内容、列表详情、文档和媒体默认新标签页；首页与站点导航默认同标签页；分页、上一篇/下一篇、搜索、图片、SPA、表单和脚本打开默认保持原生。

### 五档基础预设

五档依次为“精准、内容、适中、深入、最广”。Popup 滑块用于实时应用预设；设置页在批量覆盖前仍显示变更预览。中间“适中”档覆盖大多数日常浏览；集合分页、上一篇/下一篇和普通脚本打开只在“最广”档接管，其中分页与顺序阅读会打开新标签。应用后，各分类仍可独立改为同标签页、新标签页或保持原生；语义子类和站点覆写还可继续继承上层结果。

站点覆写优先于全局分类，越具体的语义分类优先于普通的目标关系分类。未设置的站点子项继续继承全局结果。

### 27 类导航

| 分组 | 分类 |
| --- | --- |
| 普通链接关系 | 同源、同站不同子域、跨站 |
| 页面语义 | 首页/Logo、主导航、面包屑/Tab、列表详情、分页、上一篇/下一篇、搜索筛选排序、图片相册、PDF/文档、音视频、SPA/hash |
| 敏感链接 | 账户认证、支付结算 |
| 表单 | 搜索 GET、普通 GET、非 GET、认证/支付表单 |
| 脚本打开 | 同源、同站、跨站、图片、文档媒体、认证支付、弹窗/命名窗口 |

Public Suffix List 同站判断由 `tldts` 提供，因此 `a.example.co.uk` 与 `b.example.co.uk` 可以按注册域识别为同站，而不是用字符串后缀猜测。

## 整体规则与个性化规则

页面和站点整体规则都支持继承、同标签页、新标签页和保持原生。页面规则键为规范化后的 `origin + pathname + search`，忽略 `hash`；站点规则键为精确 `hostname`。

个性化规则不是全局接管层，只能绑定具体站点或页面：

- 页面规则优先于站点规则；
- 同一作用域按用户排序，首条命中生效；
- 未命中时回到页面/站点整体规则和基础分类；
- 来源 URL 与目标 URL 支持精确、前缀、Glob 和 RE2 正则；
- 可组合目标关系、触发方式、语义、原生 target、frame、表单方法；
- 可使用受限的元素标签、属性和 CSS selector；
- 不允许用户 JavaScript。

RE2 匹配由 `re2js` 提供，避免用户规则触发灾难性回溯。Popup 保留当前站点和页面的快速整体设置，显示当前命中来源，并可深链到当前上下文的个性化规则编辑区。

## 高风险保护

认证、支付、非 GET 写请求等行为可能依赖原标签页、回调上下文或一次性提交状态。它们默认关闭，不能配置为全局个性化规则，也不能仅靠基础分类或整体规则绕过保护。

某个站点需要处理高风险行为时，必须依次完成：

1. 从 Popup 当前站点/页面、调试记录或已有规则进入明确的站点上下文；
2. 打开站点风险解锁弹窗并阅读风险说明；
3. 勾选风险确认；
4. 输入完全相同的当前 `hostname`；
5. 在本机保存该站点授权；
6. 再为具体规则单独打开敏感行为开关并启用规则。

站点授权会保留到用户主动撤销，但授权本身不改变任何导航行为。撤销授权会同时关闭该站点规则的敏感开关。风险授权独立保存在本机，不进入备份；导入配置不会恢复授权，导入的敏感规则会保持禁用。

## 始终保持原生

以下行为无法安全或等价地复刻，因此不会开放给基础分类、整体规则或个性化规则：

- `Ctrl` / `Cmd` / `Shift` / `Alt` 修饰点击和中键点击；
- `download` 下载、外部协议和浏览器不支持注入的页面；
- 命名窗口、带 popup 语义的窗口、`_parent`、`_top` 等特殊 target/frame；
- `ping`、`attributionsrc` 和特殊 `rel` 等不能无损复刻的语义；
- 没有瞬时用户激活的脚本弹窗；
- `dialog` 表单等不属于普通页面导航的行为。

扩展只在“期望动作”和浏览器原生动作不同时介入。原生行为已经符合规则时，继续交给网页自身处理，以减少对 SPA 和站点脚本的影响。

## 决策顺序与调试

每次导航先提取正交事实：触发方式、来源和目标 URL、同源/同站关系、语义、原生 target、frame、表单方法、用户意图、识别证据和可改写能力。随后按固定顺序决策：

1. 技术硬限制；
2. 高风险授权；
3. 页面个性化规则；
4. 页面整体规则；
5. 站点个性化规则；
6. 站点整体规则；
7. 站点分类；
8. 全局分类；
9. 浏览器原生兜底。

调试记录会区分期望动作、浏览器原生动作、最终动作、是否实际介入、旁路原因、命中来源和规则 ID，避免把“规则计算成功”误认为“扩展真实改写了导航”。

事件委托覆盖动态插入链接、开放式 Shadow DOM、HTML 图像映射、SVG 链接、普通 iframe、旧式 frameset、`about:blank` 及关联的 `srcdoc/blob` frame。`pushState`、`replaceState` 和 fragment 更新会刷新当前页面规则上下文。

## 配置、迁移与备份

schema v4 配置只读写 `chrome.storage.local`。`0.6.0` 及后续版本首次运行时，如果本地还没有 v4 配置，会一次性读取并校验旧 `chrome.storage.sync` 配置，再写入本地存储；之后忽略旧 Sync 键，但不会主动删除它们。

迁移会把旧五档范围实体化为分类值，将旧 12 类映射到新分类，并把旧整体规则可影响的范围固化为受限规则，避免取消范围门禁后无提示扩大行为。旧 `globalMode` 不再参与 v4 决策。

备份包含格式版本、扩展版本、导出时间和 v4 状态。导入会校验格式和 schema；来自更高 schema 的配置会拒绝导入。风险授权永远不导出，敏感规则导入时会隔离为禁用状态。

## 用户界面

Options 规则工作台包含六个区域：

- 基础分类：查看 27 类、预览并应用预设、逐类修改全局值；
- 站点覆写：管理站点整体规则和分类继承；
- 个性化规则：创建、排序、启停站点/页面例外及管理站点风险授权；
- 调试记录：按站点查看实际决策结果；
- 页面规则：集中维护页面整体规则；
- 配置备份：导入和导出 v4 配置。

Popup 用于当前页面的高频操作：启停当前站点、快速修改站点/页面整体规则、查看命中来源，以及跳转到当前站点或页面的个性化规则。

## 安装与使用

### 从源码构建

```powershell
npm install
npm run build
```

构建产物位于 `dist/`。在 Chrome 中打开 `chrome://extensions`，开启“开发者模式”，点击“加载已解压的扩展程序”，然后选择本仓库的 `dist` 目录。

Chrome 会提示扩展可读取和更改普通 `http/https` 网站上的数据；这是默认管理可控制网站所需的主机权限。浏览器内部页、扩展商店等受保护页面仍无法注入。

安装后可通过工具栏状态点确认当前站点状态：绿色表示扩展正在管理，红色表示未管理、已停用或受浏览器限制。规则修改后无需切换模式；基础分类始终提供兜底。

## 开发与验收

### 环境要求

- Node.js 24+
- npm 11+
- Chrome 最新稳定版

### 常用命令

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run package:dist
npm run verify:dist-zip
```

`package:dist` 从现有 `dist/` 生成 `dist.zip`，使用固定文件顺序和固定 ZIP 时间戳，并在写入后立即逐文件校验。相同 `dist/` 会得到字节一致的 ZIP。`verify:dist-zip` 不重新打包，只独立检查 ZIP 中不存在路径穿越、重复项、损坏、缺失或多余文件，并确认每个文件与 `dist/` 字节一致。

自动化通过只证明代码与测试产物成立。安装到真实 Chrome 后仍需在 `chrome://extensions` 重新加载最新 `dist/`，再验证链接、表单、脚本打开、Popup、Options、风险授权与撤销主链路；不能用一次成功构建代替扩展重载和真实浏览器验收。

### 项目结构

```text
src/
  background/   service worker 与实际导航执行
  content/      链接、表单和主世界 window.open 桥接
  lib/          事实提取、分类、规则、匹配、迁移与存储
  styles/       Popup / Options 样式
public/
  manifest.json
  icons/
scripts/
  build.mjs
  dist-zip.mjs
  package-dist.mjs
  verify-dist-zip.mjs
tests/
  e2e/          真实 MV3 扩展 Playwright 场景
  fixtures/     SPA、frame、表单与脚本导航夹具
```

## 已知限制

- 自动执行的 `location` 跳转、`meta refresh`、服务端重定向和非标准脚本控件保持原生；
- closed Shadow DOM 不暴露内部事件路径，只能保留原生并观察最终导航；
- 无法等价复刻的命名窗口、特殊 frame、下载、外部协议和浏览器安全语义不会开放接管；
- 浏览器内部页、扩展商店、内置 PDF 阅读器等受限页面无法注入；
- 某些高度定制的网站不使用标准链接、表单或 `window.open`，仍可能需要定向兼容；
- 当前交付目标为 Chrome MV3，其他 Chromium 浏览器与 Firefox 需要独立验收和适配。

## Contributing

欢迎通过 issue 或 pull request 提交问题反馈和改进建议。扩展兼容性应优先围绕“网页内导航行为”，并为新的识别或改写路径补充事实提取、风险边界、实际执行结果和浏览器验证。

## License

本项目基于 [MIT License](./LICENSE) 发布。
