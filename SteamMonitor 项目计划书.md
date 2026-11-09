# SteamMonitor 项目计划书

## 1. 产品定位

SteamMonitor 是一个 Windows 本地工具，用来快速看有哪些朋友在线、大家在玩什么，以及回看近期可见的游戏活动。首版面向个人使用，场景以找人开黑、关注指定游戏和回看时间线为主。默认记录自己的账号和明确同意加入记录的好友，历史保存在本机。

## 2. 功能规划

| 优先级 | 功能 | 具体做法 |
| --- | --- | --- |
| P0 | 添加好友 | 输入 SteamID64 或个人资料链接，验证后加入名单。支持从公开好友名单预览并勾选导入，允许改备注、置顶、暂停或移除。 |
| P0 | 当前状态 | 显示在线、离开、显示离线或状态未知，另列游戏名和最近一次成功采集时间。支持按昵称、备注、游戏搜索，也能按「正在玩」「在线」「显示离线」筛选。 |
| P0 | 历史时间线 | 记录观察到的上线、显示离线、开始游戏和换游戏。游戏信息消失时显示「未再观测到该游戏」，历史按好友、游戏和日期筛选，支持 CSV 导出。 |
| P0 | 后台运行与诊断 | 关闭窗口后可留在系统托盘采集，提供暂停、立即刷新和退出。显示网络、限流和 Key 错误。首次使用可以进演示模式，直接看到完整界面。 |
| P1 | 开黑视图 | 按游戏聚合当前可见的好友，置顶常玩的游戏。点头像打开 Steam 资料，点游戏名打开商店页。 |
| P1 | 自定义通知 | 可订阅「指定好友上线」「好友开始玩指定游戏」「同一游戏已有至少两位好友」。默认关闭，支持免打扰时段和重复提醒冷却。启动、重连和切换数据源时先建立状态基线。 |
| P1 | 游戏回顾 | 按天查看观察到的游戏时段，汇总过去 7 天或 30 天的游戏活动。可以看几位好友同时显示在同一游戏里的时段，便于约下一次开黑。 |
| P1 | 数据管理 | 默认保留 90 天，可调整。支持单人清除、全量清除、本地备份与恢复。开机自启由用户开启。 |
| P2 | 登录模式验证 | 单独验证好友可见信息、登录过期、重连、隐身与私密游戏的表现。把可见范围与 Steam 官方好友界面逐项对照后，再决定是否纳入发行版。 |

## 3. 设计语言

采用接近 Steam 好友列表的**深色、紧凑、易扫读**风格。用游戏名和状态变化组织信息，保留自己的图标与品牌。主窗口优先呈现列表和时间线，游戏封面只在详情中作为辅助。

| 元素 | 设计 |
| --- | --- |
| 色彩 | 页面背景 `#10161F`，面板 `#182230`，主文字 `#E8EEF5`，次要文字 `#A9B7C7`，操作蓝 `#77B9FF`。游戏中用绿 `#6ED7A1`，离开用琥珀 `#F1C76B`，显示离线用灰 `#8F9AA8`。未知用空心图标配文字，采集缺口用斜纹。 |
| 字体与间距 | 界面使用 Segoe UI 和微软雅黑，列表正文 14 px，时间与来源 12–13 px，采用 8 px 间距基准、约 44 px 的标准列表行。时间数字等宽对齐，名字与备注过长时可展开查看。 |
| 页面结构 | 顶部显示搜索、添加好友与采集状态。左侧在「好友」「活动」「设置」之间切换。好友页主区显示名单，右侧显示所选好友的当日时间线。窄窗口用独立详情页承载时间线。 |
| 状态表达 | 「在线 · 未看到游戏活动」「游戏中 · Dota 2」「显示离线」「状态未知」都带文字。断网后保留上一笔读数，并标注「上次观测 21:14，当前未更新」。 |
| 操作反馈 | 添加好友时先显示头像和资料链接供核对。采集失败提示放在顶部，单个好友不可见时只在该行标注。筛选、切换好友和打开详情均支持键盘操作。 |

**首页草图**（示例数据）

```text
SteamMonitor        [搜索好友或游戏]  [+ 添加好友]   ● 更新于 21:14

好友   活动   设置    全部 12   在线 5   游戏中 3   状态未知 1
──────────────────────────────────────────────────────────────
★ 小林       游戏中 · Dota 2           小林 · 今天
  阿泽       在线                      21:08  看到 Dota 2
  小周       离开                      20:52  显示在线
  小陈       显示离线                  19:30–19:41  采集中断
```

Steam 官方好友列表已采用按同一游戏分组的呈现方式，可以参考它在长列表中的信息密度。 [Steam 好友列表介绍](https://steamcommunity.com/updates/chatupdate?l=schinese)

## 4. 数据源与实现

| 数据源 | 实现安排 |
| --- | --- |
| Web API Key | 首版主数据源。运行时使用 Key 调用 `GetPlayerSummaries`，每 60 秒按最多 100 个 SteamID64 分批采样。`GetFriendList` 只用于导入，名单不可见时保留手动添加入口。 [Valve Web API 文档](https://partner.steamgames.com/doc/webapi/ISteamUser) |
| 无 Key、无登录 | 把公开社区资料页 `?xml=1` 留作兼容性验证。此前实测返回基础状态字段，游戏字段尚未验证。先用演示数据提供完整的无凭据体验。 [社区资料页 XML 示例](https://steamcommunity.com/id/gabel?xml=1) |
| Steam 客户端会话 | 预留同一套采集接口，区分公开和好友视角。Steam OpenID 用于身份绑定。第三方客户端协议用于技术验证，发行前按 Steam 自动化条款和数据使用条件评估。 [Steamworks 好友接口](https://partner.steamgames.com/doc/api/ISteamFriends) · [Steam OpenID](https://partner.steamgames.com/doc/features/auth) · [Steam 用户协议](https://store.steampowered.com/subscriber_agreement/#4) |

建议采用 **Electron + TypeScript + React + SQLite**。主进程负责托盘、定时采集、通知和 SQLite 写入，界面通过受限 IPC 读取显示数据。SteamID64 按字符串保存，事件时间按 UTC 入库、按本地时区展示。Key 用系统凭据保护存储，错误日志和 CSV 只保留展示需要的字段。 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security) · [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)

- **状态拆分。** 每个人分别保存可见的在线状态、游戏信息和采集健康状态。隐身在 Steam 里表现为显示离线，私密游戏可能隐藏游戏活动。无响应、缺少状态或可见性受限时允许单项为未知。 [Steam 好友与聊天](https://help.steampowered.com/en/faqs/view/595C-42F4-3B66-E02F) · [Steam 私密游戏](https://help.steampowered.com/en/faqs/view/1150-C06F-4D62-4966)
- **记录变化与缺口。** SQLite 保存名单、当前读数、变化事件和采集缺口。每次有效采样刷新最近观测时间，只有状态或游戏变化才写活动事件。超时、休眠和暂停都保留为缺口，重连时建立新基线，缺口两侧分别计算观察到的时长。
- **时间口径。** 时间线标注首次观测到变化的时间。两次采样之间开始又结束的活动可能漏记，统计页把游戏时长和共同在线时段标为估计值，并显示有效采集覆盖率。
- **数据范围。** 导入与开始记录分两步。长期记录仅针对自己的账号或已提出请求并知悉保存内容的好友。默认本地处理，通知规则也默认只使用系统通知。 [Steam Web API 使用条款](https://steamcommunity.com/dev/apiterms)

## 5. 可借鉴的项目

| 项目 | 值得分析的部分 | 采用方式 |
| --- | --- | --- |
| **misiektoja/steam_monitor** | 最接近本项目的 Python CLI，已有上下线、游戏变化、CSV、通知和重启恢复。源码从 `steam_monitor_user()` 和 `write_csv_entry()` 看起，重点追踪同一轮采样同时发生在线状态变化和游戏变化时如何写记录。 | 可以直接试跑作为基准，用相同测试账号对照结果。源码为 GPL-3.0，首版按参考行为独立实现，若决定 fork 再按许可证安排分发。 [项目](https://github.com/misiektoja/steam_monitor) · [核心源码](https://github.com/misiektoja/steam_monitor/blob/main/steam_monitor.py) · [许可证](https://github.com/misiektoja/steam_monitor/blob/main/LICENSE) |
| **Uptime Kuma** | 参考它的状态历史条和悬浮详情，把正常采集、状态变化和无数据间隔放在一条时间轴上。可直接阅读 `HeartbeatBar.vue`，也可以看官方演示。 | MIT。借鉴界面交互，历史模型按好友和游戏重新定义。 [项目与演示入口](https://github.com/louislam/uptime-kuma) · [时间条源码](https://github.com/louislam/uptime-kuma/blob/master/src/components/HeartbeatBar.vue) |
| **Steam Friends & Chat** | 看头像、昵称和状态怎样在一行内排布，重点参考紧凑列表、按游戏分组和点击好友后的操作层级。 | 作为产品交互参考。 [官方功能介绍](https://steamcommunity.com/updates/chatupdate) |
| **DoctorMcKay/node-steam-user** | Node.js 客户端协议库。分析 `friendsList`、`friendPersonasLoaded` 和 `user` 事件，以及 `components/friends.js` 对好友状态和当前游戏字段的处理。 | MIT。适合 TypeScript 方案的登录模式验证。 [项目文档](https://github.com/DoctorMcKay/node-steam-user) · [好友状态源码](https://github.com/DoctorMcKay/node-steam-user/blob/master/components/friends.js) |
| **SteamRE/SteamKit2** | .NET 客户端协议库。可对照 `SteamFriends` 的 `PersonaStateCallback` 和游戏 AppID 处理，适合分析登录采集行为。 | LGPL-2.1，作为协议实现的对照和 .NET 方案的备选。 [项目](https://github.com/SteamRE/SteamKit) · [好友处理源码](https://github.com/SteamRE/SteamKit/blob/master/SteamKit2/SteamKit2/Steam/Handlers/SteamFriends/SteamFriends.cs) |

## 6. 开发顺序与验收

1. **验证数据源。** 用自有或同意测试的账号覆盖在线、离开、开游戏、切换游戏、隐身、私密游戏和网络失败。对照 Steam 好友列表，记录可见字段和差异。先确定哪些条件能可靠地产生事件，再定界面文案。
2. **完成首版。** 实现批量轮询、事件去重、SQLite、好友列表、时间线、托盘和导出。验收时模拟超过 100 个 ID 的批量请求，检查一次有效变化只写一次，重启后历史可读，断网与休眠会形成缺口，CSV 与选定筛选范围一致。
3. **补齐开黑功能。** 实现按游戏聚合、本地通知和 7 天／30 天回顾。验证免打扰、通知冷却和重连后不批量补发。最后根据可见性实测决定是否加入登录模式。
