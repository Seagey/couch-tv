/* cc -o /tmp/test_filter lg/helper/test_filter.c lg/helper/filter.c && /tmp/test_filter */
#include "filter.h"
#include <assert.h>
#include <stdio.h>

static int key(struct filter *f, int code, int value, uint64_t t) {
  struct ev e = {0, 0, 1, code, value};
  return filter_event(f, &e, t);
}

int main(void) {
  struct filter f = {0};
  assert(key(&f, 773, 1, 1000) == OPEN_HOME);
  assert(key(&f, 773, 0, 1100) == DROP);
  assert(key(&f, 28, 1, 1200) == PASS);
  assert(key(&f, 28, 0, 1300) == PASS);

  struct filter t = {0};
  for (int i = 0; i < 2; i++) {
    assert(key(&t, 773, 1, 5000 + i * 300) == OPEN_HOME);
    assert(key(&t, 773, 0, 5100 + i * 300) == DROP);
  }
  assert(key(&t, 773, 1, 5600) == OPEN_HOME);
  assert(key(&t, 773, 0, 5700) == TOGGLE);

  t.disabled = 1;
  assert(key(&t, 773, 1, 7000) == PASS);
  assert(key(&t, 773, 0, 7100) == PASS);
  assert(key(&t, 773, 1, 7300) == PASS);
  assert(key(&t, 773, 0, 7400) == PASS);
  assert(key(&t, 773, 1, 7600) == PASS);
  assert(key(&t, 773, 0, 7700) == TOGGLE);

  struct filter slow = {0};
  for (int i = 0; i < 3; i++) {
    key(&slow, 773, 1, 9000 + i * 1500);
    assert(key(&slow, 773, 0, 9100 + i * 1500) == DROP);
  }

  struct filter b = {0};
  assert(key(&b, 412, 1, 20000) == PASS);
  assert(filter_timeout(&b, 21000) == 0);
  assert(filter_timeout(&b, 21200) == OPEN_LG);
  assert(filter_timeout(&b, 21300) == 0);

  struct ev overflow = {0, 0, 0, 3, 0};
  assert(filter_event(&f, &overflow, 30000) == RELEASE);
  puts("filter ok");
  return 0;
}
