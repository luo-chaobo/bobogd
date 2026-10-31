# Bobo Local Tunnel Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual reverse-SSH command with safe one-click start and stop scripts that own one tunnel, classify remote port conflicts, and reconnect without killing unknown processes.

**Architecture:** Thin entry scripts import a PowerShell module that contains all lifecycle decisions and accepts a command adapter for deterministic tests. The managed SSH session writes an ownership marker on the server; unknown listeners fail closed. Windows SSH Agent holds the passphrase-protected key, while the tunnel manager runs SSH in batch mode.

**Tech Stack:** Windows PowerShell 5.1, Windows OpenSSH, Node.js built-in test runner, Linux OpenSSH/systemd.

**Spec:** `docs/superpowers/specs/2026-09-20-bobo-tunnel-manager-design.md`

## Global Constraints

- The private-key passphrase must never be written to disk, passed as a command-line argument, or logged.
- Remote port `13000` must remain bound to `127.0.0.1`, never a public interface.
- Unknown remote listeners must be reported and left untouched.
- Stop logic may terminate only a process whose executable and complete tunnel arguments match the recorded project state.
- Existing Node processes that predate the manager must not be stopped by the manager.
- Retry delays are exactly `2, 5, 10, 20, 30` seconds, capped at 10 consecutive failures.
- Runtime state and logs remain outside Git in `tmp/` and `logs/`.
- Production or test business data must not be modified by tunnel management.

## Review Focus

- A stale state file whose PID was reused by an unrelated process must be rejected; Task 1 tests full executable and argument matching.
- A remote listener that answers HTTP but is not the expected health service must not be reused; Task 3 tests the exact health payload.
- A local server that opens port 3000 but fails its health endpoint must block tunnel creation; Task 3 tests health rather than port presence.
- Ctrl+C during a reconnect delay must clean state without terminating a pre-existing Node process; Task 3 tests ownership flags and final cleanup.
- SSH Agent service availability without the required key must produce setup guidance rather than an interactive hang; Task 2 tests the missing-key branch.

---

### Task 1: Testable tunnel decision module

**Files:**
- Create: `scripts/BoboTunnelManager.psm1`
- Create: `tests/tunnel-manager-core.test.ps1`
- Create: `tests/tunnel-manager-core.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: no project-specific interface.
- Produces: `New-BoboTunnelConfig`, `Get-RemotePortDisposition`, `Get-ReconnectDelaySeconds`, `Test-ManagedProcess`, `Read-TunnelState`, `Write-TunnelState`, and `Remove-TunnelState`.

- [ ] **Step 1: Write the failing PowerShell behavior tests**

Create `tests/tunnel-manager-core.test.ps1` with a local `Assert-Equal` helper and literal expectations:

```powershell
$ErrorActionPreference = "Stop"
Import-Module "$PSScriptRoot\..\scripts\BoboTunnelManager.psm1" -Force

function Assert-Equal($Actual, $Expected, $Name) {
  if ($Actual -ne $Expected) { throw "$Name expected '$Expected', got '$Actual'" }
}

Assert-Equal (Get-RemotePortDisposition -Listening:$false -HealthValid:$false -ManagedMarkerValid:$false) "free" "free port"
Assert-Equal (Get-RemotePortDisposition -Listening:$true -HealthValid:$true -ManagedMarkerValid:$false) "reuse" "healthy port"
Assert-Equal (Get-RemotePortDisposition -Listening:$true -HealthValid:$false -ManagedMarkerValid:$true) "cleanup-managed" "managed stale port"
Assert-Equal (Get-RemotePortDisposition -Listening:$true -HealthValid:$false -ManagedMarkerValid:$false) "refuse-unknown" "unknown port"

$expectedDelays = @(2, 5, 10, 20, 30, 30)
for ($index = 0; $index -lt $expectedDelays.Count; $index += 1) {
  Assert-Equal (Get-ReconnectDelaySeconds ($index + 1)) $expectedDelays[$index] "delay $($index + 1)"
}

$config = New-BoboTunnelConfig -Root "D:\波波本地联调"
$matching = [pscustomobject]@{
  Path = "C:\Windows\System32\OpenSSH\ssh.exe"
  CommandLine = 'ssh.exe -i C:\Users\luoch\.ssh\wljixie_local_bobo_tunnel -R 127.0.0.1:13000:127.0.0.1:3000 root@47.99.105.37'
}
$reusedPid = [pscustomobject]@{ Path = "C:\Windows\System32\notepad.exe"; CommandLine = $matching.CommandLine }
Assert-Equal (Test-ManagedProcess -Process $matching -Config $config) $true "matching ssh"
Assert-Equal (Test-ManagedProcess -Process $reusedPid -Config $config) $false "reused pid"

$statePath = Join-Path $TestDrive "tunnel-state.json"
Write-TunnelState -Path $statePath -State @{ sshPid = 1234; nodePid = 0; nodeOwned = $false; startedAt = "2026-09-20T19:00:00+08:00" }
Assert-Equal (Read-TunnelState -Path $statePath).sshPid 1234 "state round trip"
Remove-TunnelState -Path $statePath
Assert-Equal (Test-Path -LiteralPath $statePath) $false "state removed"
```

The test must create its own temporary `$TestDrive` before writing state and remove it in `finally`.

- [ ] **Step 2: Add the Node test wrapper and verify RED**

Create `tests/tunnel-manager-core.test.js`:

```javascript
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("PowerShell tunnel manager core decisions", () => {
  const script = path.join(__dirname, "tunnel-manager-core.test.ps1");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
```

Run: `node --test tests/tunnel-manager-core.test.js`

Expected: FAIL because `scripts/BoboTunnelManager.psm1` does not exist.

- [ ] **Step 3: Implement the minimal pure module**

Implement the produced functions. `Get-RemotePortDisposition` must return only the four literal states tested above. `Test-ManagedProcess` must require all of:

```text
Path filename equals ssh.exe
CommandLine contains the configured identity path
CommandLine contains 127.0.0.1:13000:127.0.0.1:3000
CommandLine contains root@47.99.105.37
```

`Write-TunnelState` must create the parent directory and use `ConvertTo-Json`; `Read-TunnelState` returns `$null` when absent; `Remove-TunnelState` uses `-LiteralPath` and is idempotent.

- [ ] **Step 4: Ignore runtime output and verify GREEN**

Add these exact entries to `.gitignore`:

```gitignore
tmp/tunnel-state.json
logs/tunnel-manager.log
```

Run: `node --test tests/tunnel-manager-core.test.js`

Expected: PASS, one Node test and all PowerShell assertions exit successfully.

- [ ] **Step 5: Commit Task 1**

```powershell
git add scripts/BoboTunnelManager.psm1 tests/tunnel-manager-core.test.ps1 tests/tunnel-manager-core.test.js .gitignore
git commit -m "test: add tunnel manager decision core"
```

### Task 2: Passphrase-safe SSH Agent setup

**Files:**
- Modify: `scripts/BoboTunnelManager.psm1`
- Create: `配置联调密钥.ps1`
- Create: `tests/tunnel-key-agent.test.ps1`
- Create: `tests/tunnel-key-agent.test.js`

**Interfaces:**
- Consumes: `New-BoboTunnelConfig` from Task 1 and a command adapter hashtable with `GetAgentService`, `StartAgentService`, `ListKeys`, and `AddKey` scriptblocks.
- Produces: `Initialize-BoboTunnelKey -Config <pscustomobject> -Adapter <hashtable>` returning `ready`, `needs-admin`, or `add-failed`.

- [ ] **Step 1: Write failing adapter-driven tests**

Create a PowerShell test that imports the module and supplies literal adapters for:

```powershell
$disabled = @{
  GetAgentService = { [pscustomobject]@{ Status = "Stopped"; StartType = "Disabled" } }
  StartAgentService = { throw "must not start disabled service" }
  ListKeys = { "" }
  AddKey = { throw "must not add key" }
}
Assert-Equal (Initialize-BoboTunnelKey -Config $config -Adapter $disabled) "needs-admin" "disabled agent"

$loaded = @{
  GetAgentService = { [pscustomobject]@{ Status = "Running"; StartType = "Manual" } }
  StartAgentService = { }
  ListKeys = { "SHA256:expected wljixie_local_bobo_tunnel" }
  AddKey = { throw "must not add loaded key" }
}
Assert-Equal (Initialize-BoboTunnelKey -Config $config -Adapter $loaded) "ready" "loaded key"
```

Add a third adapter where the service is running, the first key list is empty, `AddKey` returns exit code 0, and the second key list contains the expected key. Expect `ready` and exactly one `AddKey` call.

- [ ] **Step 2: Add Node wrapper and verify RED**

Use the Task 1 wrapper pattern to run `tests/tunnel-key-agent.test.ps1`.

Run: `node --test tests/tunnel-key-agent.test.js`

Expected: FAIL because `Initialize-BoboTunnelKey` is not exported.

- [ ] **Step 3: Implement key initialization and entry script**

Add `Initialize-BoboTunnelKey` to the module. Create `配置联调密钥.ps1` that builds the real adapter using `Get-Service ssh-agent`, `Start-Service ssh-agent`, `ssh-add -l`, and `ssh-add <identityPath>`.

When the service is disabled, print these exact administrator commands and exit nonzero:

```powershell
Set-Service ssh-agent -StartupType Manual
Start-Service ssh-agent
```

Do not automatically elevate. Do not capture or redirect the interactive `ssh-add` passphrase prompt.

- [ ] **Step 4: Verify GREEN and syntax**

Run:

```powershell
node --test tests/tunnel-key-agent.test.js
powershell -NoProfile -Command "Import-Module '.\scripts\BoboTunnelManager.psm1' -Force"
```

Expected: tests pass and module import exits 0.

- [ ] **Step 5: Commit Task 2**

```powershell
git add scripts/BoboTunnelManager.psm1 配置联调密钥.ps1 tests/tunnel-key-agent.test.ps1 tests/tunnel-key-agent.test.js
git commit -m "feat: configure tunnel key through ssh agent"
```

### Task 3: One-click start, safe stop, and reconnect loop

**Files:**
- Modify: `scripts/BoboTunnelManager.psm1`
- Create: `启动联调.ps1`
- Create: `停止联调.ps1`
- Create: `tests/tunnel-lifecycle.test.ps1`
- Create: `tests/tunnel-lifecycle.test.js`

**Interfaces:**
- Consumes: all Task 1 and Task 2 interfaces plus an adapter with `GetLocalHealth`, `StartNode`, `ProbeRemote`, `CleanupManagedRemote`, `StartSsh`, `GetProcess`, `StopProcess`, `WaitProcess`, `Sleep`, and `WriteLog` scriptblocks.
- Produces: `Resolve-BoboTunnelStartup`, `Stop-BoboManagedTunnel`, and `Start-BoboTunnelLoop`.

- [ ] **Step 1: Write failing lifecycle tests**

Use fake adapters and literal call counters to cover these cases in `tests/tunnel-lifecycle.test.ps1`:

```text
local health valid + remote health valid -> reuse, StartNode=0, StartSsh=0
local health invalid -> StartNode=1, wait for exact health payload before remote probe
remote managed stale marker -> CleanupManagedRemote=1, StartSsh=1
remote unknown listener -> result refuse-unknown, CleanupManagedRemote=0, StartSsh=0
remote HTTP 200 with wrong JSON service -> not healthy and never reuse
state PID points to notepad.exe -> StopProcess=0 and result ownership-mismatch
state PID matches ssh.exe and all tunnel args -> StopProcess=1 and state removed
pre-existing Node -> final cleanup leaves Node running
manager-owned Node with explicit StopOwnedNode -> final cleanup calls StopProcess once
11 rapid SSH failures -> exactly 10 start attempts with delays 2,5,10,20,30,30,30,30,30
adapter errors containing a fake passphrase and environment value -> persisted log contains neither sensitive value
```

The expected health object is exactly:

```powershell
@{ enabled = $true; service = "external-work-orders"; processMode = "single-process" }
```

- [ ] **Step 2: Add Node wrapper and verify RED**

Run: `node --test tests/tunnel-lifecycle.test.js`

Expected: FAIL because lifecycle functions are absent.

- [ ] **Step 3: Implement lifecycle functions**

Implement the three exported functions with no direct system calls; every side effect goes through the adapter. `Resolve-BoboTunnelStartup` returns one of `reuse`, `start`, or `refuse-unknown`. `Start-BoboTunnelLoop` stops after 10 consecutive quick failures and resets failure count only after a run lasting at least 60 seconds.

The remote managed-session command must write `/run/wljixie-bobo-tunnel-13000.state` with its PID and marker `wljixie-bobo-tunnel-13000`, install an EXIT trap, and remain alive with `sleep 30`.

- [ ] **Step 4: Implement thin real entry scripts**

`启动联调.ps1` must:

```text
Import the module
create Local\WljixieBoboTunnel13000 mutex
build the fixed config and real adapter
redirect managed Node output to server.out.log and server.err.log
run Start-BoboTunnelLoop
release mutex and state in finally
```

`停止联调.ps1` must import the module, build only process-query, process-stop, remote-probe, and logging adapter functions, then call `Stop-BoboManagedTunnel`.

Use `Start-Process -WindowStyle Hidden` for background Node/SSH child processes. Keep the manager PowerShell window visible.

- [ ] **Step 5: Verify GREEN and run tunnel test group**

Run:

```powershell
node --test tests/tunnel-manager-core.test.js tests/tunnel-key-agent.test.js tests/tunnel-lifecycle.test.js
```

Expected: PASS, three Node wrappers with zero failed PowerShell assertions.

- [ ] **Step 6: Commit Task 3**

```powershell
git add scripts/BoboTunnelManager.psm1 启动联调.ps1 停止联调.ps1 tests/tunnel-lifecycle.test.ps1 tests/tunnel-lifecycle.test.js
git commit -m "feat: manage local bobo reverse tunnel"
```

### Task 4: Operator guide and full local regression

**Files:**
- Create: `docs/本地波波联调隧道操作说明.md`
- Modify: `README.md`
- Modify: `D:/WMR/lcb/未来网站改造/docs/测试域名联调操作手册.md`

**Interfaces:**
- Consumes: the three root scripts and fixed commands from Tasks 2 and 3.
- Produces: one operator path for setup, start, stop, status verification, and unknown-listener escalation.

- [ ] **Step 1: Write the operator guide**

Document these exact flows:

```text
First use: run administrator ssh-agent commands, then 配置联调密钥.ps1
Normal use: run 启动联调.ps1 and keep its window open
Stop: run 停止联调.ps1
Local check: Invoke-RestMethod http://127.0.0.1:3000/api/external/health
Remote check: curl -sS http://127.0.0.1:13000/api/external/health
Unknown listener: copy the diagnostic output; do not run fuser -k or pkill
```

README must link to this guide and remove any recommendation to type the raw reverse-tunnel command for routine operation.

Replace the website manual's routine raw `ssh -R` instructions with the same first-use, start, stop, local-health, and remote-health commands. Keep the raw SSH command only in a clearly marked troubleshooting section that says it must not be used while the managed script is running.

- [ ] **Step 2: Run syntax and full test verification**

Run:

```powershell
powershell -NoProfile -Command "Import-Module '.\scripts\BoboTunnelManager.psm1' -Force"
$testFiles = Get-ChildItem -LiteralPath 'tests' -Filter '*.test.js' | ForEach-Object FullName
node --test $testFiles
git diff --check
```

Expected: module import exits 0, all tests pass, and `git diff --check` reports no whitespace errors.

- [ ] **Step 3: Commit Task 4**

```powershell
git add docs/本地波波联调隧道操作说明.md README.md
git commit -m "docs: add managed tunnel operating guide"

git -C "D:\WMR\lcb\未来网站改造" add docs/测试域名联调操作手册.md
git -C "D:\WMR\lcb\未来网站改造" commit -m "docs: use managed bobo tunnel workflow"
```

### Task 5: Guarded one-time server migration and live acceptance

**Files:**
- No repository files unless live evidence reveals a documented command mismatch; any correction must return to a failing test before code changes.

**Interfaces:**
- Consumes: tested scripts from Tasks 1-4 and server `47.99.105.37`.
- Produces: validated managed tunnel on `127.0.0.1:13000` and verified server keepalive configuration.

- [ ] **Step 1: Stop and request explicit authorization**

This task changes a remote server and may terminate the legacy tunnel SSH child. Present the listener evidence and obtain explicit user approval before continuing.

- [ ] **Step 2: Inspect the legacy listener without changing it**

Run interactively from the user's PowerShell:

```powershell
ssh -i "$env:USERPROFILE\.ssh\wljixie_local_bobo_tunnel" -o IdentitiesOnly=yes root@47.99.105.37 `
  "ss -ltnp 'sport = :13000'; test -f /run/wljixie-bobo-tunnel-13000.state && cat /run/wljixie-bobo-tunnel-13000.state || true"
```

Expected: exact listener program and PID are visible. If the listener is not an `sshd: root@notty` child, stop and report unknown ownership.

- [ ] **Step 3: Clean only the verified legacy SSH child**

After the Step 2 evidence and authorization, run a guarded remote command that extracts the listener PID, verifies `/proc/<pid>/comm` equals `sshd`, verifies `ps -o args=` contains `root@notty`, and only then sends `TERM` to that PID. Any failed predicate exits nonzero without killing anything.

Expected: `ss -ltnp 'sport = :13000'` returns no listener after the server releases the session.

- [ ] **Step 4: Install server keepalive configuration safely**

Create `/etc/ssh/sshd_config.d/90-bobo-tunnel-keepalive.conf` with:

```text
ClientAliveInterval 30
ClientAliveCountMax 3
```

Before writing, copy any existing file to a timestamped backup. Run `/usr/sbin/sshd -t`; only on exit 0 run `systemctl reload sshd`. Keep the current SSH window open and prove a second SSH connection succeeds before closing it.

- [ ] **Step 5: Configure the key and start the managed tunnel**

Run `配置联调密钥.ps1`, then `启动联调.ps1`. If SSH Agent is disabled, run the two documented administrator commands first.

Expected: local health is valid, one SSH child is recorded in `tmp/tunnel-state.json`, and no `remote port forwarding failed` message appears.

- [ ] **Step 6: Verify both directions and duplicate-start behavior**

Verify locally:

```powershell
Invoke-RestMethod "http://127.0.0.1:3000/api/external/health"
```

Verify remotely:

```bash
curl -sS http://127.0.0.1:13000/api/external/health
```

Run `启动联调.ps1` a second time.

Expected: both health checks report `enabled=true` and `service=external-work-orders`; the second start reports an existing manager or usable tunnel instead of a port-forwarding failure.

- [ ] **Step 7: Verify controlled stop and one reconnect**

Run `停止联调.ps1` and confirm the remote port is released. Start again, terminate only the recorded SSH PID, and observe one successful automatic reconnect with a new PID.

Expected: no unrelated Node or SSH process is terminated, and the final remote health check succeeds.

- [ ] **Step 8: Record acceptance without committing runtime state**

Confirm `git status --short` does not include `tmp/tunnel-state.json` or `logs/tunnel-manager.log`. Record command results in the task completion report; do not commit runtime state, server configuration, key material, or logs.
