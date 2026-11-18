param(
  [string]$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$TaskName = 'InkMate'
)

$startScript = Join-Path $ProjectPath 'scripts\start-inkmate.cmd'
if (-not (Test-Path -LiteralPath $startScript)) {
  throw "找不到启动脚本: $startScript"
}

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description '墨伴 InkMate 本地服务（登录后自动启动）' `
  -Force | Out-Null

Write-Host "已注册计划任务: $TaskName"
Write-Host "启动脚本: $startScript"
Write-Host "取消: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
