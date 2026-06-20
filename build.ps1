<#
  KeyVault 构建脚本

  作用：自动配置 MSVC 编译环境，然后构建 Tauri 应用。

  为什么这样写：本机的 MSVC 编译器没进全局 PATH，直接 `bun run tauri build`
  会因为找不到 link.exe / *.lib 而失败。本脚本不写死任何版本号——而是用微软
  固定位置的 vswhere.exe 找到 Visual Studio / Build Tools 的安装路径，再导入
  官方 vcvars64.bat 来设置环境。无论以后 MSVC 工具集或 Windows SDK 版本怎么
  升级，脚本都无需修改。

  用法（在任意目录都可以）：
    powershell -ExecutionPolicy Bypass -File build.ps1          # 打包安装器（默认）
    powershell -ExecutionPolicy Bypass -File build.ps1 dev      # 开发模式运行
    powershell -ExecutionPolicy Bypass -File build.ps1 build    # 同默认
#>
param(
  [string]$Cmd = "build"
)

$ErrorActionPreference = "Stop"
# 脚本所在目录即项目根，构建始终相对它执行，和你从哪个目录调用无关。
$Root = $PSScriptRoot

function Fail($msg) { Write-Host "`n[构建失败] $msg" -ForegroundColor Red; exit 1 }

# --- 1) 确保 cargo 可用（Rust 工具链） ---
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
  if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
    $env:Path = "$cargoBin;$env:Path"
  } else {
    Fail "找不到 cargo。请先安装 Rust：https://rustup.rs"
  }
}

# --- 2) 确保 bun 可用（前端包管理器） ---
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Fail "找不到 bun。请先安装 bun：https://bun.sh"
}

# --- 3) 自动定位并导入 MSVC 环境（vcvars64.bat），不写死版本 ---
function Find-VcVars {
  # vswhere.exe 永远在这个固定位置（VS 安装器自带），用它定位 VS/BuildTools。
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $installPath = & $vswhere -latest -prerelease -products * `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      -property installationPath 2>$null | Select-Object -First 1
    if ($installPath) {
      $vc = Join-Path $installPath.Trim() "VC\Auxiliary\Build\vcvars64.bat"
      if (Test-Path $vc) { return $vc }
    }
  }
  # vswhere 不可用时的兜底：扫常见安装根目录（仍不写死版本号）。
  $roots = @(
    "${env:ProgramFiles}\Microsoft Visual Studio",
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio"
  )
  foreach ($r in $roots) {
    if (Test-Path $r) {
      $hit = Get-ChildItem -Path $r -Recurse -Filter "vcvars64.bat" -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($hit) { return $hit.FullName }
    }
  }
  return $null
}

$vcvars = Find-VcVars
if (-not $vcvars) {
  Fail "找不到 MSVC 环境（vcvars64.bat）。请安装 Visual Studio Build Tools 并勾选 'Desktop development with C++'。"
}
Write-Host "[1/2] 导入 MSVC 环境: $vcvars" -ForegroundColor Cyan

# 在 cmd 里执行 vcvars64.bat，再把它设置好的全部环境变量回灌到当前 PowerShell。
$envDump = cmd /c "`"$vcvars`" >nul 2>`&1 `& set"
foreach ($line in $envDump) {
  if ($line -match '^([^=]+)=(.*)$') {
    Set-Item -Path ("env:" + $matches[1]) -Value $matches[2]
  }
}

# --- 4) 构建 ---
Write-Host "[2/2] 运行: bun run tauri $Cmd" -ForegroundColor Cyan
Write-Host "      (首次 release 构建开启了 LTO，编译较慢，十几分钟属正常)`n" -ForegroundColor DarkGray

Push-Location $Root
try {
  bun run tauri $Cmd
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($code -ne 0) { Fail "tauri $Cmd 退出码 $code" }

if ($Cmd -eq "build") {
  Write-Host "`n[完成] 安装器已生成，位于：" -ForegroundColor Green
  Write-Host '  src-tauri\target\release\bundle\nsis\   (*-setup.exe)'
  Write-Host '  src-tauri\target\release\bundle\msi\    (*.msi)'
}
