# javi-forge Windows secure-object helper (SkillGuard Slice 3b, Phase 3).
#
# This is the ONLY place a Windows security decision is made. It is a long-lived,
# framed-stdin session process spawned by src/lib/secure-fs-windows.ts
# (createPs1Session) after a sha256 digest match against manifest.json. It owns
# the real OS handles (a handleId -> SafeHandle table for the parent-chain lock)
# and computes Predicate A (lenient runtime gate) / Predicate B (strict creation)
# / proveManagedContainer (CREATE_PARENT_DIR) verdicts on FRESH no-follow kernel
# handles per call.
#
# CANNOT be run or validated on the Linux dev box. Correctness rests on:
#   (a) faithful adherence to design.md (Decisions 1/1a/1b/2/3, Predicate A/B),
#   (b) EXACT protocol match with secure-fs-windows.ts (HelperOp/HelperRequest/
#       HelperResponse shapes; the framed [uint32 BE length][UTF-8 JSON] wire),
#   (c) Windows PowerShell 5.1 syntax discipline + PURE ASCII.
# The Phase 5 windows-latest CI job is the ONLY validator (design Decision 3).
#
# Grounding-probe lessons applied (scripts/win-acl-probe.ps1 ran on windows-latest):
#   - Pure ASCII only: a stray em-dash broke PS 5.1 parsing. No non-ASCII bytes.
#   - Enum bit-tests via [int] casts: a bare enum -band threw InvalidCastException.
#     All flag/mask math below is done in C# on int/uint, cast explicitly.
#
# Protocol (secure-fs-windows.ts):
#   Wire unit  : [uint32 big-endian byteLength][UTF-8 JSON body], both directions.
#   Handshake  : first frame emitted = {"ready":true,"protocolVersion":1}.
#   Serial     : exactly one outstanding request; response before the next request.
#   Bounded    : reject any declared length > HELPER_FRAME_LIMIT (8 MiB).
#   stdout     : ONLY length-prefixed frames. All diagnostics go to stderr.
#   ops        : openDir revalidate proveOwner proveDacl proveContainer createDir
#                capture writeExcl applyMode rename unlink rmdir releaseHandle.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:FRAME_LIMIT = 8 * 1024 * 1024
$script:PROTOCOL_VERSION = 1

# --- native + predicate core (C#: int/uint mask math, no PS enum -band) -------

$csharp = @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace JaviForge
{
    public class OpResult
    {
        public bool Ok;
        public string Refusal;
        public string Detail;
        public int Status;      // win32 error code; drives the notFound mapping on openDir
        public string HandleId; // openDir / createDir
        public string Opaque;   // openDir / createDir / capture
        public int Attributes;  // openDir / createDir (dwFileAttributes)
        public string BytesB64; // capture

        public static OpResult Good() { OpResult r = new OpResult(); r.Ok = true; return r; }
        public static OpResult Fail(string refusal, string detail)
        {
            OpResult r = new OpResult();
            r.Ok = false; r.Refusal = refusal; r.Detail = detail; return r;
        }
        public static OpResult FailStatus(string refusal, string detail, int status)
        {
            OpResult r = Fail(refusal, detail); r.Status = status; return r;
        }
    }

    internal class Held
    {
        public IntPtr Handle;
        public string Path;
        public string Opaque;
    }

    public static class SecureObj
    {
        // --- refusal classes (must match SecureRefusal in secure-fs-transaction.ts) -
        private const string R_DACL = "unsafe-windows-dacl";
        private const string R_CHAIN = "unsafe-parent-chain";

        // --- access-right / attribute constants ---------------------------------
        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint READ_CONTROL = 0x00020000;
        private const uint WRITE_DAC_A = 0x00040000;
        private const uint WRITE_OWNER_A = 0x00080000;
        private const uint DELETE_A = 0x00010000;
        private const uint FILE_READ_ATTRIBUTES = 0x0080;

        private const uint FILE_SHARE_READ = 0x1;
        private const uint FILE_SHARE_WRITE = 0x2;
        private const uint FILE_SHARE_DELETE = 0x4;

        private const uint OPEN_EXISTING = 3;
        private const uint CREATE_NEW = 1;

        private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
        private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
        private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;

        private const uint FILE_ATTRIBUTE_DIRECTORY = 0x10;
        private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x400;

        private const int ERROR_FILE_NOT_FOUND = 2;
        private const int ERROR_PATH_NOT_FOUND = 3;
        private const int ERROR_FILE_EXISTS = 80;
        private const int ERROR_ALREADY_EXISTS = 183;
        private const int ERROR_DIR_NOT_EMPTY = 145;

        private const uint MOVEFILE_REPLACE_EXISTING = 0x1;
        private const uint MOVEFILE_WRITE_THROUGH = 0x8;

        // GetSecurityInfo / SetKernelObjectSecurity information classes
        private const uint OWNER_SECURITY_INFORMATION = 0x1;
        private const uint DACL_SECURITY_INFORMATION = 0x4;
        private const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;
        private const int SE_FILE_OBJECT = 1;

        // FILE_INFO_BY_HANDLE_CLASS.FileDispositionInfo
        private const int FileDispositionInfo = 4;

        // --- Predicate A / B / container path-endangering masks (design.md) ------
        //   FILE_WRITE_DATA / FILE_ADD_FILE          = 0x0002
        //   FILE_APPEND_DATA / FILE_ADD_SUBDIRECTORY = 0x0004
        //   FILE_DELETE_CHILD                        = 0x0040
        //   DELETE = 0x00010000  WRITE_DAC = 0x00040000  WRITE_OWNER = 0x00080000
        private const int ADD_FILE = 0x0002;
        private const int ADD_SUBDIR = 0x0004;
        private const int DELETE_CHILD = 0x0040;
        // File-object write bits (same numeric values as ADD_FILE/ADD_SUBDIR on a
        // container, but named for the file mask so PATH_ENDANGER_FILE is self-describing).
        private const int FILE_WRITE_DATA = 0x0002;
        private const int FILE_APPEND_DATA = 0x0004;
        private const int MASK_DELETE = 0x00010000;
        private const int MASK_WRITE_DAC = 0x00040000;
        private const int MASK_WRITE_OWNER = 0x00080000;
        private const int PATH_ENDANGER_COMMON = MASK_DELETE | MASK_WRITE_DAC | MASK_WRITE_OWNER;
        private const int PATH_ENDANGER_DIR = PATH_ENDANGER_COMMON | DELETE_CHILD;
        private const int PATH_ENDANGER_FILE = PATH_ENDANGER_COMMON | FILE_WRITE_DATA | FILE_APPEND_DATA;
        private const int CREATE_PARENT_DIR = PATH_ENDANGER_DIR | ADD_FILE | ADD_SUBDIR;

        private const int FILE_ALL_ACCESS = 0x001F01FF;

        // NT SERVICE\TrustedInstaller (trusted OWNER only; JDB-204 / F4a).
        private const string SID_TRUSTED_INSTALLER =
            "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";

        private static readonly object Gate = new object();
        private static readonly Dictionary<string, Held> Handles = new Dictionary<string, Held>();
        private static long HandleSeq = 0;

        // --- P/Invoke -----------------------------------------------------------
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess,
            uint dwShareMode, IntPtr lpSecurityAttributes, uint dwCreationDisposition,
            uint dwFlagsAndAttributes, IntPtr hTemplateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateDirectoryW(string lpPathName, IntPtr lpSecurityAttributes);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool MoveFileExW(string from, string to, uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool RemoveDirectoryW(string lpPathName);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr FindFirstFileW(string lpFileName,
            out WIN32_FIND_DATA lpFindFileData);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool FindNextFileW(IntPtr hFindFile,
            out WIN32_FIND_DATA lpFindFileData);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool FindClose(IntPtr hFindFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool FlushFileBuffers(IntPtr hFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandle(IntPtr hFile,
            out BY_HANDLE_FILE_INFORMATION lpFileInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetFileInformationByHandle(IntPtr hFile, int cls,
            ref FILE_DISPOSITION_INFO info, int dwBufferSize);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint GetSecurityInfo(IntPtr handle, int ObjectType,
            uint SecurityInfo, out IntPtr ppsidOwner, out IntPtr ppsidGroup,
            out IntPtr ppDacl, out IntPtr ppSacl, out IntPtr ppSecurityDescriptor);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool SetKernelObjectSecurity(IntPtr Handle,
            uint SecurityInformation, byte[] SecurityDescriptor);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint GetSecurityDescriptorLength(IntPtr pSecurityDescriptor);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern void MapGenericMask(ref uint AccessMask, ref GENERIC_MAPPING map);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr hMem);

        [StructLayout(LayoutKind.Sequential)]
        private struct FILETIME_S { public uint Low; public uint High; }

        [StructLayout(LayoutKind.Sequential)]
        private struct BY_HANDLE_FILE_INFORMATION
        {
            public uint dwFileAttributes;
            public FILETIME_S ftCreationTime;
            public FILETIME_S ftLastAccessTime;
            public FILETIME_S ftLastWriteTime;
            public uint dwVolumeSerialNumber;
            public uint nFileSizeHigh;
            public uint nFileSizeLow;
            public uint nNumberOfLinks;
            public uint nFileIndexHigh;
            public uint nFileIndexLow;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct GENERIC_MAPPING
        {
            public uint GenericRead;
            public uint GenericWrite;
            public uint GenericExecute;
            public uint GenericAll;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_ATTRIBUTES
        {
            public int nLength;
            public IntPtr lpSecurityDescriptor;
            public int bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct FILE_DISPOSITION_INFO { public int DeleteFile; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WIN32_FIND_DATA
        {
            public uint dwFileAttributes;
            public FILETIME_S ftCreationTime;
            public FILETIME_S ftLastAccessTime;
            public FILETIME_S ftLastWriteTime;
            public uint nFileSizeHigh;
            public uint nFileSizeLow;
            public uint dwReserved0;
            public uint dwReserved1;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string cFileName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
            public string cAlternateFileName;
        }

        private static GENERIC_MAPPING FileMapping()
        {
            // Standard file object generic mapping (used by MapGenericMask).
            GENERIC_MAPPING m = new GENERIC_MAPPING();
            m.GenericRead = 0x00120089;   // FILE_GENERIC_READ
            m.GenericWrite = 0x00120116;  // FILE_GENERIC_WRITE
            m.GenericExecute = 0x001200A0;// FILE_GENERIC_EXECUTE
            m.GenericAll = 0x001F01FF;    // FILE_ALL_ACCESS
            return m;
        }

        private static readonly IntPtr INVALID_HANDLE = new IntPtr(-1);

        // --- trusted-principal sets (Predicate A rule 1 / rule 2) ---------------
        private static string CurrentUserSid()
        {
            WindowsIdentity id = WindowsIdentity.GetCurrent();
            return id.User.Value;
        }

        private static string SystemSid()
        {
            return new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null).Value;
        }

        private static string AdminsSid()
        {
            return new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null).Value;
        }

        // CREATOR OWNER (S-1-3-0) is treated as owner-equivalent by design: this is
        // the ratified round-4 JDB-202 handling, NOT an accidental widening.
        // Materialized non-inherit-only CREATOR OWNER ACEs are not normally
        // attacker-grantable, and inherit-only ones are already skipped (rule 4).
        private static string CreatorOwnerSid()
        {
            return new SecurityIdentifier(WellKnownSidType.CreatorOwnerSid, null).Value;
        }

        // Owner is trusted (rule 1): current-user, SYSTEM, Administrators,
        // TrustedInstaller (owner-only), or a materialized CREATOR OWNER
        // (owner-equivalent).
        private static bool OwnerTrusted(string sid)
        {
            if (sid == null) return false;
            return sid == CurrentUserSid() || sid == SystemSid() || sid == AdminsSid()
                || sid == SID_TRUSTED_INSTALLER || sid == CreatorOwnerSid();
        }

        // A trustee is foreign (rule 2) unless it is current-user, SYSTEM,
        // Administrators, or a materialized CREATOR OWNER (owner-equivalent).
        // TrustedInstaller is NOT in the trustee allowlist (owner-only).
        private static bool IsForeignTrustee(string sid)
        {
            if (sid == null) return true;
            if (sid == CurrentUserSid() || sid == SystemSid() || sid == AdminsSid()
                || sid == CreatorOwnerSid()) return false;
            return true;
        }

        // --- opaque identity ----------------------------------------------------
        // "<volumeSerialHex>:<fileIdHex>", lowercase; zero FileId is rejected by
        // validOpaque in secure-fs-windows.ts, and refused here at capture too (C4).
        private static string BuildOpaque(BY_HANDLE_FILE_INFORMATION info, out bool zero)
        {
            ulong fileId = ((ulong)info.nFileIndexHigh << 32) | (ulong)info.nFileIndexLow;
            zero = (fileId == 0);
            return info.dwVolumeSerialNumber.ToString("x") + ":" + fileId.ToString("x");
        }

        // --- Predicate B: self-relative, protected, owner-only allowlist DACL ---
        private static byte[] BuildProtectedSd()
        {
            SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
            SecurityIdentifier system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
            SecurityIdentifier admins = new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null);
            RawAcl dacl = new RawAcl(GenericAcl.AclRevision, 3);
            dacl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed,
                FILE_ALL_ACCESS, user, false, null));
            dacl.InsertAce(1, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed,
                FILE_ALL_ACCESS, system, false, null));
            dacl.InsertAce(2, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed,
                FILE_ALL_ACCESS, admins, false, null));
            RawSecurityDescriptor sd = new RawSecurityDescriptor(
                ControlFlags.DiscretionaryAclPresent
                | ControlFlags.DiscretionaryAclProtected
                | ControlFlags.SelfRelative,
                user, null, null, dacl);
            byte[] bin = new byte[sd.BinaryLength];
            sd.GetBinaryForm(bin, 0);
            return bin;
        }

        // Open a path no-follow on a FRESH handle. INVALID_HANDLE on failure with
        // the win32 error in `err`. Caller MUST CloseHandle on success.
        private static IntPtr OpenNoFollow(string path, uint access, uint share, out int err)
        {
            uint flags = FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS;
            IntPtr h = CreateFileW(path, access, share, IntPtr.Zero, OPEN_EXISTING, flags, IntPtr.Zero);
            err = Marshal.GetLastWin32Error();
            return h;
        }

        // Read attributes + opaque from an open handle.
        private static bool ReadInfo(IntPtr h, out uint attributes, out string opaque, out bool zeroId)
        {
            attributes = 0; opaque = null; zeroId = true;
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(h, out info)) return false;
            attributes = info.dwFileAttributes;
            opaque = BuildOpaque(info, out zeroId);
            return true;
        }

        // Read owner + DACL from an open handle into managed form.
        // Returns false and sets refusal on any failure.
        private static bool ReadSd(IntPtr h, out SecurityIdentifier owner,
            out RawAcl dacl, out bool nullDacl, out string failDetail)
        {
            owner = null; dacl = null; nullDacl = false; failDetail = null;
            IntPtr pOwner, pGroup, pDacl, pSacl, pSd;
            uint rc = GetSecurityInfo(h, SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                out pOwner, out pGroup, out pDacl, out pSacl, out pSd);
            if (rc != 0) { failDetail = "GetSecurityInfo " + rc; return false; }
            try
            {
                int len = (int)GetSecurityDescriptorLength(pSd);
                byte[] raw = new byte[len];
                Marshal.Copy(pSd, raw, 0, len);
                RawSecurityDescriptor rsd = new RawSecurityDescriptor(raw, 0);
                owner = rsd.Owner;
                dacl = rsd.DiscretionaryAcl;
                nullDacl = (dacl == null); // NULL DACL grants everyone -> refuse
                return true;
            }
            finally { LocalFree(pSd); }
        }

        // Evaluate a DACL against a refuse mask (Predicate A rules 2-6).
        // objectEndanger = PATH_ENDANGER_DIR or PATH_ENDANGER_FILE, used to label
        // a hit as "path-endangering" vs "add-child" (container add-child bits).
        private static string EvaluateDacl(RawAcl dacl, bool nullDacl, int refuseMask, int objectEndanger)
        {
            if (nullDacl) return "null DACL";
            if (dacl == null) return "null DACL";
            GENERIC_MAPPING map = FileMapping();
            for (int i = 0; i < dacl.Count; i++)
            {
                QualifiedAce qa = dacl[i] as QualifiedAce;
                if (qa == null) return "unrecognized ACE";
                if (qa.AceQualifier != AceQualifier.AccessAllowed) continue; // deny does not grant
                if (((int)qa.AceFlags & (int)AceFlags.InheritOnly) != 0) continue; // IO template (rule 4)
                string sid = qa.SecurityIdentifier.Value;
                if (!IsForeignTrustee(sid)) continue;
                uint m = (uint)qa.AccessMask;
                MapGenericMask(ref m, ref map); // expand generic bits BEFORE masking (rule 3)
                int expanded = (int)m;
                int hit = expanded & refuseMask;
                if (hit != 0)
                {
                    string kind = ((hit & objectEndanger) != 0) ? "path-endangering" : "add-child";
                    return "foreign trustee " + sid + " " + kind;
                }
            }
            return null; // clean
        }

        private static string ChildPath(string dir, string name)
        {
            return Path.Combine(dir, name);
        }

        // True if `path` contains no entries other than "." / "..". enumOk is false
        // when enumeration itself could not be performed (treated as fail-closed by
        // callers). Identity is pinned by a held handle across the call site.
        private static bool DirIsEmpty(string path, out bool enumOk)
        {
            enumOk = false;
            WIN32_FIND_DATA fd;
            IntPtr hf = FindFirstFileW(Path.Combine(path, "*"), out fd);
            if (hf == INVALID_HANDLE) return false;
            try
            {
                enumOk = true;
                do
                {
                    string n = fd.cFileName;
                    if (n == "." || n == "..") continue;
                    return false; // a real child -> not empty
                } while (FindNextFileW(hf, out fd));
                return true;
            }
            finally { FindClose(hf); }
        }

        private static Held Lookup(string handleId)
        {
            if (handleId == null) return null;
            Held held;
            lock (Gate) { if (!Handles.TryGetValue(handleId, out held)) return null; }
            return held;
        }

        // Register a fresh open directory handle in the retained table.
        private static string Register(IntPtr h, string path, string opaque)
        {
            lock (Gate)
            {
                HandleSeq++;
                string id = HandleSeq.ToString();
                Held held = new Held();
                held.Handle = h; held.Path = path; held.Opaque = opaque;
                Handles[id] = held;
                return id;
            }
        }

        // --- create-with-SD helpers (Predicate B, atomic at creation) -----------
        private static IntPtr CreateFileWithSd(string path, uint access, uint disp, uint flags, out int err)
        {
            byte[] sd = BuildProtectedSd();
            GCHandle gh = GCHandle.Alloc(sd, GCHandleType.Pinned);
            IntPtr pSa = IntPtr.Zero;
            try
            {
                SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
                sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
                sa.lpSecurityDescriptor = gh.AddrOfPinnedObject();
                sa.bInheritHandle = 0;
                pSa = Marshal.AllocHGlobal(sa.nLength);
                Marshal.StructureToPtr(sa, pSa, false);
                IntPtr h = CreateFileW(path, access, 0, pSa, disp, flags, IntPtr.Zero);
                err = Marshal.GetLastWin32Error();
                return h;
            }
            finally
            {
                if (pSa != IntPtr.Zero) Marshal.FreeHGlobal(pSa);
                gh.Free();
            }
        }

        private static bool CreateDirWithSd(string path, out int err)
        {
            byte[] sd = BuildProtectedSd();
            GCHandle gh = GCHandle.Alloc(sd, GCHandleType.Pinned);
            IntPtr pSa = IntPtr.Zero;
            try
            {
                SECURITY_ATTRIBUTES sa = new SECURITY_ATTRIBUTES();
                sa.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
                sa.lpSecurityDescriptor = gh.AddrOfPinnedObject();
                sa.bInheritHandle = 0;
                pSa = Marshal.AllocHGlobal(sa.nLength);
                Marshal.StructureToPtr(sa, pSa, false);
                bool ok = CreateDirectoryW(path, pSa);
                err = Marshal.GetLastWin32Error();
                return ok;
            }
            finally
            {
                if (pSa != IntPtr.Zero) Marshal.FreeHGlobal(pSa);
                gh.Free();
            }
        }

        // ====================================================================
        // OPS (one method per HelperOp; every path re-opens FRESH no-follow)
        // ====================================================================

        // openDir: retained parent-chain handle. Maps ONLY ERROR_FILE_NOT_FOUND /
        // ERROR_PATH_NOT_FOUND to a notFound status; a junction OPENS (no-follow)
        // and is refused by the reparse-attribute check with NO status (JDA6-001).
        public static OpResult OpenDir(string path)
        {
            try
            {
                if (String.IsNullOrEmpty(path)) return OpResult.Fail(R_CHAIN, "openDir: empty path");
                int err;
                // Retained lock handle: share read+write but NOT delete.
                IntPtr h = OpenNoFollow(path, READ_CONTROL | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE, out err);
                if (h == INVALID_HANDLE)
                {
                    if (err == ERROR_FILE_NOT_FOUND || err == ERROR_PATH_NOT_FOUND)
                        return OpResult.FailStatus(R_CHAIN, "openDir not found " + path, err);
                    return OpResult.Fail(R_CHAIN, "openDir failed " + err + " " + path);
                }
                bool keep = false;
                try
                {
                    uint attr; string opaque; bool zeroId;
                    if (!ReadInfo(h, out attr, out opaque, out zeroId))
                        return OpResult.Fail(R_CHAIN, "openDir info failed " + path);
                    if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, "openDir reparse point " + path);
                    if ((attr & FILE_ATTRIBUTE_DIRECTORY) == 0)
                        return OpResult.Fail(R_CHAIN, "openDir not a directory " + path); // notFound=false
                    if (zeroId)
                        return OpResult.Fail(R_CHAIN, "openDir unresolvable identity " + path);
                    string id = Register(h, path, opaque);
                    keep = true;
                    OpResult r = OpResult.Good();
                    r.HandleId = id; r.Opaque = opaque; r.Attributes = (int)attr;
                    return r;
                }
                finally { if (!keep) CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_CHAIN, "openDir exception " + ex.Message); }
        }

        // revalidate: fresh no-follow re-open; refuse reparse; compare fresh opaque
        // against the held token (C2 / REPARSE-4). Never answers from a stale handle.
        public static OpResult Revalidate(string path, string heldOpaque)
        {
            try
            {
                if (String.IsNullOrEmpty(heldOpaque))
                    return OpResult.Fail(R_CHAIN, "revalidate unresolvable identity " + path);
                int err;
                IntPtr h = OpenNoFollow(path, READ_CONTROL | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, out err);
                if (h == INVALID_HANDLE)
                    return OpResult.Fail(R_CHAIN, "revalidate open failed " + err + " " + path);
                try
                {
                    uint attr; string opaque; bool zeroId;
                    if (!ReadInfo(h, out attr, out opaque, out zeroId))
                        return OpResult.Fail(R_CHAIN, "revalidate info failed " + path);
                    if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, "revalidate reparse point " + path);
                    if (zeroId)
                        return OpResult.Fail(R_CHAIN, "revalidate unresolvable identity " + path);
                    if (!String.Equals(opaque, heldOpaque, StringComparison.OrdinalIgnoreCase))
                        return OpResult.Fail(R_CHAIN, "revalidate identity changed " + path);
                    return OpResult.Good();
                }
                finally { CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_CHAIN, "revalidate exception " + ex.Message); }
        }

        // proveOwner: Predicate A rule 1 on a fresh no-follow handle.
        public static OpResult ProveOwner(string path)
        {
            try
            {
                int err;
                IntPtr h = OpenNoFollow(path, READ_CONTROL | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, out err);
                if (h == INVALID_HANDLE)
                    return OpResult.Fail(R_DACL, "proveOwner open failed " + err + " " + path);
                try
                {
                    uint attr; string opaque; bool zeroId;
                    if (!ReadInfo(h, out attr, out opaque, out zeroId))
                        return OpResult.Fail(R_DACL, "proveOwner info failed " + path);
                    if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, "proveOwner reparse point " + path);
                    SecurityIdentifier owner; RawAcl dacl; bool nullDacl; string sdErr;
                    if (!ReadSd(h, out owner, out dacl, out nullDacl, out sdErr))
                        return OpResult.Fail(R_DACL, "proveOwner " + sdErr + " " + path);
                    string osid = (owner == null) ? null : owner.Value;
                    if (!OwnerTrusted(osid))
                        return OpResult.Fail(R_DACL, "foreign owner " + osid);
                    return OpResult.Good();
                }
                finally { CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_DACL, "proveOwner exception " + ex.Message); }
        }

        // proveDacl: Predicate A rules 2-6, object-type-aware mask, fresh handle.
        public static OpResult ProveDacl(string path)
        {
            return ProveDaclInternal(path, false);
        }

        // proveContainer: proveManagedContainer -> owner trusted AND CREATE_PARENT_DIR
        // add-child refusal (JDB-201/F1 + JDA-401). Containers are directories.
        public static OpResult ProveContainer(string path)
        {
            return ProveDaclInternal(path, true);
        }

        private static OpResult ProveDaclInternal(string path, bool container)
        {
            // Disambiguate the audit trail: a container refusal must not be mislabeled
            // "proveDacl" (mirror this tag in every detail string below).
            string tag = container ? "proveContainer" : "proveDacl";
            try
            {
                int err;
                IntPtr h = OpenNoFollow(path, READ_CONTROL | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, out err);
                if (h == INVALID_HANDLE)
                    return OpResult.Fail(R_DACL, tag + " open failed " + err + " " + path);
                try
                {
                    uint attr; string opaque; bool zeroId;
                    if (!ReadInfo(h, out attr, out opaque, out zeroId))
                        return OpResult.Fail(R_DACL, tag + " info failed " + path);
                    if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, tag + " reparse point " + path);
                    bool isDir = (attr & FILE_ATTRIBUTE_DIRECTORY) != 0;
                    SecurityIdentifier owner; RawAcl dacl; bool nullDacl; string sdErr;
                    if (!ReadSd(h, out owner, out dacl, out nullDacl, out sdErr))
                        return OpResult.Fail(R_DACL, tag + " " + sdErr + " " + path);
                    if (container)
                    {
                        string osid = (owner == null) ? null : owner.Value;
                        if (!OwnerTrusted(osid))
                            return OpResult.Fail(R_DACL, "foreign owner " + osid);
                    }
                    int objectEndanger = isDir ? PATH_ENDANGER_DIR : PATH_ENDANGER_FILE;
                    int refuseMask = container ? CREATE_PARENT_DIR : objectEndanger;
                    string detail = EvaluateDacl(dacl, nullDacl, refuseMask, objectEndanger);
                    if (detail != null) return OpResult.Fail(R_DACL, detail);
                    return OpResult.Good();
                }
                finally { CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_DACL, tag + " exception " + ex.Message); }
        }

        // createDir: CREATE_NEW (exclusive) directory relative to the parent's
        // locked path, born with the Predicate B protected owner-only DACL, then
        // re-opened no-follow and retained (defense in depth re-proves TS-side).
        public static OpResult CreateDir(string parentHandleId, string name)
        {
            try
            {
                Held parent = Lookup(parentHandleId);
                if (parent == null) return OpResult.Fail(R_CHAIN, "createDir unknown parent handle");
                if (String.IsNullOrEmpty(name)) return OpResult.Fail(R_CHAIN, "createDir empty name");
                string full = ChildPath(parent.Path, name);
                int err;
                if (!CreateDirWithSd(full, out err))
                {
                    if (err == ERROR_ALREADY_EXISTS || err == ERROR_FILE_EXISTS)
                        return OpResult.Fail(R_CHAIN, "createDir exists " + full); // O_EXCL analog
                    return OpResult.Fail(R_CHAIN, "createDir failed " + err + " " + full);
                }
                IntPtr h = OpenNoFollow(full, READ_CONTROL | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE, out err);
                if (h == INVALID_HANDLE)
                    return OpResult.Fail(R_CHAIN, "createDir reopen failed " + err + " " + full);
                bool keep = false;
                try
                {
                    uint attr; string opaque; bool zeroId;
                    if (!ReadInfo(h, out attr, out opaque, out zeroId))
                        return OpResult.Fail(R_CHAIN, "createDir info failed " + full);
                    if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, "createDir reparse point " + full);
                    if ((attr & FILE_ATTRIBUTE_DIRECTORY) == 0)
                        return OpResult.Fail(R_CHAIN, "createDir not a directory " + full);
                    if (zeroId)
                        return OpResult.Fail(R_CHAIN, "createDir unresolvable identity " + full);
                    string id = Register(h, full, opaque);
                    keep = true;
                    OpResult r = OpResult.Good();
                    r.HandleId = id; r.Opaque = opaque; r.Attributes = (int)attr;
                    return r;
                }
                finally { if (!keep) CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_CHAIN, "createDir exception " + ex.Message); }
        }

        // capture: S_ISREG-equivalent regular-file assert on a fresh no-follow
        // handle; returns base64 bytes + opaque. Never dereferences a reparse point.
        public static OpResult Capture(string path)
        {
            try
            {
                int err;
                IntPtr h = OpenNoFollow(path, GENERIC_READ | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, out err);
                if (h == INVALID_HANDLE)
                    return OpResult.Fail(R_CHAIN, "capture open failed " + err + " " + path);
                try
                {
                    uint attr; string opaque; bool zeroId;
                    if (!ReadInfo(h, out attr, out opaque, out zeroId))
                        return OpResult.Fail(R_CHAIN, "capture info failed " + path);
                    if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, "capture reparse point " + path);
                    if ((attr & FILE_ATTRIBUTE_DIRECTORY) != 0)
                        return OpResult.Fail(R_CHAIN, "capture not a regular file " + path);
                    if (zeroId)
                        return OpResult.Fail(R_CHAIN, "capture unresolvable identity " + path);
                    byte[] bytes;
                    using (SafeFileHandle sfh = new SafeFileHandle(h, false))
                    using (FileStream fs = new FileStream(sfh, FileAccess.Read))
                    using (MemoryStream ms = new MemoryStream())
                    {
                        fs.CopyTo(ms);
                        bytes = ms.ToArray();
                    }
                    OpResult r = OpResult.Good();
                    r.BytesB64 = Convert.ToBase64String(bytes);
                    r.Opaque = opaque;
                    return r;
                }
                finally { CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_CHAIN, "capture exception " + ex.Message); }
        }

        // writeExcl: CREATE_NEW file relative to the locked dir path, born with the
        // Predicate B protected owner-only DACL; O_EXCL refusal on a pre-existing
        // target; flush before close.
        public static OpResult WriteExcl(string dirHandleId, string name, string bytesB64)
        {
            try
            {
                Held dir = Lookup(dirHandleId);
                if (dir == null) return OpResult.Fail(R_CHAIN, "writeExcl unknown dir handle");
                if (String.IsNullOrEmpty(name)) return OpResult.Fail(R_CHAIN, "writeExcl empty name");
                byte[] bytes;
                try { bytes = Convert.FromBase64String(bytesB64 == null ? "" : bytesB64); }
                catch { return OpResult.Fail(R_CHAIN, "writeExcl bad base64"); }
                string full = ChildPath(dir.Path, name);
                int err;
                IntPtr h = CreateFileWithSd(full, GENERIC_WRITE, CREATE_NEW,
                    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, out err);
                if (h == INVALID_HANDLE)
                {
                    if (err == ERROR_FILE_EXISTS || err == ERROR_ALREADY_EXISTS)
                        return OpResult.Fail(R_CHAIN, "writeExcl exists " + full); // O_EXCL analog
                    return OpResult.Fail(R_CHAIN, "writeExcl failed " + err + " " + full);
                }
                try
                {
                    using (SafeFileHandle sfh = new SafeFileHandle(h, false))
                    using (FileStream fs = new FileStream(sfh, FileAccess.Write))
                    {
                        fs.Write(bytes, 0, bytes.Length);
                        fs.Flush();
                    }
                    FlushFileBuffers(h);
                    return OpResult.Good();
                }
                finally { CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_CHAIN, "writeExcl exception " + ex.Message); }
        }

        // applyMode: NOT a numeric mode. Re-open no-follow, re-assert the Predicate B
        // protected owner-only DACL (idempotent, repairs drift), then re-prove
        // Predicate A on a fresh handle (Decision 1a).
        public static OpResult ApplyMode(string path)
        {
            try
            {
                int err;
                IntPtr h = OpenNoFollow(path,
                    WRITE_DAC_A | WRITE_OWNER_A | READ_CONTROL | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE, out err);
                if (h == INVALID_HANDLE)
                    return OpResult.Fail(R_CHAIN, "applyMode open failed " + err + " " + path);
                try
                {
                    uint attr; string opaque; bool zeroId;
                    if (!ReadInfo(h, out attr, out opaque, out zeroId))
                        return OpResult.Fail(R_CHAIN, "applyMode info failed " + path);
                    if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, "applyMode reparse point " + path);
                    byte[] sd = BuildProtectedSd();
                    if (!SetKernelObjectSecurity(h,
                        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION
                        | PROTECTED_DACL_SECURITY_INFORMATION, sd))
                        return OpResult.Fail(R_DACL, "applyMode set security " + Marshal.GetLastWin32Error());
                }
                finally { CloseHandle(h); }
                // Re-prove Predicate A on a FRESH handle (file object).
                return ProveDacl(path);
            }
            catch (Exception ex) { return OpResult.Fail(R_DACL, "applyMode exception " + ex.Message); }
        }

        // rename: MoveFileEx REPLACE_EXISTING | WRITE_THROUGH within the locked dir,
        // then FlushFileBuffers on the retained dir handle (durable-commit).
        public static OpResult Rename(string dirHandleId, string from, string to)
        {
            try
            {
                Held dir = Lookup(dirHandleId);
                if (dir == null) return OpResult.Fail(R_CHAIN, "rename unknown dir handle");
                if (String.IsNullOrEmpty(from) || String.IsNullOrEmpty(to))
                    return OpResult.Fail(R_CHAIN, "rename empty name");
                string fromFull = ChildPath(dir.Path, from);
                string toFull = ChildPath(dir.Path, to);
                // No opaque re-check here (unlike unlink/rmdir): both endpoints are our
                // own just-created nodes under the held parent-chain lock, so no on-path
                // node can be swapped while the chain handle is held.
                if (!MoveFileExW(fromFull, toFull,
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
                    return OpResult.Fail(R_CHAIN, "rename failed " + Marshal.GetLastWin32Error()
                        + " " + fromFull);
                FlushFileBuffers(dir.Handle);
                return OpResult.Good();
            }
            catch (Exception ex) { return OpResult.Fail(R_CHAIN, "rename exception " + ex.Message); }
        }

        // unlink: open the child no-follow relative to the locked dir path, verify
        // full-precision identity against the held opaque (C4), then delete via
        // FileDispositionInfo. Zero/absent/changed identity refuses.
        public static OpResult Unlink(string dirHandleId, string name, string heldOpaque)
        {
            try
            {
                Held dir = Lookup(dirHandleId);
                if (dir == null) return OpResult.Fail(R_CHAIN, "unlink unknown dir handle");
                if (String.IsNullOrEmpty(name)) return OpResult.Fail(R_CHAIN, "unlink empty name");
                if (String.IsNullOrEmpty(heldOpaque))
                    return OpResult.Fail(R_CHAIN, "unlink unresolvable identity " + name);
                string full = ChildPath(dir.Path, name);
                int err;
                IntPtr h = OpenNoFollow(full, DELETE_A | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, out err);
                if (h == INVALID_HANDLE)
                    return OpResult.Fail(R_CHAIN, "unlink open failed " + err + " " + full);
                try
                {
                    uint attr; string opaque; bool zeroId;
                    if (!ReadInfo(h, out attr, out opaque, out zeroId))
                        return OpResult.Fail(R_CHAIN, "unlink info failed " + full);
                    if ((attr & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, "unlink reparse point " + full);
                    if (zeroId)
                        return OpResult.Fail(R_CHAIN, "unlink unresolvable identity " + full);
                    if (!String.Equals(opaque, heldOpaque, StringComparison.OrdinalIgnoreCase))
                        return OpResult.Fail(R_CHAIN, "unlink identity changed " + full);
                    FILE_DISPOSITION_INFO info = new FILE_DISPOSITION_INFO();
                    info.DeleteFile = 1;
                    if (!SetFileInformationByHandle(h, FileDispositionInfo, ref info,
                        Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO))))
                        return OpResult.Fail(R_CHAIN, "unlink delete failed " + Marshal.GetLastWin32Error());
                    return OpResult.Good();
                }
                finally { CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_CHAIN, "unlink exception " + ex.Message); }
        }

        // rmdir: delete a tx-created empty directory (Phase-5 CI-validated: rmdir of a
        // tx-created empty dir succeeds; rmdir of a non-empty or identity-drifted dir
        // refuses).
        //
        // WHY the release/reopen dance (do NOT collapse it to RemoveDirectoryW on the
        // retained handle): the retained lock handle (dir.Handle, opened in OpenDir /
        // CreateDir) was opened with FILE_SHARE_READ|FILE_SHARE_WRITE and NO
        // FILE_SHARE_DELETE. On Win32 a DELETE-access open -- which RemoveDirectory and
        // delete-on-close both perform internally -- requires EVERY existing handle to
        // the target to permit FILE_SHARE_DELETE. Our own retained no-share-delete
        // handle therefore blocks deletion of the very directory it protects, failing
        // with ERROR_SHARING_VIOLATION (32). So we MUST release the retained handle
        // before deleting. To keep that release->reopen window safe we bracket it with
        // a double opaque re-check: verify+capture identity on the retained handle,
        // release it, re-open no-follow for DELETE with FILE_SHARE_DELETE, then
        // re-verify the SAME opaque on the fresh handle (catches a swap in the tiny
        // gap). Deletion is delete-on-close on that fresh handle, so we never issue a
        // by-path RemoveDirectoryW (which would reintroduce a by-path TOCTOU).
        // Fail-closed: any drift / non-empty refuses and the dir is left
        // released-but-present, which is safe for a tx-created empty dir.
        public static OpResult Rmdir(string dirHandleId, string heldOpaque)
        {
            try
            {
                Held dir = Lookup(dirHandleId);
                if (dir == null) return OpResult.Fail(R_CHAIN, "rmdir unknown handle");
                if (String.IsNullOrEmpty(heldOpaque))
                    return OpResult.Fail(R_CHAIN, "rmdir unresolvable identity " + dir.Path);

                // 1) Verify identity + emptiness on the RETAINED handle; capture opaque.
                //    A kernel handle is bound to its file object, so its identity cannot
                //    drift; emptiness is enumerated by-path while the retained handle
                //    (no delete share) pins the directory against rename/delete.
                uint attr0; string opaque0; bool zeroId0;
                if (!ReadInfo(dir.Handle, out attr0, out opaque0, out zeroId0))
                    return OpResult.Fail(R_CHAIN, "rmdir info failed " + dir.Path);
                if ((attr0 & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                    return OpResult.Fail(R_CHAIN, "rmdir reparse point " + dir.Path);
                if (zeroId0)
                    return OpResult.Fail(R_CHAIN, "rmdir unresolvable identity " + dir.Path);
                if (!String.Equals(opaque0, heldOpaque, StringComparison.OrdinalIgnoreCase))
                    return OpResult.Fail(R_CHAIN, "rmdir identity changed " + dir.Path);
                bool enumOk0;
                if (!DirIsEmpty(dir.Path, out enumOk0))
                {
                    if (!enumOk0) return OpResult.Fail(R_CHAIN, "rmdir enumerate failed " + dir.Path);
                    return OpResult.Fail(R_CHAIN, "rmdir not empty " + dir.Path);
                }
                string captured = opaque0;

                // 2) Release the retained no-share-delete handle so it stops blocking
                //    the DELETE-access open below.
                CloseAndForget(dirHandleId);

                // 3) Re-open the path no-follow for DELETE, sharing delete this time.
                int err;
                IntPtr h = OpenNoFollow(dir.Path, DELETE_A | FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, out err);
                if (h == INVALID_HANDLE)
                    return OpResult.Fail(R_CHAIN, "rmdir delete-open failed " + err + " " + dir.Path);
                try
                {
                    // 4a) Re-verify identity on the fresh handle: refuse reparse / zero
                    //     id, and require the SAME opaque captured in step 1 (this closes
                    //     the tiny close->reopen swap window).
                    uint attr1; string opaque1; bool zeroId1;
                    if (!ReadInfo(h, out attr1, out opaque1, out zeroId1))
                        return OpResult.Fail(R_CHAIN, "rmdir info failed " + dir.Path);
                    if ((attr1 & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                        return OpResult.Fail(R_CHAIN, "rmdir reparse point " + dir.Path);
                    if (zeroId1)
                        return OpResult.Fail(R_CHAIN, "rmdir unresolvable identity " + dir.Path);
                    if (!String.Equals(opaque1, captured, StringComparison.OrdinalIgnoreCase))
                        return OpResult.Fail(R_CHAIN, "rmdir identity changed " + dir.Path);
                    // 4b) Re-verify emptiness now that we hold the fresh handle.
                    bool enumOk1;
                    if (!DirIsEmpty(dir.Path, out enumOk1))
                    {
                        if (!enumOk1) return OpResult.Fail(R_CHAIN, "rmdir enumerate failed " + dir.Path);
                        return OpResult.Fail(R_CHAIN, "rmdir not empty " + dir.Path);
                    }
                    // 5) Delete-on-close: FileDispositionInfo removes the directory when
                    //    this fresh handle closes. It also returns ERROR_DIR_NOT_EMPTY if
                    //    a child slipped in after 4b -> fail-closed, no by-path TOCTOU.
                    FILE_DISPOSITION_INFO info = new FILE_DISPOSITION_INFO();
                    info.DeleteFile = 1;
                    if (!SetFileInformationByHandle(h, FileDispositionInfo, ref info,
                        Marshal.SizeOf(typeof(FILE_DISPOSITION_INFO))))
                    {
                        int derr = Marshal.GetLastWin32Error();
                        if (derr == ERROR_DIR_NOT_EMPTY)
                            return OpResult.Fail(R_CHAIN, "rmdir not empty " + dir.Path);
                        return OpResult.Fail(R_CHAIN, "rmdir delete failed " + derr + " " + dir.Path);
                    }
                    return OpResult.Good();
                }
                finally { CloseHandle(h); }
            }
            catch (Exception ex) { return OpResult.Fail(R_CHAIN, "rmdir exception " + ex.Message); }
        }

        // releaseHandle: always succeeds (the adapter balances the session handle
        // count on ANY ok openDir/createDir, even a null/unknown id).
        public static OpResult ReleaseHandle(string handleId)
        {
            try { CloseAndForget(handleId); }
            catch { /* fail-open on release is safe: the process exit hook kills all */ }
            return OpResult.Good();
        }

        private static void CloseAndForget(string handleId)
        {
            if (handleId == null) return;
            Held held = null;
            lock (Gate)
            {
                if (Handles.TryGetValue(handleId, out held)) Handles.Remove(handleId);
            }
            if (held != null && held.Handle != IntPtr.Zero && held.Handle != INVALID_HANDLE)
                CloseHandle(held.Handle);
        }

        // Best-effort close of every retained handle at process shutdown.
        public static void CloseAll()
        {
            lock (Gate)
            {
                foreach (KeyValuePair<string, Held> kv in Handles)
                {
                    try
                    {
                        if (kv.Value.Handle != IntPtr.Zero && kv.Value.Handle != INVALID_HANDLE)
                            CloseHandle(kv.Value.Handle);
                    }
                    catch { }
                }
                Handles.Clear();
            }
        }
    }
}
'@

Add-Type -TypeDefinition $csharp -Language CSharp | Out-Null

# --- framed raw binary stdio (W2: only frames on stdout, diagnostics to stderr) -

$script:stdin = [Console]::OpenStandardInput()
$script:stdout = [Console]::OpenStandardOutput()

function Read-Exact([int]$count) {
    if ($count -eq 0) { return , (New-Object byte[] 0) }
    $buf = New-Object byte[] $count
    $off = 0
    while ($off -lt $count) {
        $r = $script:stdin.Read($buf, $off, $count - $off)
        if ($r -le 0) { return $null } # EOF -> parent closed stdin
        $off += $r
    }
    return , $buf
}

function Write-Frame($obj) {
    $json = ConvertTo-Json $obj -Compress -Depth 6
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $len = $bytes.Length
    $hdr = New-Object byte[] 4
    $hdr[0] = [byte](($len -shr 24) -band 0xFF)
    $hdr[1] = [byte](($len -shr 16) -band 0xFF)
    $hdr[2] = [byte](($len -shr 8) -band 0xFF)
    $hdr[3] = [byte]($len -band 0xFF)
    $script:stdout.Write($hdr, 0, 4)
    $script:stdout.Write($bytes, 0, $len)
    $script:stdout.Flush()
}

# --- response shaping (must match HelperResponse in secure-fs-windows.ts) ------

function Send-Void($r) {
    if ($r.Ok) { Write-Frame @{ ok = $true } ; return }
    $resp = @{ ok = $false }
    if ($r.Refusal) { $resp['refusal'] = $r.Refusal }
    if ($r.Detail) { $resp['detail'] = $r.Detail }
    Write-Frame $resp
}

function Send-Handle($r) {
    if ($r.Ok) {
        Write-Frame @{ ok = $true; value = @{ handleId = $r.HandleId; opaque = $r.Opaque; attributes = $r.Attributes } }
        return
    }
    $resp = @{ ok = $false }
    if ($r.Refusal) { $resp['refusal'] = $r.Refusal }
    if ($r.Detail) { $resp['detail'] = $r.Detail }
    if ($r.Status -gt 0) { $resp['status'] = $r.Status }
    Write-Frame $resp
}

function Send-Capture($r) {
    if ($r.Ok) {
        Write-Frame @{ ok = $true; value = @{ bytes = $r.BytesB64; opaque = $r.Opaque } }
        return
    }
    $resp = @{ ok = $false }
    if ($r.Refusal) { $resp['refusal'] = $r.Refusal }
    if ($r.Detail) { $resp['detail'] = $r.Detail }
    Write-Frame $resp
}

function Get-Arg($obj, [string]$name) {
    if ($null -eq $obj) { return $null }
    $p = $obj.PSObject.Properties[$name]
    if ($null -eq $p) { return $null }
    return $p.Value
}

function AsStr($v) {
    if ($null -eq $v) { return $null }
    return [string]$v
}

# --- session loop -------------------------------------------------------------

Write-Frame @{ ready = $true; protocolVersion = $script:PROTOCOL_VERSION }

try {
    while ($true) {
        $hdr = Read-Exact 4
        if ($null -eq $hdr) { break } # EOF -> clean shutdown
        $len = ([int]$hdr[0] -shl 24) -bor ([int]$hdr[1] -shl 16) -bor ([int]$hdr[2] -shl 8) -bor [int]$hdr[3]
        if ($len -lt 0 -or $len -gt $script:FRAME_LIMIT) {
            [Console]::Error.WriteLine("oversized request frame: $len")
            break
        }
        $body = Read-Exact $len
        if ($null -eq $body) { break }

        $req = $null
        try {
            $req = [Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
        }
        catch {
            Write-Frame @{ ok = $false; refusal = 'unsafe-parent-chain'; detail = 'malformed request frame' }
            continue
        }

        $op = AsStr (Get-Arg $req 'op')
        $a = Get-Arg $req 'args'

        try {
            switch ($op) {
                'openDir' {
                    Send-Handle ([JaviForge.SecureObj]::OpenDir((AsStr (Get-Arg $a 'path'))))
                }
                'revalidate' {
                    Send-Void ([JaviForge.SecureObj]::Revalidate((AsStr (Get-Arg $a 'path')), (AsStr (Get-Arg $a 'opaque'))))
                }
                'proveOwner' {
                    Send-Void ([JaviForge.SecureObj]::ProveOwner((AsStr (Get-Arg $a 'path'))))
                }
                'proveDacl' {
                    Send-Void ([JaviForge.SecureObj]::ProveDacl((AsStr (Get-Arg $a 'path'))))
                }
                'proveContainer' {
                    Send-Void ([JaviForge.SecureObj]::ProveContainer((AsStr (Get-Arg $a 'path'))))
                }
                'createDir' {
                    Send-Handle ([JaviForge.SecureObj]::CreateDir((AsStr (Get-Arg $a 'parentHandle')), (AsStr (Get-Arg $a 'name'))))
                }
                'capture' {
                    Send-Capture ([JaviForge.SecureObj]::Capture((AsStr (Get-Arg $a 'path'))))
                }
                'writeExcl' {
                    Send-Void ([JaviForge.SecureObj]::WriteExcl((AsStr (Get-Arg $a 'dirHandle')), (AsStr (Get-Arg $a 'name')), (AsStr (Get-Arg $a 'bytes'))))
                }
                'applyMode' {
                    Send-Void ([JaviForge.SecureObj]::ApplyMode((AsStr (Get-Arg $a 'path'))))
                }
                'rename' {
                    Send-Void ([JaviForge.SecureObj]::Rename((AsStr (Get-Arg $a 'dirHandle')), (AsStr (Get-Arg $a 'from')), (AsStr (Get-Arg $a 'to'))))
                }
                'unlink' {
                    Send-Void ([JaviForge.SecureObj]::Unlink((AsStr (Get-Arg $a 'dirHandle')), (AsStr (Get-Arg $a 'name')), (AsStr (Get-Arg $a 'opaque'))))
                }
                'rmdir' {
                    Send-Void ([JaviForge.SecureObj]::Rmdir((AsStr (Get-Arg $a 'handle')), (AsStr (Get-Arg $a 'opaque'))))
                }
                'releaseHandle' {
                    Send-Void ([JaviForge.SecureObj]::ReleaseHandle((AsStr (Get-Arg $a 'handle'))))
                }
                default {
                    Write-Frame @{ ok = $false; refusal = 'unsafe-parent-chain'; detail = "unknown op: $op" }
                }
            }
        }
        catch {
            [Console]::Error.WriteLine("op '$op' exception: $($_.Exception.Message)")
            Write-Frame @{ ok = $false; refusal = 'unsafe-parent-chain'; detail = "helper op exception" }
        }
    }
}
finally {
    try { [JaviForge.SecureObj]::CloseAll() } catch { }
}
