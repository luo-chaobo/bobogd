$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = "C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

Set-Location $root
Write-Host "正在启动非标钣金工单系统..."
Write-Host "启动成功后请打开：http://localhost:3000"
Write-Host "不要关闭这个窗口；关闭窗口后系统会停止。"
& $node "$root\server.js"
