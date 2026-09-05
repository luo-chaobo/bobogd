# 波波工单 TV 版 APK

这是红米/小米电视使用的工单看板 APK 项目。电视安装后打开应用，会自动全屏加载：

`https://screen.wljixie.com/tv.html`

## 功能

- 横屏全屏显示生产状态监控看板
- 保持屏幕常亮
- 隐藏系统状态栏和导航栏
- 支持遥控器确认键/菜单键刷新看板
- 网络断开或页面加载失败时显示重试提示
- 每 10 分钟自动刷新一次，降低长时间展示卡住的概率
- 出现在电视应用列表中，名称为“波波工单TV”

## 打包 APK 的方法

### 方法一：Android Studio

1. 安装 Android Studio。
2. 打开 Android Studio。
3. 选择 `Open`，打开本目录：
   `D:\codex内容\copy黑湖小工单\tv-apk`
4. 等待 Gradle 同步完成。
5. 菜单选择：
   `Build -> Build Bundle(s) / APK(s) -> Build APK(s)`
6. 打包完成后，APK 一般在：
   `tv-apk\app\build\outputs\apk\debug\app-debug.apk`

### 方法二：命令行

需要本机安装 JDK、Android SDK、Gradle。进入 `tv-apk` 目录后执行：

```powershell
gradle assembleDebug
```

## 安装到红米电视

1. 将 `app-debug.apk` 放到 U 盘。
2. U 盘插入电视。
3. 在电视文件管理器里找到 APK。
4. 安装并打开“波波工单TV”。

如果电视限制 U 盘安装，可尝试：

- 小米电视助手推送安装
- ADB 安装
- 当贝市场/电视应用助手安装
- 外接安卓盒子安装

## 修改看板地址

如果以后看板地址变化，修改：

`app/src/main/res/values/strings.xml`

把：

```xml
<string name="dashboard_url">https://screen.wljixie.com/tv.html</string>
```

改成新的地址，然后重新打包 APK。

## 正式版签名

当前项目可以生成 debug APK 用于电视测试。正式长期使用建议生成 release APK 并签名。

Android Studio 菜单：

`Build -> Generate Signed Bundle / APK -> APK`

然后创建或选择 keystore，生成 release APK。

## Android 平板版

同一工程中的 `tablet` 模块是独立的“波波工单平板版”，不会覆盖电视版。它会横屏全屏加载：

`https://screen.wljixie.com/?tabletApp=1`

用户在 APP 中正常登录后台，再点击“手机横屏看板”。APP 只允许 `screen.wljixie.com` 在内部打开，其他链接交给系统浏览器。

Android Studio 中选择 `tablet` 模块构建，或执行：

```powershell
gradle :tablet:assembleDebug
```

调试 APK 输出位置：

`tablet\build\outputs\apk\debug\tablet-debug.apk`

内部长期使用时，通过 Android Studio 的 `Build -> Generate Signed Bundle / APK -> APK` 选择 `tablet` 模块并使用企业保管的 keystore 生成 release APK。签名文件和密码不得提交到项目目录。
