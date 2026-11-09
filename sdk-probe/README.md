# Steam 好友视角验证

该工具由已登录的官方 Steam 客户端提供会话。它通过 Steamworks SDK 查询一个指定的好友，输出可见的在线状态和游戏 ID。标准输出不含 SteamID、凭据、游戏服务器地址或聊天数据。

## 构建与运行

需要 Valve 的 Steamworks SDK、自己的测试 AppID，以及拥有该 AppID 许可证的测试账号。用同一 Windows 用户启动官方 Steam 客户端和验证工具。开发阶段在探针目录新建 `steam_appid.txt`，写入自己的测试 AppID。

在 Visual Studio x64 开发者 PowerShell 中设置 `STEAMWORKS_SDK` 为解压后的 SDK 目录，然后在此目录运行：

```powershell
cl.exe /nologo /EHsc /std:c++17 "/I$env:STEAMWORKS_SDK\public" friend_probe.cpp /link "/LIBPATH:$env:STEAMWORKS_SDK\redistributable_bin\win64" steam_api64.lib /OUT:SteamFriendProbe.exe
Copy-Item -LiteralPath "$env:STEAMWORKS_SDK\redistributable_bin\win64\steam_api64.dll" -Destination .
.\SteamFriendProbe.exe <SteamID64>
```

SDK 初始化依赖 Steam 客户端、AppID 和当前账号的许可证。探针、SDK DLL 和开发 AppID 文件独立于便携版。 [Valve 的 SDK 初始化说明](https://partner.steamgames.com/doc/sdk/api#initialization_and_shutdown)

## 对照验收

用两个同意参与的账号做同一时刻的对照。观察账号用 Steam 官方好友列表核对，探针负责提供第三个读数。

| 测试步骤 | 需要核对 |
| --- | --- |
| 测试好友公开在线并启动游戏 | 记录公开 API、Steam 好友列表和探针读数，确认游戏 ID。 |
| 把游戏详情设为仅好友可见 | 比较三个数据源，检查好友视角是否仍可见，核对公开 API 的行为。 |
| 测试好友切换离开、离线、隐身及私密游戏 | 记录界面上实际可见的状态。将隐身与显示离线的读数按 Steam 客户端所见记录。 |
| 观察账号退出 Steam 或断网后重连 | 断开时检查明确的失败返回，重连后重新运行并核对新读数。 |
| 测试账号玩游戏后查看累计分钟数 | 用公开时长对比记录 API 更新延迟，保留采集起止时间与 Steam 客户端所见。 |

Windows 自启验收时，在便携版设置中启用托盘启动，正常退出后重新登录 Windows。检查仅出现一个托盘实例、应用继续采集、断开期留有缺口，再从托盘打开主界面。

当前便携版继续使用公开 Web API。探针是验证入口，实际接入需要完成上述授权账号测试。 [Steamworks 好友接口](https://partner.steamgames.com/doc/api/ISteamFriends) · [Steam 用户协议](https://store.steampowered.com/subscriber_agreement/#4)
