# Échantillonne la mémoire de processus nommés par leur PID (jamais par nom), toutes les ~50 ms : une ligne « tms;pid;privéOctets;workingSetOctets » par processus et par instant.
# Lecture par psapi.GetProcessMemoryInfo (droit PROCESS_QUERY_LIMITED_INFORMATION : seul droit qu'un processus Chrome sous bac à sable laisse lire) — PrivateUsage = la mémoire privée (commit) ;
# à la sortie, les PICS EXACTS tenus par le système, sans échantillonnage : « P;pid;pic du working set;pic de la mémoire privée (PeakPagefileUsage) ».
# Lancé par pilote-memoire.js ; s'arrête quand le fichier STOP existe ou après -Max secondes.
param([string]$Pids, [string]$Sortie, [string]$Stop, [int]$Max = 900)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MemPid {
    [StructLayout(LayoutKind.Sequential)] public struct PMC { public uint cb; public uint PageFaultCount; public UIntPtr PeakWorkingSetSize; public UIntPtr WorkingSetSize; public UIntPtr QuotaPeakPagedPoolUsage; public UIntPtr QuotaPagedPoolUsage; public UIntPtr QuotaPeakNonPagedPoolUsage; public UIntPtr QuotaNonPagedPoolUsage; public UIntPtr PagefileUsage; public UIntPtr PeakPagefileUsage; public UIntPtr PrivateUsage; }
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint acces, bool heritage, int pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("psapi.dll", SetLastError = true)] static extern bool GetProcessMemoryInfo(IntPtr h, out PMC c, uint cb);
    // rend { privé, pic privé, working set, pic working set } ou null
    public static ulong[] Lire(int pid) {
        IntPtr h = OpenProcess(0x1000, false, pid);
        if (h == IntPtr.Zero) return null;
        try { PMC c; c.cb = (uint)Marshal.SizeOf(typeof(PMC)); if (!GetProcessMemoryInfo(h, out c, c.cb)) return null;
              return new ulong[] { c.PrivateUsage.ToUInt64(), c.PeakPagefileUsage.ToUInt64(), c.WorkingSetSize.ToUInt64(), c.PeakWorkingSetSize.ToUInt64() }; }
        finally { CloseHandle(h); }
    }
}
'@
$liste = $Pids.Split(',') | ForEach-Object { [int]$_ }
$debut = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$w = New-Object System.IO.StreamWriter($Sortie, $false)
while (([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $debut) -lt ($Max * 1000) -and -not (Test-Path $Stop)) {
    $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    foreach ($p in $liste) { $x = [MemPid]::Lire($p); if ($x) { $w.WriteLine("$t;$p;$($x[0]);$($x[2])") } }
    $w.Flush()
    Start-Sleep -Milliseconds 40
}
foreach ($p in $liste) { $x = [MemPid]::Lire($p); if ($x) { $w.WriteLine("P;$p;$($x[3]);$($x[1])") } }
$w.Close()
