/* Reduced from Clean Your TV's native/prototype/relay.c
 * (github.com/Razdva122/clean-your-tv-lg-webos), MIT: see LICENSE.cytv.
 *
 * Grabs the Magic Remote ("LGE M-RCU - Builtin [0]") and writes every event on to its sibling
 * node ("[1]"), so webOS still gets them, except Home. Talks to helper.js over stdin/stdout:
 *   stdin:  any byte is a heartbeat, 'Q' quits.  No byte for 2 s: exit (never hold a grab alone).
 *   stdout: READY, HOME, LGHOME (Back held 1.2 s), OFF, ON, FAIL <why>, EXIT <code>.
 * Three short Home presses within 2 s switch it off (the remote is released and only read) and
 * on again. An input overflow while grabbed exits with 27; the controller then opens LG's home.
 * shortcut: the plain IR remote ("LGE RCU") is not watched, so its Home still opens LG's home;
 * add it as a read-only source (as Clean Your TV does) if someone uses that remote. */
#define _GNU_SOURCE
#include "filter.h"
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <sys/file.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define GRAB _IOW('E', 0x90, int)
#define BIT(ev, len) _IOC(_IOC_READ, 'E', 0x20 + (ev), len)
#define KEYSTATE(len) _IOC(_IOC_READ, 'E', 0x18, len)
#define NAME(len) _IOC(_IOC_READ, 'E', 0x06, len)

static volatile sig_atomic_t stop;
static int output_failed;

static void stopped(int n) { (void)n; stop = 1; }
static uint64_t ms(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (uint64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
/* A stalled controller must never hold the grab by blocking stdout. */
static int report(const char *format, ...) {
  char line[256];
  va_list args;
  va_start(args, format);
  int n = vsnprintf(line, sizeof line, format, args);
  va_end(args);
  if (output_failed || n < 0 || n >= (int)sizeof line || write(1, line, n) != n) output_failed = 1;
  return output_failed ? -1 : 0;
}
static int find_device(const char *wanted, int flags) {
  for (int i = 0; i < 32; i++) {
    char p[64], name[256] = {0};
    snprintf(p, sizeof p, "/dev/input/event%d", i);
    int fd = open(p, flags | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) continue;
    if (ioctl(fd, NAME(sizeof name), name) >= 0 && !strcmp(name, wanted)) return fd;
    close(fd);
  }
  return -1;
}
static int any_held(int fd) {
  unsigned char bits[256] = {0};
  if (ioctl(fd, KEYSTATE(sizeof bits), bits) < 0) return -1;
  for (int i = 0; i < 256; i++)
    if (bits[i]) return 1;
  return 0;
}
static int release_keys(int out) {
  unsigned char bits[256] = {0};
  if (ioctl(out, KEYSTATE(sizeof bits), bits) < 0) return -1;
  for (int k = 1; k < 2048; k++)
    if (bits[k / 8] & (1 << (k % 8))) {
      struct ev e[2] = {{0, 0, 1, k, 0}, {0, 0, 0, 0, 0}};
      if (write(out, e, sizeof e) != sizeof e) return -1;
    }
  return 0;
}
/* Re-emitting into [1] is only safe when it reports the same event types and axes as [0]. */
static int compatible(int in, int out) {
  unsigned char a[256], b[256];
  for (int type = 0; type < 4; type++) {
    memset(a, 0, sizeof a);
    memset(b, 0, sizeof b);
    if (ioctl(in, BIT(type, sizeof a), a) < 0 || ioctl(out, BIT(type, sizeof b), b) < 0 || memcmp(a, b, sizeof a))
      return 0;
  }
  for (int axis = 0; axis < 2; axis++) {
    int x[6], y[6];
    if (ioctl(in, _IOR('E', 0x40 + axis, int[6]), x) < 0 || ioctl(out, _IOR('E', 0x40 + axis, int[6]), y) < 0 ||
        memcmp(x + 1, y + 1, 5 * sizeof(int)))
      return 0;
  }
  return 1;
}

int main(void) {
  signal(SIGPIPE, SIG_IGN);
  signal(SIGTERM, stopped);
  signal(SIGINT, stopped);
  int flags = fcntl(1, F_GETFL);
  if (flags < 0 || fcntl(1, F_SETFL, flags | O_NONBLOCK) < 0) return 30;

  /* /tmp is closed to Developer Mode apps; the app's own folder is writable. */
  char lock_path[600] = {0};
  if (readlink("/proc/self/exe", lock_path, 500) < 0) return 18;
  strcpy(strrchr(lock_path, '/'), "/relay.lock");
  int lock = open(lock_path, O_RDWR | O_CREAT | O_CLOEXEC, 0666);
  fchmod(lock, 0666);   /* the app and a Developer Mode ssh session run as different users */
  if (lock < 0 || flock(lock, LOCK_EX | LOCK_NB) < 0) { report("FAIL running\n"); return 18; }
  int out = find_device("LGE M-RCU - Builtin [1]", O_RDWR);
  int in = find_device("LGE M-RCU - Builtin [0]", O_RDONLY);
  if (out < 0 || in < 0) { report("FAIL no-remote\n"); return 10; }
  if (!compatible(in, out)) { report("FAIL incompatible\n"); return 12; }

  /* Grab only once every key is up, and drop what webOS already received: never replay an old OK. */
  uint64_t start = ms();
  while (any_held(in) != 0 || any_held(out) != 0) {
    if (ms() - start > 3000 || stop) { report("FAIL held\n"); return 14; }
    usleep(50000);
  }
  struct ev drain[64];
  while (read(in, drain, sizeof drain) > 0) {}
  if (ioctl(in, GRAB, 1) < 0) { report("FAIL grab\n"); return 17; }
  report("READY\n");

  struct filter f = {0};
  int grabbed = 1;
  struct pollfd p[2] = {{in, POLLIN, 0}, {0, POLLIN, 0}};
  uint64_t last = ms();
  int reason = 0;
  while (!stop && !output_failed) {
    uint64_t now = ms();
    if (now - last > 2000) { reason = 20; break; }
    if (grabbed && filter_timeout(&f, now) == OPEN_LG && report("LGHOME\n") < 0) break;
    int r = poll(p, 2, 50);
    if (r < 0) { if (errno == EINTR) continue; reason = 23; break; }
    if (p[1].revents & (POLLHUP | POLLERR)) { reason = 24; break; }
    if (p[1].revents & POLLIN) {
      char b[64];
      ssize_t n = read(0, b, sizeof b);
      if (n <= 0) { reason = 24; break; }
      last = ms();
      if (memchr(b, 'Q', n)) break;
    }
    if (p[0].revents & (POLLHUP | POLLERR)) { reason = 25; break; }
    if (p[0].revents & POLLIN) {
      struct ev e[64];
      ssize_t n = read(in, e, sizeof e);
      if (n < 0 && errno == EAGAIN) continue;
      if (n <= 0 || n % sizeof e[0]) { reason = 26; break; }
      for (int i = 0; i < n / (int)sizeof e[0] && !reason; i++) {
        int a = filter_event(&f, e + i, ms());
        if (a == TOGGLE && grabbed) {
          /* Off: hand the remote straight back to webOS, and only watch for the next triple Home. */
          if (release_keys(out) < 0 || ioctl(in, GRAB, 0) < 0) { reason = 31; break; }
          grabbed = 0;
          f.disabled = 1;
          report("OFF\n");
        } else if (a == TOGGLE) {
          while (read(in, drain, sizeof drain) > 0) {}
          if (ioctl(in, GRAB, 1) < 0) { report("FAIL grab\n"); reason = 17; break; }
          grabbed = 1;
          f.disabled = 0;
          report("ON\n");
          break;   /* the rest of this read was already delivered to webOS */
        } else if (!grabbed) continue;   /* webOS already has it, overflow included */
        else if (a == RELEASE) reason = 27;
        else if (a == OPEN_HOME) report("HOME\n");
        else if (a == PASS && write(out, e + i, sizeof e[i]) != sizeof e[i]) reason = 28;
      }
      if (reason) break;
    }
  }
  if (output_failed && !reason) reason = 30;
  /* Every cleanup step runs even if an earlier one fails: the remote must come back. */
  int cleanup = 0;
  if (grabbed && release_keys(out) < 0) cleanup |= 1;
  if (grabbed && ioctl(in, GRAB, 0) < 0) cleanup |= 2;
  close(in);
  close(out);
  if (cleanup) report("CLEANUP_FAILED %d\n", cleanup);
  report("EXIT %d\n", reason);
  return reason;
}
