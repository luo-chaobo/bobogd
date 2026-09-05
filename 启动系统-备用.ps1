$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = "C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

try {
  Set-Location $root
  Write-Host "正在启动非标钣金工单系统..."
  Write-Host ""
  Write-Host "启动成功后请打开：http://localhost:3000"
  Write-Host "不要关闭这个窗口；关闭窗口后系统会停止。"
  Write-Host ""

  if (-not (Test-Path $node)) {
    throw "没有找到 Node 运行环境：$node"
  }
  if (-not (Test-Path "$root\server.js")) {
    throw "没有找到 server.js：$root\server.js"
  }

  & $node "$root\server.js"
}
catch {
  Write-Host ""
  Write-Host "启动失败："
  Write-Host $_.Exception.Message
  Write-Host ""
  Read-Host "按回车键关闭"
}
