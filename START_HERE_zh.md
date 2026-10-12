# 快速开始

本版本使用独立的邮箱和密码注册、登录，不依赖 ChatGPT。

1. 安装 Node.js 22.13 以上版本，推荐 Node.js 24。
2. 解压源码，在项目文件夹中打开终端。
3. 执行 `npm install`。
4. 执行 `npm run dev`。
5. 打开 `http://localhost:5173`，点击 **Create account** 注册。

注册后可以上传图片、修改提示词和 Skill、保存个人配置。

要使用真实模型，把 `.env.example` 复制为 `.env`，填写 `VOLCENGINE_API_KEY` 和 `VOLCENGINE_TEXT_MODEL`。语言模型填写火山方舟控制台里实际可调用的 Seed 2.1 lite 模型 ID 或推理接入点 ID。图片模型默认 Seedream 4.5。修改后重新启动。

`npm run dev` 会同时启动前端和本地接口，无需再启动一个后端进程。

所有数据保存在 `data/` 文件夹中，重启不会丢失。代码包不包含任何 API Key、用户账号或运行数据。对外部署请阅读 README.md 中的 HTTPS 和持久化磁盘设置。

## 新增 Video Studio（视频工作台）

仍然使用邮箱与密码登录，英文界面，`npm run dev` 同时启动前端和本地服务。

### 配置视频模型

将 `.env.example` 复制为 `.env`，填写：

```dotenv
BAILIAN_API_KEY=你的百炼APIKey
BAILIAN_BASE_URL=https://llm-zox3pv2a4xrvokvg.cn-beijing.maas.aliyuncs.com/api/v1
BAILIAN_VIDEO_MODEL=wan3.0-video
DAILY_VIDEO_LIMIT=12
```

百炼 Key 与火山 Key 分开配置；Key 仅留在服务端。该地址对应 cityu 的默认业务空间 `llm-zox3pv2a4xrvokvg`。视频调用 DashScope `/services/aigc/video-generation/video-synthesis`，状态查询 `/tasks/{task_id}`，不使用 OpenAI 兼容地址。

火山语言模型继续填写 `VOLCENGINE_TEXT_MODEL`，以控制台实际模型调用 ID 或接入点为准。语言模型用于分镜与提示词；Seedream 用于素材图；Wan 用于视频。

### 安装自动剪辑依赖

自动合成需要本机安装 **FFmpeg 和 FFprobe**（支持 libx264、AAC、subtitles/libass）。先执行：

```bash
ffmpeg -version
ffprobe -version
```

Windows 如未加入 PATH，可在 `.env` 指定完整路径（建议正斜线）：

```dotenv
FFMPEG_PATH=C:/tools/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=C:/tools/ffmpeg/bin/ffprobe.exe
```

缺少 FFmpeg 不影响登录、分镜、图片或视频生成，仅影响合成导出。

### 课堂操作流程

1. **Video Studio → New film → Brief**：修改产品、目标客户、核心信息和风格。默认“面料 → Polo → 穿着效果”，4镜头，3+4+3+5=15秒。可直接用默认计划，也可让语言模型重新生成分镜。
2. **Storyboard**：编辑场景、动作、运镜、时长与字幕，确认分镜。个人 My agent 中的规则与 Skill 会用于语言模型的分镜和提示词准备。
3. **Images**：选图片历史中的图或上传产品参考图；每个镜头上传或生成首帧。变化镜头可增加尾帧。先审核素材，再进入 Clips。
4. **Clips**：查看或修改视频提示词。可让语言模型结合图片重写提示词，然后逐镜生成。也可上传已有 MP4。每次生成会消耗模型费用；仅重新生成不满意的镜头。
5. **Edit & Export**：设置裁切起点、字幕、品牌落版、Logo和音乐，合成 MP4。可以选择干净切换或短暂淡入淡出；最后2秒叠加品牌文字与Logo。

每个用户的项目和素材独立保存。离开页面后，只要本地服务仍在运行，后台每15秒查询视频任务并下载完成的视频。浏览器每5秒刷新正在生成的项目；服务重启后会继续查询已经保存 task ID 的任务。

**导出规则**：输出统一为720P画布、30fps（16:9 / 9:16 / 1:1）；按镜头时长裁切，片段较短时保持末帧；音乐替换原片段音轨。内置音乐是程序生成的简单氛围和弦，不是AI作曲。需要更好的广告配乐可上传有权使用的MP3/WAV。内置淡入淡出不会改变总时长。

支持图像8MB以内，MP4/MP3/WAV 100MB以内，导出镜头2–15秒、总长不超过60秒。字幕默认使用系统 DejaVu Sans/可用替代字体，英文最稳妥。任意中文等字幕请自行安装相应字体。

**次数说明**：`DAILY_VIDEO_LIMIT` 按用户、按UTC日期限制提交次数，而不是成功次数。失败或超时仍保留提交计数，避免不确定网络状态下重复收费。提交超时或进程在提交时中断，需要先查百炼控制台，再决定重试。平台生成日志中的 task ID 仅服务端保存；数据库为 `data/studio.sqlite`。

生成任务和数据存放在本机 `data/`，请备份。课堂多人访问需要将应用部署在持续运行的服务端，配置HTTPS、正确的 `PUBLIC_ORIGIN` 与 `COOKIE_SECURE=true`，并给运行进程设置足够磁盘空间；无需学员自行填写API Key。

### 验证与当前限制

已执行账号隔离、异步任务持久化、重复提交拦截、Wan请求格式测试，以及真实FFmpeg裁切/拼接/字幕/Logo/音乐和15秒输出测试。模型响应在测试中使用受控替代响应；本轮未提供真实API Key，因此没有实测百炼和火山付费模型。当前运行环境没有可用浏览器程序，未完成浏览器交互与视觉检查。

如果新生成分镜，会替换旧镜头计划，不会自动复用旧片段。分镜替换前请先导出成片或下载片段。生成的视频用于创意示意，请在发布前审核产品结构、面料纹理和信息准确性。

官方接口参考：https://help.aliyun.com/en/model-studio/wan3-video-generation-api-reference
