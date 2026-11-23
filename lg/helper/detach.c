/* The app's "main": webOS runs it on launch. It starts helper.js in its own session, so the
 * Helper keeps running after the application manager is done with this process. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <libgen.h>
#include <stdio.h>
#include <unistd.h>

int main(void) {
  char self[512] = {0}, script[600], logfile[600];
  if (readlink("/proc/self/exe", self, sizeof self - 1) < 0) return 1;
  char *dir = dirname(self);
  snprintf(script, sizeof script, "%s/helper.js", dir);
  /* /tmp is closed to Developer Mode apps; the app's own folder is writable. */
  snprintf(logfile, sizeof logfile, "%s/helper.log", dir);
  pid_t p = fork();
  if (p < 0) return 1;
  if (p > 0) return 0;
  setsid();
  int log = open(logfile, O_WRONLY | O_APPEND | O_CREAT, 0644);
  if (log >= 0) { dup2(log, 1); dup2(log, 2); close(log); }
  int null = open("/dev/null", O_RDONLY);
  if (null >= 0) { dup2(null, 0); close(null); }
  execl("/usr/bin/node", "node", script, (char *)0);
  _exit(2);
}
