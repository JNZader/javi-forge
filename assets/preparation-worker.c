/* Fixed Linux x86-64 data-only preparation worker. Build statically; never run
 * generated helpers. Operator approves the exact binary AND this source digest.
 * JSON checks are artifact validation, not helper behavior or domain-schema tests. */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define LIMIT 1048576
#define DIR_FLAGS (O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
#define FILE_FLAGS (O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC)
static const char *names[6] = {"app-request.json", "minimal.py", "test_minimal.py", "dispatch.py", "run_gateway.py", "preparation-result.json"};
static unsigned char *data[6];
static size_t sizes[6];
extern char **environ;

#define ALLOW(n) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_##n, 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
static int restrict_syscalls(void) {
    struct sock_filter rules[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        ALLOW(read), ALLOW(write), ALLOW(close), ALLOW(fstat), ALLOW(newfstatat),
        ALLOW(fsync), ALLOW(fchmod), ALLOW(mkdirat), ALLOW(unlinkat),
        ALLOW(brk), ALLOW(mmap), ALLOW(munmap), ALLOW(mprotect), ALLOW(futex),
        ALLOW(clock_gettime), ALLOW(alarm), ALLOW(rt_sigaction), ALLOW(rt_sigprocmask),
        ALLOW(rt_sigreturn), ALLOW(exit), ALLOW(exit_group), ALLOW(getpid),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_openat, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, DIR_FLAGS, 2, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, FILE_FLAGS, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
    };
    struct sock_fprog program = {(unsigned short)(sizeof(rules) / sizeof(rules[0])), rules};
    return prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program);
}
static int isolation_probes(int parent) {
    errno = 0;
    if (syscall(__NR_socket, AF_INET, SOCK_STREAM, 0) != -1 || errno != EPERM) return 0;
    errno = 0;
    if (openat(parent, "credential-probe", O_RDONLY) != -1 || errno != EPERM) return 0;
    errno = 0;
    if (syscall(__NR_clone, 0, 0, 0, 0, 0) != -1 || errno != EPERM) return 0;
    errno = 0;
    if (syscall(__NR_execve, "/worker", 0, 0) != -1 || errno != EPERM) return 0;
    return 1;
}

struct json { const unsigned char *p, *end; };
static void ws(struct json *j) { while (j->p < j->end && (*j->p == ' ' || *j->p == '\n' || *j->p == '\r' || *j->p == '\t')) j->p++; }
static int hex(unsigned char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
static int string(struct json *j) {
    if (j->p == j->end || *j->p++ != '"') return 0;
    while (j->p < j->end) {
        unsigned char c = *j->p++;
        if (c == '"') return 1;
        if (c < 32) return 0;
        if (c == '\\') {
            if (j->p == j->end) return 0;
            c = *j->p++;
            if (c == 'u') {
                for (int i = 0; i < 4; i++) if (j->p == j->end || !hex(*j->p++)) return 0;
            } else if (!strchr("\"\\/bfnrt", c)) return 0;
        } else if (c >= 128) {
            unsigned int value; int count;
            if (c >= 0xc2 && c <= 0xdf) { value = c & 31; count = 1; }
            else if (c >= 0xe0 && c <= 0xef) { value = c & 15; count = 2; }
            else if (c >= 0xf0 && c <= 0xf4) { value = c & 7; count = 3; }
            else return 0;
            int remaining = count;
            while (remaining--) { if (j->p == j->end || (*j->p & 0xc0) != 0x80) return 0; value = (value << 6) | (*j->p++ & 63); }
            if ((count == 2 && value < 0x800) || (count == 3 && value < 0x10000) || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return 0;
        }
    }
    return 0;
}
static int value(struct json *j, int depth) {
    ws(j); if (depth > 64 || j->p == j->end) return 0;
    unsigned char c = *j->p;
    if (c == '"') return string(j);
    if (c == '{' || c == '[') {
        unsigned char stop = c == '{' ? '}' : ']'; j->p++; ws(j);
        if (j->p < j->end && *j->p == stop) { j->p++; return 1; }
        for (;;) {
            if (c == '{') { if (!string(j)) return 0; ws(j); if (j->p == j->end || *j->p++ != ':') return 0; }
            if (!value(j, depth + 1)) return 0;
            ws(j); if (j->p == j->end) return 0;
            unsigned char next = *j->p++; if (next == stop) return 1;
            if (next != ',') return 0;
            ws(j);
        }
    }
    const char *literal = c == 't' ? "true" : c == 'f' ? "false" : c == 'n' ? "null" : NULL;
    if (literal) { size_t n = strlen(literal); if ((size_t)(j->end - j->p) < n || memcmp(j->p, literal, n)) return 0; j->p += n; return 1; }
    if (*j->p == '-') j->p++;
    if (j->p == j->end) return 0;
    if (*j->p == '0') j->p++;
    else { if (*j->p < '1' || *j->p > '9') return 0; do { j->p++; } while (j->p < j->end && *j->p >= '0' && *j->p <= '9'); }
    if (j->p < j->end && *j->p == '.') { j->p++; const unsigned char *start = j->p; while (j->p < j->end && *j->p >= '0' && *j->p <= '9') j->p++; if (j->p == start) return 0; }
    if (j->p < j->end && (*j->p == 'e' || *j->p == 'E')) { j->p++; if (j->p < j->end && (*j->p == '+' || *j->p == '-')) j->p++; const unsigned char *start = j->p; while (j->p < j->end && *j->p >= '0' && *j->p <= '9') j->p++; if (j->p == start) return 0; }
    return 1;
}
static int object(const unsigned char *bytes, size_t n) { struct json j = {bytes, bytes + n}; ws(&j); if (j.p == j.end || *j.p != '{' || !value(&j, 0)) return 0; ws(&j); return j.p == j.end; }
static int write_all(int fd, const unsigned char *bytes, size_t length) {
    while (length) { ssize_t n = write(fd, bytes, length); if (n <= 0) return 0; bytes += n; length -= (size_t)n; } return 1;
}

int main(int argc, char **argv) {
    (void)argv;
    alarm(30); umask(077); setvbuf(stdout, NULL, _IONBF, 0);
    if (argc != 1) return 11;
    if (environ && *environ && (environ[1] || strcmp(environ[0], "PWD=/"))) return 12;
    if (clearenv()) return 13;
    struct timespec started; if (clock_gettime(CLOCK_MONOTONIC, &started)) return 10;
    int parent = open("/out", DIR_FLAGS); struct stat parent_stat, existing;
    if (parent < 0 || fstat(parent, &parent_stat) || (parent_stat.st_mode & 0777) != 0700) return 10;
    if (fstatat(parent, "attempt-3", &existing, AT_SYMLINK_NOFOLLOW) == 0 || errno != ENOENT) return 10;
    unsigned long long dev, ino; FILE *identity = fopen("/identity", "r");
    if (!identity || fscanf(identity, "%llu %llu", &dev, &ino) != 2 || dev != (unsigned long long)parent_stat.st_dev || ino != (unsigned long long)parent_stat.st_ino) return 10;
    fclose(identity);
    size_t total = 0;
    for (int i = 0; i < 6; i++) {
        char filename[128]; snprintf(filename, sizeof(filename), "/payload/%s", names[i]);
        int fd = open(filename, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); struct stat st;
        if (fd < 0 || fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_size < 0 || st.st_size > LIMIT) return 10;
        sizes[i] = (size_t)st.st_size; total += sizes[i]; if (total > LIMIT) return 10;
        data[i] = malloc(sizes[i] + 1); if (!data[i]) return 10;
        size_t offset = 0;
        while (offset < sizes[i]) { ssize_t n = read(fd, data[i] + offset, sizes[i] - offset); if (n <= 0) return 10; offset += (size_t)n; }
        close(fd); data[i][sizes[i]] = 0;
    }
    if (restrict_syscalls() || !isolation_probes(parent)) return 10;
#ifdef PREPARATION_FIXTURE_NOT_READY
    for (;;) { /* Test-only readiness stall, never a production build. */ }
#endif
    puts("READY");
    char go; if (read(STDIN_FILENO, &go, 1) != 1 || go != 'G') return 10;
    alarm(10);
#ifdef PREPARATION_FIXTURE_STALL
    for (;;) { /* Test-only compiled variant, approved only by fixture keys. */ }
#endif
    if (!object(data[0], sizes[0]) || !object(data[5], sizes[5])) return 20;
    for (int i = 1; i < 5; i++) if (!sizes[i] || memchr(data[i], 0, sizes[i])) return 20;
    puts("VALID");
    struct timespec now; if (clock_gettime(CLOCK_MONOTONIC, &now)) return 20;
    long elapsed = now.tv_sec - started.tv_sec; if (elapsed >= 30) return 20;
    alarm((unsigned int)(30 - elapsed));
    if (mkdirat(parent, "attempt-3", 0700)) return 30;
    int dir = openat(parent, "attempt-3", DIR_FLAGS); struct stat directory_stat;
    if (dir < 0 || fstat(dir, &directory_stat)) return 30;
    printf("DIR %llu %llu\n", (unsigned long long)directory_stat.st_dev, (unsigned long long)directory_stat.st_ino);
    for (int i = 0; i < 6; i++) {
        int fd = openat(dir, names[i], FILE_FLAGS, 0600); struct stat st;
        if (fd < 0 || fstat(fd, &st)) return 30;
        printf("FILE %d %llu %llu\n", i, (unsigned long long)st.st_dev, (unsigned long long)st.st_ino);
        if (fchmod(fd, 0600) || !write_all(fd, data[i], sizes[i]) || fsync(fd)) return 30;
        close(fd);
#ifdef PREPARATION_FIXTURE_PARTIAL
        if (i == 0) return 30;
#endif
    }
    if (fsync(dir) || fsync(parent)) return 30;
    close(dir); close(parent); puts("DONE"); return 0;
}
