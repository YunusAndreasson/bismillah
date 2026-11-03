# Puts bismillah on a USB stick, or updates a bismillah stick and keeps its texts.
# On Windows 10 and 11, in PowerShell:
#
#   irm https://bismillah-app.pages.dev/install.ps1 | iex
#
# It downloads the stick's image from the same site, checks every part against its
# sha256, lists the USB disks and asks which one to use. It writes only to a disk that
# is USB and not this computer's own, and only after the stick's name is typed back.
# The writing is done by bismillah-install, from the same download (ADR-0017 in the
# bismillah repository). Windows asks once for permission to write to the stick.
#
# BISMILLAH_STICK_URL points it at another copy of the downloads (the tests).
#
# Everything is inside one script block, so a cut-off download of this script doesn't
# parse and runs nothing. It never calls exit, which would close your PowerShell window.

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $Base = 'https://bismillah-app.pages.dev/stick'
  if ($env:BISMILLAH_STICK_URL) { $Base = $env:BISMILLAH_STICK_URL }
  $Script = ($Base -replace '/stick$', '') + '/install.ps1'

  function Say([string]$Text) { Write-Host $Text }
  # Ends the install with a message, without closing the window.
  function Stop-Install([string]$Text) { throw [System.OperationCanceledException]::new($Text) }

  function Get-Sha256([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }

  function Get-Url([string]$Url, [string]$OutFile) {
    if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
      & curl.exe -fL --progress-bar --retry 3 -o $OutFile $Url
      return ($LASTEXITCODE -eq 0)
    }
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
      return $true
    } catch {
      return $false
    }
  }

  # Downloads $Name from this version's folder unless it is there and matches $Hash.
  function Get-Part([string]$Dir, [string]$Version, [string]$Name, [string]$Hash) {
    # Only plain names, so a damaged manifest can't write outside this folder.
    if ($Name -cnotmatch '^[A-Za-z0-9_-][A-Za-z0-9._-]*$') {
      Stop-Install "The manifest names an unexpected file ($Name)."
    }
    $file = Join-Path $Dir $Name
    if ((Test-Path -LiteralPath $file) -and ((Get-Sha256 $file) -eq $Hash)) { return }
    Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue
    if (-not (Get-Url "$Base/$Version/$Name" "$file.part")) {
      Stop-Install "Couldn't download $Name. Check the connection and run the command again."
    }
    if ((Get-Sha256 "$file.part") -ne $Hash) {
      Remove-Item -LiteralPath "$file.part"
      Stop-Install "$Name arrived damaged. Run the command again."
    }
    Move-Item -LiteralPath "$file.part" -Destination $file -Force
  }

  # Windows writes to a volume's sectors only while that volume is locked and
  # dismounted; this holds both until the handles are closed.
  function Add-VolumeLock {
    if ('BismillahVolume' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class BismillahVolume {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DeviceIoControl(SafeFileHandle handle, uint code, IntPtr input, uint inputSize, IntPtr output, uint outputSize, out uint returned, IntPtr overlapped);

  const uint FSCTL_LOCK_VOLUME = 0x00090018;
  const uint FSCTL_DISMOUNT_VOLUME = 0x00090020;

  public static SafeFileHandle LockAndDismount(string volume) {
    SafeFileHandle handle = CreateFileW(volume.TrimEnd('\\'), 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
    uint returned;
    for (int tries = 0; ; tries++) {
      if (DeviceIoControl(handle, FSCTL_LOCK_VOLUME, IntPtr.Zero, 0, IntPtr.Zero, 0, out returned, IntPtr.Zero)) break;
      if (tries == 20) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
      System.Threading.Thread.Sleep(500);
    }
    if (!DeviceIoControl(handle, FSCTL_DISMOUNT_VOLUME, IntPtr.Zero, 0, IntPtr.Zero, 0, out returned, IntPtr.Zero)) {
      int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error);
    }
    return handle;
  }
}
'@
  }

  function Select-Stick([long]$RawSize) {
    $disks = @(Get-Disk | Where-Object { $_.BusType -eq 'USB' -and -not $_.IsBoot -and -not $_.IsSystem })
    if ($disks.Count -eq 0) { Stop-Install 'No USB stick is plugged in. Plug one in and run the command again.' }
    Say 'USB disks:'
    $disks | Format-Table -AutoSize Number, FriendlyName, @{ Label = 'Size'; Expression = { '{0:N1} GB' -f ($_.Size / 1e9) } }, PartitionStyle | Out-Host
    $answer = Read-Host 'Which one is the stick? Its number'
    $disk = $disks | Where-Object { "$($_.Number)" -eq $answer.Trim() }
    if (-not $disk) { Stop-Install "$answer isn't one of the USB disks listed. Nothing was written." }
    # Get-Disk again, by number, so nothing changed since the list.
    $disk = Get-Disk -Number $disk.Number
    if ($disk.BusType -ne 'USB' -or $disk.IsBoot -or $disk.IsSystem) {
      Stop-Install "Disk $($disk.Number) holds this computer's system. Nothing was written."
    }
    $letters = @(Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue |
        Where-Object { $_.DriveLetter } | ForEach-Object { "$($_.DriveLetter):" })
    $paging = @(Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue | ForEach-Object { $_.Name.Substring(0, 2).ToUpperInvariant() })
    foreach ($letter in $letters) {
      if ($paging -contains $letter.ToUpperInvariant()) {
        Stop-Install "Disk $($disk.Number) holds Windows' page file ($letter). Nothing was written."
      }
    }
    if ($disk.LogicalSectorSize -ne 512) {
      Stop-Install "Disk $($disk.Number) has $($disk.LogicalSectorSize)-byte sectors; bismillah needs a stick with 512-byte sectors."
    }
    if ($disk.Size -lt $RawSize) {
      Stop-Install ('Disk {0} is too small ({1:N1} GB). bismillah needs {2:N1} GB or more.' -f $disk.Number, ($disk.Size / 1e9), ($RawSize / 1e9))
    }
    if ($letters.Count -gt 0) { Say "Its drives: $($letters -join ', ')" }
    return $disk
  }

  function Install-Bismillah {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) {
      Say 'Windows asks for permission to write to the stick. The install goes on in the window that opens.'
      $command = "`$env:BISMILLAH_STICK_URL = '$Base'; irm '$Script' | iex; Read-Host 'Press Enter to close'"
      $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
      try {
        Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
      } catch {
        Stop-Install 'Windows was not given permission. Nothing was written.'
      }
      return
    }

    Say 'bismillah: putting the editor on a USB stick'
    Say ''
    $tmp = [IO.Path]::GetTempFileName()
    if (-not (Get-Url "$Base/current" $tmp)) {
      Stop-Install "Couldn't reach $Base. Check the connection and run the command again."
    }
    $version = (Get-Content -LiteralPath $tmp -TotalCount 1).Trim()
    Remove-Item -LiteralPath $tmp
    if ($version -eq 'none') { Stop-Install 'No bismillah stick image is published yet.' }
    if ($version -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$') { Stop-Install "The site gave an unexpected version name ($version)." }

    $root = Join-Path $env:LOCALAPPDATA 'bismillah'
    $cache = Join-Path $root 'cache'
    $state = Join-Path $root 'state'
    $dir = Join-Path $cache $version
    New-Item -ItemType Directory -Force -Path $dir, $state | Out-Null
    $manifestPath = Join-Path $dir 'manifest'
    if (-not (Get-Url "$Base/$version/manifest" $manifestPath)) {
      Stop-Install "Couldn't download the manifest. Run the command again."
    }
    $manifest = @(Get-Content -LiteralPath $manifestPath)
    if ($manifest[0] -ne 'bismillah-stick 1') {
      Stop-Install 'This image needs a newer version of this script. Copy the command from the site again.'
    }
    $lines = $manifest | ForEach-Object { , ($_ -split ' ') }
    $parts = @($lines | Where-Object { $_[0] -eq 'part' })
    $tool = $lines | Where-Object { $_[0] -eq 'tool' -and $_[1] -eq 'windows-x86_64' } | Select-Object -First 1
    $rawSize = [long](($lines | Where-Object { $_[0] -eq 'raw-size' } | Select-Object -First 1)[1])
    if (-not $tool) { Stop-Install 'This image has no installer for Windows yet.' }

    $bytes = ($parts | ForEach-Object { [long]$_[2] } | Measure-Object -Sum).Sum
    Say ('Downloading bismillah {0} ({1:N0} MB) to {2}' -f $version, ($bytes / 1e6), $dir)
    foreach ($part in $parts) { Get-Part $dir $version $part[1] $part[3] }
    Get-Part $dir $version $tool[2] $tool[4]
    $exe = Join-Path $dir $tool[2]
    Say ''

    $disk = Select-Stick $rawSize
    $raw = "\\.\PhysicalDrive$($disk.Number)"
    $name = $disk.FriendlyName.Trim()
    $shown = '{0:N1} GB' -f ($disk.Size / 1e9)
    $kind = & $exe inspect $raw --size $disk.Size
    if ($LASTEXITCODE -ne 0) { Stop-Install "Couldn't read disk $($disk.Number). Nothing was written." }

    $action = 'install'
    if ("$kind" -like 'bismillah *') {
      Say ''
      Say "Disk $($disk.Number) is a bismillah stick: $name ($shown)."
      Say "  1  Update it to $version. Your texts stay."
      Say '  2  Erase it and start again. Its texts are lost.'
      switch ((Read-Host '1 or 2?').Trim()) {
        '1' { $action = 'update' }
        '2' { }
        default { Stop-Install 'Nothing was written.' }
      }
    }
    Say ''
    if ($action -eq 'update') {
      Say "This rewrites the system on disk $($disk.Number): $name ($shown). The texts stay."
    } else {
      Say "This ERASES everything on disk $($disk.Number): $name ($shown), and puts bismillah on it."
    }
    $typed = Read-Host "Type the stick's name to confirm ($name)"
    if ($typed.Trim() -ne $name) { Stop-Install "That isn't the name. Nothing was written." }

    Say ''
    Add-VolumeLock
    $locks = @()
    try {
      $volumes = @(Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue |
          ForEach-Object { $_.AccessPaths } | Where-Object { $_ -like '\\?\Volume*' })
      foreach ($volume in $volumes) {
        try {
          $locks += [BismillahVolume]::LockAndDismount($volume)
        } catch {
          Stop-Install "Windows is still using the stick ($($_.Exception.Message)). Close what uses it and run the command again. Nothing was written."
        }
      }
      if ($action -eq 'update') {
        & $exe update $dir $raw --size $disk.Size --journal $state
        $ok = $LASTEXITCODE -eq 0
        $failed = 'The update didn''t finish. Run the command again to finish it; your texts are untouched.'
      } else {
        & $exe install $dir $raw --size $disk.Size | Out-Null
        $ok = $LASTEXITCODE -eq 0
        $failed = 'Writing failed, so bismillah isn''t on the stick. Run the command again.'
      }
    } finally {
      foreach ($lock in $locks) { $lock.Dispose() }
      Update-Disk -Number $disk.Number -ErrorAction SilentlyContinue
    }
    if (-not $ok) { Stop-Install $failed }

    # Keep this version's download for the next stick; older ones are no longer needed.
    Get-ChildItem -LiteralPath $cache -Directory | Where-Object { $_.FullName -ne $dir } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Say ''
    Say 'Done. Take the stick out and start your laptop from it: turn it on while tapping'
    Say 'its boot-menu key (F12 on a Dell; on others F9, F10, F11, F12 or Esc).'
  }

  try {
    Install-Bismillah
  } catch [System.OperationCanceledException] {
    Write-Host ''
    Write-Host $_.Exception.Message
  }
}
